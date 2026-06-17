import { describe, expect, it, vi } from 'vite-plus/test';
import {
	asrActionAvailability,
	AsrController,
	planAsrWindows,
	preferredAccelerator,
	type AsrClipTarget,
	type AsrControllerState,
	type ClipAudioRequest,
	type CreateCaptionTrackRequest
} from './asr-controller';
import type {
	AsrProbeResult,
	AsrWorkerCommand,
	AsrWorkerState,
	CaptionSegmentSnapshot
} from '../protocol';
import type { AsrWorkerPort } from './asr-bridge';
import { ASR_MODEL_CATALOG, defaultModel } from '../engine/asr/model-catalog';

const CLIP: AsrClipTarget = {
	trackId: 'track-1',
	clipId: 'clip-1',
	timelineStartS: 12.5,
	durationS: 10,
	fileName: 'interview.mov'
};

const SEGMENTS: CaptionSegmentSnapshot[] = [
	{ id: 'asr-seg-0', start: 0, duration: 1.2, text: 'hello world' }
];

type TranscribeMode = 'result' | 'empty' | 'silent';

interface Harness {
	controller: AsrController;
	spawnCount: () => number;
	extractions: ClipAudioRequest[];
	tracks: CreateCaptionTrackRequest[];
	workerCommands: AsrWorkerCommand[];
	autoRespond: { extraction: boolean; modelLoad: boolean };
	modelLoadFailure: { value: string | null };
	transcribeMode: { value: TranscribeMode };
	crashWorker: (message: string) => void;
	errors: string[];
}

function windowSeconds(cmd: Extract<AsrWorkerCommand, { type: 'asr-transcribe' }>): number {
	return cmd.pcm.length / cmd.channels / cmd.sampleRate;
}

function harness(): Harness {
	let spawns = 0;
	const extractions: ClipAudioRequest[] = [];
	const tracks: CreateCaptionTrackRequest[] = [];
	const workerCommands: AsrWorkerCommand[] = [];
	const autoRespond = { extraction: true, modelLoad: true };
	const modelLoadFailure: { value: string | null } = { value: null };
	const transcribeMode: { value: TranscribeMode } = { value: 'result' };
	const errors: string[] = [];
	let postState: (msg: AsrWorkerState) => void = () => undefined;
	let crash: (message: string) => void = () => undefined;

	const controller = new AsrController({
		spawnWorker: async (onState, onCrash) => {
			spawns += 1;
			postState = onState;
			crash = onCrash;
			return {
				send(cmd: AsrWorkerCommand) {
					workerCommands.push(cmd);
					queueMicrotask(() => {
						switch (cmd.type) {
							case 'asr-load-model':
								if (!autoRespond.modelLoad) break;
								if (modelLoadFailure.value) {
									postState({
										type: 'asr-model-status',
										status: 'failed',
										accelerator: cmd.accelerator,
										error: modelLoadFailure.value
									});
									break;
								}
								postState({
									type: 'asr-model-status',
									status: 'loading',
									accelerator: cmd.accelerator,
									sizeBytes: 600,
									downloadedBytes: 300,
									fraction: 0.5
								});
								postState({
									type: 'asr-model-status',
									status: 'loaded',
									accelerator: cmd.accelerator,
									sizeBytes: 600,
									fraction: 1,
									cached: false
								});
								break;
							case 'asr-transcribe': {
								const isFinal =
									cmd.isFinal ?? cmd.offsetS + windowSeconds(cmd) >= cmd.totalDurationS - 0.05;
								postState({
									type: 'asr-progress',
									jobId: cmd.jobId,
									fraction: 0.5,
									processedSeconds: cmd.offsetS,
									totalSeconds: cmd.totalDurationS
								});
								if (!isFinal) break;
								if (transcribeMode.value === 'result') {
									postState({
										type: 'asr-result',
										jobId: cmd.jobId,
										segments: SEGMENTS,
										language: 'en',
										phraseLevel: false,
										durationMs: 42
									});
								} else if (transcribeMode.value === 'empty') {
									postState({
										type: 'asr-error',
										jobId: cmd.jobId,
										message: 'No speech was detected in the selection.'
									});
								}
								break;
							}
							case 'asr-cancel':
								postState({ type: 'asr-cancelled', jobId: cmd.jobId });
								break;
							default:
								break;
						}
					});
				},
				terminate: vi.fn()
			};
		},
		requestClipAudio: (request) => {
			extractions.push(request);
			if (!autoRespond.extraction) return;
			queueMicrotask(() => {
				controller.handlePipelineMessage({
					type: 'clip-audio',
					requestId: request.requestId,
					pcm: new Float32Array(Math.round(request.durationS * request.sampleRate)),
					sampleRate: request.sampleRate,
					channels: 1,
					clipOffsetS: request.clipOffsetS,
					clipDurationS: CLIP.durationS
				});
			});
		},
		createCaptionTrack: (request) => {
			tracks.push(request);
			// Simulate the pipeline worker acking the new track.
			queueMicrotask(() =>
				controller.handlePipelineMessage({
					type: 'asr-caption-track-created',
					trackId: 'caption-1',
					track: {
						id: 'caption-1',
						kind: 'caption',
						name: request.trackName,
						language: request.language,
						segments: request.segments,
						defaultStyle: {} as never,
						burnedIn: false,
						visible: true,
						generatedBy: null
					}
				})
			);
		},
		onError: (message) => errors.push(message)
	});

	return {
		controller,
		spawnCount: () => spawns,
		extractions,
		tracks,
		workerCommands,
		autoRespond,
		modelLoadFailure,
		transcribeMode,
		crashWorker: (message: string) => crash(message),
		errors
	};
}

