import {
	AudioSample,
	AudioSampleSource,
	BufferTarget,
	Mp4OutputFormat,
	Output,
	StreamTarget,
	type StreamTargetChunk,
	VideoSample,
	VideoSampleSource,
	WebMOutputFormat
} from 'mediabunny';
import type {
	CapabilityProbeResult,
	ExportCodecSupport,
	ExportProgress,
	ExportSettings,
	ExportVideoCodec,
	TimeRemapSnapshot,
	ThroughputProbe
} from '../../protocol';
import { exportConstraintsForProbe } from '../capability-probe-v2';
import {
	type CanvasCompatibilityLayer,
	CanvasCompatibilityRenderer,
	type CloseableBitmap,
	type CloseableFrame
} from './canvas-compositor';
import type { MediaInputHandle } from '../media-io';
import {
	buildExportPlan,
	estimateEtaSeconds,
	exportFrameBounds,
	ExportCancelledError,
	layerBudgetFromProbe,
	mixAudioWindow,
	rebaseOutputTimestamp,
	timelineTimeAt
} from '../export';
import { isTitleClip, resolveAllAt, type Timeline } from '../timeline';
import { sampleClipParamsAt } from '../keyframes';
import {
	resolveNormalizedSourceTimestamp,
	resolveSourceTimestamp,
	type SourceTimestampResolution
} from '../media-adapters/source-timing';
import type { NormalizedSourceTiming } from '../media-adapters/types';
import { buildRemapLUT, remapOutputToSource, type RemapLUT } from '../time-remap';
import type { AudioTransitionCut } from '../audio-mix';
import type { TitleContent } from '../title';
import type { TransformParams } from '../transform';

export interface EncodeQueue {
	readonly encodeQueueSize: number;
}

export type Delay = () => Promise<void>;

export function limitedExportCodecs(probe: CapabilityProbeResult): readonly ExportCodecSupport[] {
	return exportConstraintsForProbe(probe).filter(
		(entry) => entry.codec === 'h264' || entry.codec === 'vp9'
	);
}

export function chooseLimitedExportCodec(probe: CapabilityProbeResult): ExportVideoCodec | null {
	const supported = limitedExportCodecs(probe);
	if (supported.some((entry) => entry.codec === 'h264')) return 'h264';
	if (supported.some((entry) => entry.codec === 'vp9')) return 'vp9';
	return null;
}

export async function waitForEncodeQueue(
	encoder: EncodeQueue,
	maxQueueSize = 3,
	delay: Delay = () => new Promise((resolve) => setTimeout(resolve, 0))
): Promise<void> {
	while (encoder.encodeQueueSize > maxQueueSize) {
		await delay();
	}
}

export async function makeVideoFrameFromBitmap<
	TBitmap extends CloseableBitmap,
	TFrame extends CloseableFrame
>(bitmap: TBitmap, createFrame: (bitmap: TBitmap) => TFrame): Promise<TFrame> {
	try {
		return createFrame(bitmap);
	} finally {
		bitmap.close();
	}
}

const AAC_CODEC = 'mp4a.40.2';
const OPUS_CODEC = 'opus';

const REDUCED_CODECS: Record<
	ExportVideoCodec,
	{
		container: 'mp4' | 'webm';
		webCodec: string;
		mediabunnyCodec: 'avc' | 'vp9' | 'av1';
	}
> = {
	h264: { container: 'mp4', webCodec: 'avc1.640028', mediabunnyCodec: 'avc' },
	vp9: { container: 'webm', webCodec: 'vp09.00.10.08', mediabunnyCodec: 'vp9' },
	av1: { container: 'webm', webCodec: 'av01.0.05M.08', mediabunnyCodec: 'av1' }
};

export interface ReducedExportResult {
	mimeType: string;
	fileName: string;
	blob: Blob | null;
	warnings: readonly string[];
}

export interface ReducedTimelineExportOptions {
	timeline: Timeline;
	sources: ReadonlyMap<string, MediaInputHandle>;
	renderer: CanvasCompatibilityRenderer;
	outputHandle?: FileSystemFileHandle | null;
	settings: ExportSettings;
	throughputProbe: ThroughputProbe | null;
	signal: AbortSignal;
	onProgress: (progress: ExportProgress) => void;
	masterGain?: number;
	transitions?: readonly AudioTransitionCut[];
	/** Phase 36: voice cleanup settings for master-bus inserts during export. */
	voiceCleanupSettings?: import('../voice-cleanup/voice-cleanup-processor').MasterCleanupChainParams;
	/** Phase 36: persistent cleanup state (gate/limiter DSP state) across blocks. */
	cleanupState?: import('../voice-cleanup/voice-cleanup-processor').VoiceCleanupChainState;
	/** When true, the project contains at least one video transition that cannot be
	 *  rendered on the reduced-compatibility path; a warning is surfaced to the user. */
	hasVideoTransitions?: boolean;
	overlayTitleLayersAt?: (
		timelineTime: number
	) => Array<{ content: TitleContent; transform: TransformParams }>;
	fallbackFileName?: string;
}

