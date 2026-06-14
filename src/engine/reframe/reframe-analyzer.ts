/**
 * Smart Reframe analysis worker (Phase 33). Owns its own Mediabunny demux +
 * VideoDecoder instance for offline frame scanning. Receives a File, decodes
 * at the configured analysis FPS, runs face detection / saliency / tracking,
 * and returns Phase 15 transform keyframes.
 */

import {
	Input,
	BlobSource,
	MP4,
	QTFF,
	WEBM,
	MP3,
	OGG,
	WAVE,
	VideoSampleSink,
	type InputVideoTrack
} from 'mediabunny';
import type {
	SmartReframeWorkerCommand,
	SmartReframeWorkerState,
	ClipKeyframesSnapshot,
	ReframeAnalysisStatsSnapshot
} from '../../protocol';
import { createSaliencyEstimator } from './saliency-estimator';
import { createSubjectTracker, type TrackedDetection } from './subject-tracker';
import {
	computeHistogram,
	isShotBoundary,
	DEFAULT_SHOT_BOUNDARY_THRESHOLD
} from './shot-boundary-detector';
import {
	generateReframeKeyframes,
	DEFAULT_KEYFRAME_GEN_CONFIG,
	type TrajectoryPoint
} from './keyframe-generator';
import type { FaceDetector } from './face-detector';
import { validateManifest } from './model-manifest';
import { AssetIntegrityError, createOpfsAssetStore, loadVerifiedAsset } from '../asr/asset-cache';
import { assertTrustedModelUrl } from '../asr/model-catalog';
import { deriveMode, pickPrimaryFace } from './reframe-analysis';

const MAX_ANALYSIS_EDGE = 512;
const PROGRESS_THROTTLE_MS = 100;

function post(msg: SmartReframeWorkerState): void {
	self.postMessage(msg);
}

/** State for the analysis pipeline. */
interface AnalysisState {
	cancelled: boolean;
}

let currentAnalysis: AnalysisState | null = null;