describe('AsrController', () => {
	it('probes WebAssembly and recommends litert-whisper without spawning a worker', () => {
		const h = harness();
		h.controller.setProbe();
		const state = h.controller.getState();
		expect(state.available).toBe(true);
		expect(state.recommendedEngine).toBe('litert-whisper');
		expect(h.spawnCount()).toBe(0);
	});

	it('loads the model on demand and tracks download progress', async () => {
		const h = harness();
		h.controller.setProbe();
		const states: AsrControllerState[] = [];
		h.controller.subscribe((s) => states.push(s));
		const ok = await h.controller.loadModel();
		expect(ok).toBe(true);
		expect(h.spawnCount()).toBe(1);
		expect(h.controller.getState().modelStatus).toBe('loaded');
		expect(h.controller.getState().accelerator).toBe('wasm');
		expect(states.some((s) => s.downloadFraction === 0.5)).toBe(true);
		expect(h.workerCommands[0]).toMatchObject({ type: 'asr-load-model', accelerator: 'wasm' });
	});

	it('starts with the default catalog model and loads from its manifest URL', async () => {
		const h = harness();
		h.controller.setProbe();
		expect(h.controller.getState().model.id).toBe(defaultModel().id);
		expect(h.controller.getState().models).toBe(ASR_MODEL_CATALOG);
		await h.controller.loadModel();
		expect(h.workerCommands[0]).toMatchObject({
			type: 'asr-load-model',
			manifestUrl: defaultModel().manifestUrl
		});
		expect(h.controller.getState().cached).toBe(false);
	});

	it('transcribes a clip into a generated caption track', async () => {
		const h = harness();
		h.controller.setProbe();
		await h.controller.loadModel();
		const ok = await h.controller.transcribeClip(CLIP, 'en');
		expect(ok).toBe(true);
		expect(h.tracks).toHaveLength(1);
		expect(h.tracks[0]).toMatchObject({
			engine: 'litert-whisper',
			accelerator: 'wasm',
			language: 'en',
			trackName: 'Auto (en) - interview.mov'
		});
		expect(h.tracks[0].segments).toEqual([
			{
				...SEGMENTS[0],
				start: SEGMENTS[0].start + CLIP.timelineStartS
			}
		]);
		expect(h.controller.getState().lastDurationMs).toBe(42);
	});

	it('rejects an empty transcript without creating a track', async () => {
		const h = harness();
		h.transcribeMode.value = 'empty';
		h.controller.setProbe();
		await h.controller.loadModel();
		const ok = await h.controller.transcribeClip(CLIP, 'en');
		expect(ok).toBe(false);
		expect(h.tracks).toHaveLength(0);
		expect(h.controller.getState().error).toMatch(/No speech/);
		expect(h.controller.getState().job).toBeNull();
	});

	it('does not auto-load or spawn a worker when transcribe is triggered before the model is loaded', async () => {
		const h = harness();
		h.controller.setProbe();

		expect(await h.controller.transcribeClip(CLIP, 'en')).toBe(false);

		expect(h.spawnCount()).toBe(0);
		expect(h.workerCommands).toHaveLength(0);
		expect(h.controller.getState().error).toBe('Load the selected model before transcribing.');
	});

	it('surfaces a worker crash and resets model status', async () => {
		const h = harness();
		h.controller.setProbe();
		await h.controller.loadModel();
		h.crashWorker('ASR worker crashed.');
		expect(h.controller.getState().modelStatus).toBe('not-loaded');
		expect(h.controller.getState().error).toBe('ASR worker crashed.');
		expect(h.errors).toContain('ASR worker crashed.');
	});

	it('cancels an in-flight job and clears state', async () => {
		const h = harness();
		h.autoRespond.extraction = false; // leave extraction pending
		h.controller.setProbe();
		await h.controller.loadModel();
		const pending = h.controller.transcribeClip(CLIP, 'en');
		// Wait until the extraction is actually in flight before cancelling.
		for (let i = 0; i < 50 && h.extractions.length === 0; i++) {
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		expect(h.extractions.length).toBeGreaterThan(0);
		h.controller.cancel();
		expect(await pending).toBe(false);
		expect(h.controller.getState().job).toBeNull();
		expect(h.tracks).toHaveLength(0);
	});

	it('cancels a model load and disposes the worker-side download', async () => {
		const h = harness();
		h.autoRespond.modelLoad = false;
		h.controller.setProbe();
		const pending = h.controller.loadModel();
		await new Promise((resolve) => setTimeout(resolve, 0));
		h.controller.cancel();
		expect(await pending).toBe(false);
		expect(h.workerCommands).toContainEqual({ type: 'asr-dispose' });
		expect(h.controller.getState().modelStatus).toBe('not-loaded');
	});

	it('cancels a model load while the ASR worker is still spawning', async () => {
		let resolveSpawn!: (port: AsrWorkerPort) => void;
		const send = vi.fn();
		const terminate = vi.fn();
		const worker: AsrWorkerPort = {
			send,
			terminate
		};
		const controller = new AsrController({
			spawnWorker: () =>
				new Promise<AsrWorkerPort>((resolve) => {
					resolveSpawn = resolve;
				}),
			requestClipAudio: vi.fn(),
			createCaptionTrack: vi.fn()
		});
		controller.setProbe();

		const pending = controller.loadModel();
		await Promise.resolve();
		controller.cancel();
		expect(controller.getState().modelStatus).toBe('not-loaded');
		resolveSpawn(worker);

		expect(await pending).toBe(false);
		expect(terminate).toHaveBeenCalledTimes(1);
		expect(send).not.toHaveBeenCalled();
		expect(controller.getState().modelStatus).toBe('not-loaded');
	});

	it('switches models after a failed load and starts a fresh worker', async () => {
		const h = harness();
		h.controller.setProbe();
		h.modelLoadFailure.value = 'Base failed to compile.';
		expect(await h.controller.loadModel()).toBe(false);
		expect(h.controller.getState().modelStatus).toBe('failed');

		h.controller.selectModel('whisper-tiny');
		expect(h.controller.getState().model.id).toBe('whisper-tiny');
		expect(h.controller.getState().modelStatus).toBe('not-loaded');
		expect(h.controller.getState().error).toBeNull();
		h.modelLoadFailure.value = null;
		expect(await h.controller.loadModel()).toBe(true);
		expect(h.spawnCount()).toBe(2);
		expect(h.workerCommands.at(-1)).toMatchObject({
			type: 'asr-load-model',
			manifestUrl: '/models/whisper/manifest-tiny.json'
		});
	});

	it('clears a failed state when reselecting the current model', async () => {
		const h = harness();
		h.controller.setProbe();
		h.modelLoadFailure.value = 'Model failed.';
		expect(await h.controller.loadModel()).toBe(false);
		expect(h.controller.getState().modelStatus).toBe('failed');

		h.controller.selectModel(h.controller.getState().model.id);

		expect(h.controller.getState().modelStatus).toBe('not-loaded');
		expect(h.controller.getState().error).toBeNull();
	});
});

describe('planAsrWindows', () => {
	it('returns a single full-duration window when within one window', () => {
		expect(planAsrWindows(10)).toEqual([
			{ offsetS: 0, windowS: 10, trustedFromS: 0, trustedToS: 10 }
		]);
	});

	it('overlaps longer jobs and tiles trusted ranges without gaps or overlap', () => {
		const plan = planAsrWindows(65);
		// stride = 30 - 5 = 25 → window offsets 0, 25, 50; each decodes 30s of audio
		// (the last is clamped to the remainder).
		expect(plan.map((w) => w.offsetS)).toEqual([0, 25, 50]);
		expect(plan.map((w) => w.windowS)).toEqual([30, 30, 15]);
		// Trusted ranges partition [0, 65): the first starts at 0, each subsequent
		// range starts exactly where the previous ends, and the last ends at duration.
		expect(plan[0].trustedFromS).toBe(0);
		for (let i = 1; i < plan.length; i++) {
			expect(plan[i].trustedFromS).toBeCloseTo(plan[i - 1].trustedToS, 6);
		}
		expect(plan[plan.length - 1].trustedToS).toBe(65);
	});
});

describe('preferredAccelerator', () => {
	const probe = (
		webgpu: AsrProbeResult['webgpu'],
		webnn: AsrProbeResult['webnn'] = 'unsupported'
	): AsrProbeResult => ({
		wasm: 'supported',
		webgpu,
		webnn,
		crossOriginIsolated: true,
		recommended: 'litert-whisper'
	});

	it('prefers WebNN when the browser reports support', () => {
		expect(preferredAccelerator(probe('supported', 'supported'))).toBe('webnn');
	});

	it('prefers WebGPU when WebNN is unavailable and WebGPU is enabled', () => {
		expect(preferredAccelerator(probe('supported', 'unsupported'))).toBe('webgpu');
	});

	it('uses the WASM baseline otherwise', () => {
		expect(preferredAccelerator(probe('unsupported'))).toBe('wasm');
		expect(preferredAccelerator(probe('unknown', 'unknown'))).toBe('wasm');
		expect(preferredAccelerator(null)).toBe('wasm');
	});
});

describe('asrActionAvailability', () => {
	function baseState(overrides: Partial<AsrControllerState> = {}): AsrControllerState {
		return {
			probe: null,
			available: true,
			recommendedEngine: 'litert-whisper',
			model: defaultModel(),
			models: ASR_MODEL_CATALOG,
			modelStatus: 'loaded',
			modelSizeBytes: 600,
			accelerator: 'wasm',
			engine: 'litert-whisper',
			downloadFraction: null,
			downloadedBytes: null,
			cached: null,
			job: null,
			lastDurationMs: null,
			error: null,
			...overrides
		};
	}

	it('disables every action when ASR is unavailable', () => {
		const availability = asrActionAvailability(baseState({ available: false }), CLIP);
		expect(availability.transcribeClip.enabled).toBe(false);
		expect(availability.loadModel.enabled).toBe(false);
	});

	it('keeps transcribe disabled until the model has finished loading', () => {
		const availability = asrActionAvailability(baseState({ modelStatus: 'not-loaded' }), CLIP);
		expect(availability.transcribeClip.enabled).toBe(false);
		expect(availability.transcribeClip.reason).toBe('Load the selected model before transcribing.');
	});

	it('requires a selected clip and keeps the unwired range action disabled', () => {
		const availability = asrActionAvailability(baseState(), null);
		expect(availability.transcribeClip.enabled).toBe(false);
		expect(availability.transcribeRange.enabled).toBe(false);
		expect(availability.transcribeRange.reason).toMatch(/mixed timeline audio extraction/);
	});

	it('disables actions while a job runs', () => {
		const availability = asrActionAvailability(
			baseState({
				job: {
					kind: 'selected-clip',
					phase: 'transcribing',
					fraction: 0.5,
					processedSeconds: 5,
					totalSeconds: 10,
					clip: CLIP
				}
			}),
			CLIP
		);
		expect(availability.transcribeClip.enabled).toBe(false);
		expect(availability.cancel.enabled).toBe(true);
	});
});