function throwIfCanceled(signal: AbortSignal): void {
	if (signal.aborted) throw new ExportCancelledError();
}

function reducedProgress(
	options: ReducedTimelineExportOptions,
	plan: ReturnType<typeof buildExportPlan>,
	phase: ExportProgress['phase'],
	doneFrames: number,
	startedAt: number
): ExportProgress {
	return {
		preset: plan.preset,
		codec: plan.codec,
		container: plan.container,
		phase,
		doneFrames,
		totalFrames: plan.totalFrames,
		percent: plan.totalFrames > 0 ? Math.min(1, doneFrames / plan.totalFrames) : 1,
		etaSeconds:
			phase === 'video'
				? estimateEtaSeconds(
						plan.totalFrames,
						doneFrames,
						options.throughputProbe,
						plan.preset,
						plan.codec
					)
				: null,
		elapsedSeconds: (performance.now() - startedAt) / 1000,
		subRealtime: plan.subRealtime
	};
}

async function assertReducedVideoSupport(
	codec: ExportVideoCodec,
	width: number,
	height: number,
	bitrate: number,
	fps: number
): Promise<void> {
	if (typeof VideoEncoder === 'undefined') {
		throw new Error('Reduced export requires WebCodecs VideoEncoder support.');
	}
	const candidate = REDUCED_CODECS[codec];
	if (codec === 'av1') {
		throw new Error(
			'Reduced export supports H.264/MP4 or VP9/WebM. AV1 requires the core WebGPU tier.'
		);
	}
	const support = await VideoEncoder.isConfigSupported({
		codec: candidate.webCodec,
		width,
		height,
		bitrate,
		framerate: fps,
		hardwareAcceleration: 'prefer-hardware',
		latencyMode: 'quality',
		...(codec === 'h264' ? { avc: { format: 'avc' } } : {})
	});
	if (!support.supported) {
		throw new Error(`${codec.toUpperCase()} reduced export is not supported in this browser.`);
	}
}

async function reducedAudioSupported(
	container: 'mp4' | 'webm',
	channels: number,
	sampleRate: number,
	bitrate: number
): Promise<boolean> {
	if (typeof AudioEncoder === 'undefined') return false;
	try {
		const support = await AudioEncoder.isConfigSupported({
			codec: container === 'webm' ? OPUS_CODEC : AAC_CODEC,
			numberOfChannels: channels,
			sampleRate,
			bitrate
		});
		return support.supported === true;
	} catch {
		return false;
	}
}

// Phase 35: resolve source timestamp with optional time-remap
interface RemapCapableClip {
	readonly inPoint: number;
	readonly start: number;
	readonly duration: number;
	readonly timeRemap?: TimeRemapSnapshot;
}

const compatExportRemapLutCache = new WeakMap<RemapCapableClip, RemapLUT>();

function getOrBuildRemapLut(clip: RemapCapableClip): RemapLUT | null {
	if (!clip.timeRemap) return null;
	const cached = compatExportRemapLutCache.get(clip);
	if (cached) return cached;
	const lut = buildRemapLUT(clip.timeRemap.keyframes, clip.timeRemap.sourceDurationS);
	compatExportRemapLutCache.set(clip, lut);
	return lut;
}

function resolveSourceTimestampWithRemap(options: {
	clip: RemapCapableClip;
	timelineTime: number;
	trackKind: 'video' | 'audio';
	timing: NormalizedSourceTiming;
}): SourceTimestampResolution {
	const lut = getOrBuildRemapLut(options.clip);
	if (lut) {
		const clipLocalOutTimeS = options.timelineTime - options.clip.start;
		const remappedSourceS = remapOutputToSource(lut, clipLocalOutTimeS) + options.clip.inPoint;
		return resolveNormalizedSourceTimestamp(options.timing, options.trackKind, remappedSourceS);
	}
	return resolveSourceTimestamp(options as Parameters<typeof resolveSourceTimestamp>[0]);
}