async function handleStart(
	cmd: Extract<SmartReframeWorkerCommand, { type: 'reframe-start' }>
): Promise<void> {
	const state: AnalysisState = { cancelled: false };
	currentAnalysis = state;
	// Declared outside the try so the `finally` can release it on any exit path.
	let faceDetector: FaceDetector | null = null;

	try {
		// Open the file with Mediabunny
		const IMPORT_FORMATS = [MP4, QTFF, WEBM, MP3, OGG, WAVE];
		const source = new BlobSource(cmd.sourceFile);
		const mediaInput = new Input({ formats: IMPORT_FORMATS, source });
		if (!(await mediaInput.canRead())) {
			post({ type: 'reframe-error', reason: 'File format is not supported or is corrupted.' });
			return;
		}
		const tracks = await mediaInput.getTracks();
		const videoTrack = tracks.find((t): t is InputVideoTrack => t.type === 'video');

		if (!videoTrack) {
			post({ type: 'reframe-error', reason: 'No video track found in source file.' });
			return;
		}

		const duration = cmd.clipDuration;
		const analysisFps = cmd.analysisFps ?? 2;
		// Honour the clip's in-point: analyse the used portion of the source, not
		// always source time 0 (R6.4). Sampling and timestamps below are in source
		// time; trajectory/keyframe times are converted to clip-local.
		const inPoint = Math.max(0, cmd.inPoint ?? 0);

		// Initialize detection modules
		const saliency = createSaliencyEstimator();
		const tracker = createSubjectTracker();
		let prevHist: Float64Array | null = null;
		const shotBoundaryThreshold = cmd.shotBoundaryThreshold ?? DEFAULT_SHOT_BOUNDARY_THRESHOLD;

		// Face detection (R2): only when the caller provides a model. Absent one
		// the analysis is saliency-only (R2.6 / R8.2). The model is downloaded +
		// digest-verified via the shared asset cache, then compiled with LiteRT.js.
		// Integrity failures (checksum/size) are hard errors and must not fall
		// through to saliency (R2.2); ordinary load failures (network, runtime,
		// untrusted host) do fall through.
		if (cmd.faceModel) {
			try {
				const validation = validateManifest(cmd.faceModel.manifest);
				if (!validation.ok) {
					throw new Error(
						`Invalid face model manifest: ${validation.error.field}: ${validation.error.reason}`
					);
				}
				const manifest = validation.manifest;
				assertTrustedModelUrl(manifest.model.url, self.location.origin);
				const store = await createOpfsAssetStore('reframe-models');
				const modelBytes = await loadVerifiedAsset(manifest.model, { store });
				// Lazy: keep LiteRT.js out of the worker's eager graph (saliency path).
				const { createLiteRtFaceDetector } = await import('./face-detector');
				faceDetector = await createLiteRtFaceDetector({
					wasmPath: cmd.faceModel.wasmPath,
					accelerator: cmd.faceModel.accelerator,
					modelBytes,
					manifest
				});
			} catch (err) {
				if (err instanceof AssetIntegrityError) throw err;
				// Runtime unavailable / network / untrusted — saliency-only.
				faceDetector = null;
			}
		}

		// Track stats
		let facesDetected = 0;
		let saliencyFrames = 0;
		let shotBoundaries = 0;
		let framesProcessed = 0;
		/** Clip-local times of detected cuts, fed to the keyframe generator (R5.3). */
		const shotBoundaryTimes: number[] = [];

		// The analyser keeps its own whole-clip trajectory: the tracker clears its
		// internal trajectory on every shot-boundary reset, so this is the only
		// record that survives cuts (it is not a redundant copy of
		// `tracker.trajectory()`).
		const trajectory: TrajectoryPoint[] = [];
		let lastProgressPost = 0;

		// Single streaming pass: decode → detect → track, one sample at a time.
		// Each frame's ImageData is processed and discarded before the next decode,
		// so memory stays bounded regardless of clip length. The `for await`
		// suspends on each decode, which lets a queued `reframe-cancel` message be
		// delivered between frames (the cancel check at the top then stops promptly).
		const sink = new VideoSampleSink(videoTrack);
		const interval = 1 / analysisFps;
		let nextSampleTime = inPoint;
		// Progress denominator estimate (the exact frame count isn't known up-front
		// in a single pass); the fraction is clamped to 1 below.
		const totalFrames = Math.max(1, Math.ceil(duration * analysisFps));

		for await (const sample of sink.samples(inPoint, inPoint + duration)) {
			if (state.cancelled) {
				sample.close();
				break;
			}

			const sampleTime = sample.timestamp;
			if (sampleTime < nextSampleTime - interval * 0.5) {
				sample.close();
				continue;
			}

			const { codedWidth, codedHeight } = sample;
			const longest = Math.max(codedWidth, codedHeight);
			const frameScale = longest > MAX_ANALYSIS_EDGE ? MAX_ANALYSIS_EDGE / longest : 1;
			const w = Math.round(codedWidth * frameScale);
			const h = Math.round(codedHeight * frameScale);

			const canvas = new OffscreenCanvas(w, h);
			const ctx = canvas.getContext('2d');
			if (!ctx) {
				sample.close();
				continue;
			}

			// Draw the frame, then release the VideoFrame + VideoSample on every
			// path (including a draw throw) before the synchronous analysis below —
			// the hard gate requires each VideoFrame closed exactly once.
			const videoFrame = sample.toVideoFrame();
			let imageData: ImageData;
			try {
				// Apply source rotation metadata (Phase 18)
				if (cmd.sourceRotation === 90 || cmd.sourceRotation === 270) {
					canvas.width = h;
					canvas.height = w;
					ctx.translate(h / 2, w / 2);
					ctx.rotate((cmd.sourceRotation * Math.PI) / 180);
					ctx.drawImage(videoFrame, -w / 2, -h / 2, w, h);
				} else if (cmd.sourceRotation === 180) {
					ctx.translate(w / 2, h / 2);
					ctx.rotate(Math.PI);
					ctx.drawImage(videoFrame, -w / 2, -h / 2, w, h);
				} else {
					ctx.drawImage(videoFrame, 0, 0, w, h);
				}
				imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
			} finally {
				videoFrame.close();
				sample.close();
			}

			nextSampleTime = sampleTime + interval;
			// Clip-local time (R6.4). The first decoded sample can cover a source
			// time just before the in-point; clamp so timestamps never go negative.
			const clipTime = Math.max(0, sampleTime - inPoint);
			framesProcessed++;

			// Shot boundary detection. Reset before this frame's detection so the
			// frame becomes the first sample of the new shot; record the cut time.
			const currHist = computeHistogram(imageData);
			if (prevHist && isShotBoundary(prevHist, currHist, shotBoundaryThreshold)) {
				shotBoundaries++;
				shotBoundaryTimes.push(clipTime);
				tracker.reset();
			}
			prevHist = currHist;

			// Face detection (when a model is loaded), else generic saliency (R3.1).
			let detection: TrackedDetection | null = null;

			if (faceDetector) {
				const primary = pickPrimaryFace(await faceDetector.detect(imageData));
				if (primary) {
					facesDetected++;
					detection = {
						cx: primary.x + primary.width / 2,
						cy: primary.y + primary.height / 2,
						width: primary.width,
						height: primary.height,
						confidence: primary.confidence,
						source: 'face'
					};
				}
			}

			if (!detection) {
				const sal = saliency.estimate(imageData);
				saliencyFrames++;
				detection = {
					cx: sal.centroidX,
					cy: sal.centroidY,
					width: 0.15,
					height: 0.15,
					confidence: sal.confidence,
					source: 'saliency'
				};
			}

			// Update tracker, then convert the [0,1] centroid into the
			// centre-relative offset the keyframe generator expects (R6.2).
			const smoothed = tracker.update({ detection, time: clipTime });
			trajectory.push({ time: clipTime, cx: smoothed.cx - 0.5, cy: smoothed.cy - 0.5 });

			// Progress update (throttled)
			const now = Date.now();
			if (now - lastProgressPost > PROGRESS_THROTTLE_MS) {
				post({
					type: 'reframe-progress',
					fraction: Math.min(1, framesProcessed / totalFrames),
					framesProcessed,
					totalFrames
				});
				lastProgressPost = now;
			}
		}

		if (state.cancelled) {
			post({ type: 'reframe-cancelled' });
			return;
		}

		// Generate keyframes from trajectory
		const keyframeResult = generateReframeKeyframes(trajectory, {
			targetAspect: cmd.targetAspect,
			sourceAspect: cmd.sourceWidth / cmd.sourceHeight,
			...DEFAULT_KEYFRAME_GEN_CONFIG,
			velocityBound: cmd.velocityBound ?? DEFAULT_KEYFRAME_GEN_CONFIG.velocityBound,
			accelerationBound: cmd.accelerationBound ?? DEFAULT_KEYFRAME_GEN_CONFIG.accelerationBound,
			shotBoundaries: shotBoundaryTimes
		});

		const stats: ReframeAnalysisStatsSnapshot = {
			framesAnalysed: framesProcessed,
			facesDetected,
			saliencyFrames,
			shotBoundaries,
			keyframesGenerated: countKeyframes(keyframeResult.keyframes),
			safeZoneCompliance: keyframeResult.safeZoneCompliance,
			mode: deriveMode(facesDetected, saliencyFrames)
		};

		post({
			type: 'reframe-result',
			keyframes: keyframeResult.keyframes,
			stats
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		post({
			type: 'reframe-error',
			reason: message,
			integrity: err instanceof AssetIntegrityError
		});
	} finally {
		faceDetector?.dispose();
		if (currentAnalysis === state) {
			currentAnalysis = null;
		}
	}
}

function countKeyframes(keyframes: ClipKeyframesSnapshot): number {
	let count = 0;
	for (const track of Object.values(keyframes)) {
		if (track) count += track.length;
	}
	return count;
}

// Worker message handler
self.onmessage = (event: MessageEvent<SmartReframeWorkerCommand>) => {
	const cmd = event.data;

	switch (cmd.type) {
		case 'reframe-start':
			void handleStart(cmd);
			break;

		case 'reframe-cancel':
			if (currentAnalysis) {
				currentAnalysis.cancelled = true;
				post({ type: 'reframe-cancelled' });
			}
			break;

		case 'reframe-dispose':
			if (currentAnalysis) {
				currentAnalysis.cancelled = true;
			}
			self.close();
			break;
	}
};