async function encodeReducedVideo(
	options: ReducedTimelineExportOptions,
	videoSource: VideoSampleSource,
	startedAt: number
): Promise<void> {
	const plan = buildExportPlan(
		options.timeline,
		options.sources,
		options.settings,
		options.throughputProbe
	);
	options.renderer.setPreviewSize(plan.width, plan.height);
	const frameDuration = 1 / plan.frameRate;
	const { startFrame, endFrame } = exportFrameBounds(plan.exportDuration, plan.frameRate);
	const keyFrameInterval = Math.max(1, Math.round(plan.frameRate * 2));
	const layerBudget = layerBudgetFromProbe(options.throughputProbe);
	let lastReport = 0;

	if (options.hasVideoTransitions) {
		console.warn('Video transitions are not rendered on the reduced-compatibility export path.');
	}

	for (let frameIndex = startFrame; frameIndex < endFrame; frameIndex += 1) {
		throwIfCanceled(options.signal);
		const outputTimestamp = rebaseOutputTimestamp(frameIndex, plan.frameRate);
		const timelineTime = timelineTimeAt(plan, outputTimestamp);
		const duration = Math.max(1e-6, Math.min(frameDuration, plan.exportDuration - outputTimestamp));
		const resolvedLayers = resolveAllAt(
			options.timeline,
			Math.min(timelineTime, plan.rangeStartS + plan.exportDuration - 1e-6),
			undefined // Phase 13 transitions not supported on reduced path
		);
		const decodedFrames: VideoFrame[] = [];
		const renderLayers: CanvasCompatibilityLayer[] = [];
		let exportFrame: VideoFrame;
		try {
			let decodedCount = 0;
			for (const layer of resolvedLayers) {
				const sampled = sampleClipParamsAt(layer.clip, timelineTime);
				if (isTitleClip(layer.clip)) {
					if (layer.clip.title) {
						renderLayers.push({
							kind: 'title',
							content: layer.clip.title,
							transform: sampled.transform
						});
					}
					continue;
				}
				if (decodedCount >= layerBudget) continue;
				const sourceHandle = options.sources.get(layer.clip.sourceId);
				if (!sourceHandle?.frameSource) continue;
				const sourceTimestamp = resolveSourceTimestampWithRemap({
					clip: layer.clip,
					timelineTime,
					trackKind: 'video',
					timing: sourceHandle.timing
				});
				if (!sourceTimestamp.available) continue;
				const decoded = await sourceHandle.frameSource.frameAt(sourceTimestamp.adapterTimestampS);
				if (!decoded) continue;
				decodedCount += 1;
				let videoFrame: VideoFrame;
				try {
					videoFrame = decoded.toVideoFrame();
				} finally {
					decoded.close();
				}
				decodedFrames.push(videoFrame);
				renderLayers.push({ kind: 'frame', frame: videoFrame, transform: sampled.transform });
			}
			for (const overlay of options.overlayTitleLayersAt?.(timelineTime) ?? []) {
				renderLayers.push({
					kind: 'title',
					content: overlay.content,
					transform: overlay.transform
				});
			}
			exportFrame =
				renderLayers.length > 0
					? await options.renderer.renderLayeredForExport(renderLayers, outputTimestamp, duration)
					: await options.renderer.renderBlackForExport(outputTimestamp, duration);
		} finally {
			for (const frame of decodedFrames) frame.close();
		}

		let sample: VideoSample;
		try {
			sample = new VideoSample(exportFrame, { timestamp: outputTimestamp, duration });
		} catch (error) {
			exportFrame.close();
			throw error;
		}
		// Mediabunny's VideoSample owns VideoFrame-backed data after construction;
		// sample.close() releases exportFrame, while the catch path above owns it.
		await videoSource
			.add(sample, { keyFrame: frameIndex % keyFrameInterval === 0 })
			.finally(() => sample.close());

		const now = performance.now();
		if (now - lastReport > 250 || frameIndex === endFrame - 1) {
			lastReport = now;
			options.onProgress(reducedProgress(options, plan, 'video', frameIndex + 1, startedAt));
		}
	}
}

async function encodeReducedAudio(
	options: ReducedTimelineExportOptions,
	audioSource: AudioSampleSource,
	startedAt: number
): Promise<void> {
	const plan = buildExportPlan(
		options.timeline,
		options.sources,
		options.settings,
		options.throughputProbe
	);
	const totalAudioFrames = Math.max(1, Math.ceil(plan.exportDuration * plan.audioSampleRate));
	const blockFrames = 1024;
	let lastReport = 0;
	for (let cursor = 0; cursor < totalAudioFrames; cursor += blockFrames) {
		throwIfCanceled(options.signal);
		const frames = Math.min(blockFrames, totalAudioFrames - cursor);
		const outputTimestamp = cursor / plan.audioSampleRate;
		const timelineTime = timelineTimeAt(plan, outputTimestamp);
		const pcm = await mixAudioWindow(
			options.timeline,
			options.sources,
			timelineTime,
			frames,
			plan.audioSampleRate,
			plan.audioChannels,
			{
				masterGain: options.masterGain,
				transitions: options.transitions,
				voiceCleanup: options.voiceCleanupSettings,
				cleanupState: options.cleanupState
			}
		);
		const sample = new AudioSample({
			data: pcm,
			format: 'f32',
			numberOfChannels: plan.audioChannels,
			sampleRate: plan.audioSampleRate,
			timestamp: outputTimestamp
		});
		await audioSource.add(sample).finally(() => sample.close());
		const now = performance.now();
		if (now - lastReport > 500) {
			lastReport = now;
			const doneFrames = Math.min(
				plan.totalFrames,
				Math.ceil(((cursor + frames) / plan.audioSampleRate) * plan.frameRate)
			);
			options.onProgress(reducedProgress(options, plan, 'audio', doneFrames, startedAt));
		}
	}
}

export async function exportTimelineReduced(
	options: ReducedTimelineExportOptions
): Promise<ReducedExportResult> {
	const plan = buildExportPlan(
		options.timeline,
		options.sources,
		options.settings,
		options.throughputProbe
	);
	throwIfCanceled(options.signal);
	await assertReducedVideoSupport(
		plan.codec,
		plan.width,
		plan.height,
		plan.videoBitrate,
		plan.frameRate
	);

	const candidate = REDUCED_CODECS[plan.codec];
	const warnings: string[] = [];
	if (options.hasVideoTransitions) {
		warnings.push(
			'Video transitions are not rendered on the reduced-compatibility export path. ' +
				'Use the full-performance (WebGPU) path to include transitions in your export.'
		);
	}
	const includeAudio =
		plan.hasAudio &&
		(await reducedAudioSupported(
			plan.container,
			plan.audioChannels,
			plan.audioSampleRate,
			plan.audioBitrate
		));
	if (plan.hasAudio && !includeAudio) {
		warnings.push(
			'Audio was omitted because this reduced browser tier cannot encode the required audio track.'
		);
	}

	const streamTarget = options.outputHandle
		? new StreamTarget(
				(await options.outputHandle.createWritable()) as WritableStream<StreamTargetChunk>,
				{ chunked: true }
			)
		: null;
	const bufferTarget = streamTarget ? null : new BufferTarget();
	const target: StreamTarget | BufferTarget = streamTarget ?? bufferTarget!;
	let output: Output<Mp4OutputFormat | WebMOutputFormat, BufferTarget | StreamTarget> | null = null;
	let videoSource: VideoSampleSource | null = null;
	let audioSource: AudioSampleSource | null = null;
	try {
		output = new Output({
			format:
				plan.container === 'mp4'
					? new Mp4OutputFormat({ fastStart: false })
					: new WebMOutputFormat(),
			target
		});
		videoSource = new VideoSampleSource({
			codec: candidate.mediabunnyCodec,
			fullCodecString: candidate.webCodec,
			bitrate: plan.videoBitrate,
			bitrateMode: 'variable',
			keyFrameInterval: 2,
			hardwareAcceleration: 'prefer-hardware',
			latencyMode: plan.preset === 'fast' ? 'realtime' : 'quality'
		});
		output.addVideoTrack(videoSource, { frameRate: plan.frameRate });
		audioSource = includeAudio
			? new AudioSampleSource({
					codec: plan.container === 'webm' ? 'opus' : 'aac',
					fullCodecString: plan.container === 'webm' ? OPUS_CODEC : AAC_CODEC,
					bitrate: plan.audioBitrate,
					bitrateMode: 'variable'
				})
			: null;
		if (audioSource) output.addAudioTrack(audioSource);

		const startedAt = performance.now();
		options.onProgress(reducedProgress(options, plan, 'video', 0, startedAt));
		await output.start();
		await encodeReducedVideo(options, videoSource, startedAt);
		videoSource.close();
		videoSource = null;
		if (audioSource) {
			await encodeReducedAudio(options, audioSource, startedAt);
			audioSource.close();
			audioSource = null;
		}
		options.onProgress(reducedProgress(options, plan, 'finalizing', plan.totalFrames, startedAt));
		const fallbackMime = plan.container === 'webm' ? 'video/webm' : 'video/mp4';
		const mimeType = await output.getMimeType().catch(() => fallbackMime);
		await output.finalize();
		output = null;
		const fileName =
			options.outputHandle?.name ??
			options.fallbackFileName ??
			`localcut-reduced.${plan.container === 'webm' ? 'webm' : 'mp4'}`;
		if (options.outputHandle) {
			return { mimeType, fileName, blob: null, warnings };
		}
		const buffer = bufferTarget?.buffer;
		if (!buffer) throw new Error('Reduced export did not produce an output buffer.');
		return { mimeType, fileName, blob: new Blob([buffer], { type: mimeType }), warnings };
	} catch (error) {
		videoSource?.close();
		audioSource?.close();
		if (output) await output.cancel().catch(() => undefined);
		if (error instanceof ExportCancelledError) throw error;
		if (options.signal.aborted) throw new ExportCancelledError();
		throw error;
	}
}
