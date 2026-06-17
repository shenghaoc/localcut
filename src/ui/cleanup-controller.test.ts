import { describe, expect, it, vi } from 'vite-plus/test';
import {
	CLEANUP_SAMPLE_RATE,
	CLEANUP_UNAVAILABLE_MESSAGE,
	cleanedFileName,
	cleanupActionAvailability,
	CleanupController,
	preferredCleanupAccelerator,
	type ApplyCleanupRequest,
	type CleanupClipTarget,
	type ClipAudioRequest
} from './cleanup-controller';
import type {
	CleanupBackendKind,
	CleanupProbeResult,
	CleanupWorkerCommand,
	CleanupWorkerState
} from '../protocol';

const PROBE_OK: CleanupProbeResult = {
	wasmAvailable: true,
	accelerator: 'wasm'
};

const PROBE_WEBGPU: CleanupProbeResult = {
	wasmAvailable: true,
	accelerator: 'webgpu'
};

const PROBE_WEBNN: CleanupProbeResult = {
	wasmAvailable: true,
	accelerator: 'webnn'
};

const PROBE_ABSENT: CleanupProbeResult = {
	wasmAvailable: false,
	accelerator: 'wasm'
};

const CLIP: CleanupClipTarget = {
	trackId: 'track-1',
	clipId: 'clip-1',
	inPointS: 1.5,
	durationS: 25,
	fileName: 'interview.mov'
};

interface Harness {
	controller: CleanupController;
	spawnCount: () => number;
	spawnedBackends: CleanupBackendKind[];
	extractions: ClipAudioRequest[];
	applied: ApplyCleanupRequest[];
	workerCommands: CleanupWorkerCommand[];
	/** When false, the matching requests are left pending (for cancel/crash tests). */
	autoRespond: { extraction: boolean; modelLoad: boolean };
	crashWorker: (message: string) => void;
	errors: string[];
}

function harness(): Harness {
	let spawns = 0;
	const spawnedBackends: CleanupBackendKind[] = [];
	const extractions: ClipAudioRequest[] = [];
	const applied: ApplyCleanupRequest[] = [];
	const workerCommands: CleanupWorkerCommand[] = [];
	const autoRespond = { extraction: true, modelLoad: true };
	const errors: string[] = [];
	let postState: (msg: CleanupWorkerState) => void = () => undefined;
	let crash: (message: string) => void = () => undefined;

	const controller = new CleanupController({
		spawnWorker: async (backend, onState, onCrash) => {
			spawns += 1;
			spawnedBackends.push(backend);
			postState = onState;
			crash = onCrash;
			return {
				send(cmd: CleanupWorkerCommand) {
					workerCommands.push(cmd);
					queueMicrotask(() => {
						switch (cmd.type) {
							case 'cleanup-load-model':
								if (!autoRespond.modelLoad) break;
								postState({
									type: 'cleanup-model-status',
									status: 'loaded',
									accelerator: 'wasm',
									sizeBytes: 3_538_944
								});
								break;
							case 'cleanup-chunk':
								postState({
									type: 'cleanup-progress',
									jobId: cmd.jobId,
									processedFrames: 100,
									totalFrames: 1000,
									fraction: 0.1
								});
								break;
							case 'cleanup-end':
								postState({
									type: 'cleanup-result',
									jobId: cmd.jobId,
									sampleRate: 16000,
									channels: 1,
									...(cmd.output === 'wav'
										? { wav: new ArrayBuffer(44) }
										: { pcm: new Float32Array(128) }),
									durationMs: 42
								});
								break;
							case 'cleanup-cancel':
								postState({ type: 'cleanup-cancelled', jobId: cmd.jobId });
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
		applyToClip: (request) => applied.push(request),
		manifestUrls: {
			litert: '/models/dtln/manifest.json',
			ort: '/models/dtln-onnx/manifest.json'
		},
		wasmPath: '/litert/',
		onError: (message) => errors.push(message)
	});
	return {
		controller,
		spawnCount: () => spawns,
		spawnedBackends,
		extractions,
		applied,
		workerCommands,
		autoRespond,
		crashWorker: (message: string) => crash(message),
		errors
	};
}

describe('CleanupController', () => {
	it('never spawns the worker until an explicit user action', () => {
		const h = harness();
		h.controller.setCleanupProbe(PROBE_OK);
		expect(h.controller.workerSpawned).toBe(false);
		expect(h.spawnCount()).toBe(0);
	});

	it('keeps the feature unavailable and spawns nothing when WASM is absent', async () => {
		const h = harness();
		h.controller.setCleanupProbe(PROBE_ABSENT);
		expect(h.controller.getState().available).toBe(false);
		expect(await h.controller.loadModel()).toBe(false);
		expect(await h.controller.previewCleanup(CLIP)).toBe(false);
		expect(h.controller.getState().error).toBe(CLEANUP_UNAVAILABLE_MESSAGE);
		expect(h.spawnCount()).toBe(0);
		expect(h.extractions.length).toBe(0);
	});

	it('loads the model on explicit action and reports the accelerator', async () => {
		const h = harness();
		h.controller.setCleanupProbe(PROBE_OK);
		expect(await h.controller.loadModel()).toBe(true);
		const state = h.controller.getState();
		expect(state.modelStatus).toBe('loaded');
		expect(state.accelerator).toBe('wasm');
		expect(state.modelSizeBytes).toBe(3_538_944);
		expect(h.spawnCount()).toBe(1);
		const load = h.workerCommands.find((cmd) => cmd.type === 'cleanup-load-model');
		expect(load).toBeDefined();
	});

	it('passes the probed preferred accelerator through model load', async () => {
		const h = harness();
		h.controller.setCleanupProbe(PROBE_WEBGPU);

		expect(await h.controller.loadModel()).toBe(true);

		expect(h.workerCommands).toContainEqual(
			expect.objectContaining({
				type: 'cleanup-load-model',
				preferredAccelerator: 'webgpu'
			})
		);
	});

	it('defaults to the ONNX backend and loads its manifest', async () => {
		const h = harness();
		h.controller.setCleanupProbe(PROBE_OK);
		expect(h.controller.getState().backend).toBe('ort');
		expect(await h.controller.loadModel()).toBe(true);
		expect(h.spawnedBackends).toEqual(['ort']);
		expect(h.workerCommands).toContainEqual(
			expect.objectContaining({
				type: 'cleanup-load-model',
				manifestUrl: '/models/dtln-onnx/manifest.json'
			})
		);
	});

	it('switching to the LiteRT backend tears down the worker and loads the LiteRT manifest', async () => {
		const h = harness();
		h.controller.setCleanupProbe(PROBE_OK);
		expect(await h.controller.loadModel()).toBe(true);
		expect(h.controller.getState().modelStatus).toBe('loaded');

		h.controller.setBackend('litert');
		const switched = h.controller.getState();
		expect(switched.backend).toBe('litert');
		expect(switched.modelStatus).toBe('not-loaded');
		expect(switched.accelerator).toBeNull();

		expect(await h.controller.loadModel()).toBe(true);
		expect(h.spawnedBackends).toEqual(['ort', 'litert']);
		const loads = h.workerCommands.filter((cmd) => cmd.type === 'cleanup-load-model');
		expect(loads.at(-1)).toEqual(
			expect.objectContaining({ manifestUrl: '/models/dtln/manifest.json' })
		);
	});

	it('tags applied cleanup with the ONNX model id by default', async () => {
		const h = harness();
		h.controller.setCleanupProbe(PROBE_OK);
		expect(await h.controller.applyCleanup({ ...CLIP, durationS: 4 })).toBe(true);
		expect(h.applied[0]!.modelId).toBe('dtln-onnx');
	});

	it('re-selecting the active backend is a no-op that keeps the loaded model', async () => {
		const h = harness();
		h.controller.setCleanupProbe(PROBE_OK);
		expect(await h.controller.loadModel()).toBe(true);
		h.controller.setBackend('ort');
		expect(h.controller.getState().modelStatus).toBe('loaded');
		expect(h.spawnCount()).toBe(1);
	});

	it('runs a preview job over a bounded range and stores A/B buffers', async () => {
		const h = harness();
		h.controller.setCleanupProbe(PROBE_OK);
		expect(await h.controller.previewCleanup(CLIP)).toBe(true);
		expect(h.extractions.length).toBe(1);
		expect(h.extractions[0]!.durationS).toBe(10);
		expect(h.extractions[0]!.sampleRate).toBe(CLEANUP_SAMPLE_RATE);
		const state = h.controller.getState();
		expect(state.job).toBeNull();
		expect(state.preview).not.toBeNull();
		expect(state.preview!.cleaned.length).toBe(128);
		expect(state.preview!.original.length).toBe(10 * CLEANUP_SAMPLE_RATE);
		expect(state.lastAnalysisMs).toBe(42);
	});

	it('applies cleanup end-to-end: windowed extraction → WAV → pipeline apply → undoable state', async () => {
		const h = harness();
		h.controller.setCleanupProbe(PROBE_OK);
		const clip = { ...CLIP, durationS: 12 };
		expect(await h.controller.applyCleanup(clip)).toBe(true);
		expect(h.extractions.map((r) => r.durationS)).toEqual([10, 2]);
		expect(h.applied.length).toBe(1);
		const request = h.applied[0]!;
		expect(request.fileName).toBe('interview.cleaned.wav');
		expect(request.clipInPointS).toBe(1.5);
		expect(request.durationS).toBe(12);
		expect(request.modelId).toBe('dtln-onnx');
		expect(h.controller.getState().job?.phase).toBe('applying');
		h.controller.handlePipelineMessage({
			type: 'audio-cleanup-applied',
			trackId: clip.trackId,
			clipId: clip.clipId,
			ok: true,
			assetId: 'derived-1'
		});
		expect(h.controller.getState().job).toBeNull();
		expect(h.controller.getState().error).toBeNull();
	});

	it('surfaces a failed apply from the pipeline worker', async () => {
		const h = harness();
		h.controller.setCleanupProbe(PROBE_OK);
		await h.controller.applyCleanup({ ...CLIP, durationS: 3 });
		h.controller.handlePipelineMessage({
			type: 'audio-cleanup-applied',
			trackId: CLIP.trackId,
			clipId: CLIP.clipId,
			ok: false,
			message: 'No decodable audio.'
		});
		const state = h.controller.getState();
		expect(state.job).toBeNull();
		expect(state.error).toBe('No decodable audio.');
	});

	it('rejects clips longer than one cleanup pass with a clear error', async () => {
		const h = harness();
		h.controller.setCleanupProbe(PROBE_OK);
		expect(await h.controller.applyCleanup({ ...CLIP, durationS: 1000 })).toBe(false);
		expect(h.controller.getState().error).toMatch(/too long/);
		expect(h.spawnCount()).toBe(0);
	});

	it('cancel during extraction stops the job promptly without an error state', async () => {
		const h = harness();
		h.controller.setCleanupProbe(PROBE_OK);
		h.autoRespond.extraction = false;
		const pending = h.controller.previewCleanup(CLIP);
		await vi.waitFor(() => expect(h.extractions.length).toBe(1));
		h.controller.cancel();
		expect(await pending).toBe(false);
		const state = h.controller.getState();
		expect(state.job).toBeNull();
		expect(state.preview).toBeNull();
		expect(state.error).toBeNull();
	});

	it('a crash during model load drains all waiters instead of hanging them', async () => {
		const h = harness();
		h.controller.setCleanupProbe(PROBE_OK);
		h.autoRespond.modelLoad = false;
		const first = h.controller.loadModel();
		await vi.waitFor(() =>
			expect(h.workerCommands.some((cmd) => cmd.type === 'cleanup-load-model')).toBe(true)
		);
		const second = h.controller.loadModel();
		h.crashWorker('worker died during load');
		expect(await first).toBe(false);
		expect(await second).toBe(false);
		expect(h.controller.getState().modelStatus).toBe('not-loaded');
	});

	it('a crash mid-job stops the extraction loop instead of requesting more windows', async () => {
		const h = harness();
		h.controller.setCleanupProbe(PROBE_OK);
		h.autoRespond.extraction = false;
		const pending = h.controller.previewCleanup(CLIP);
		await vi.waitFor(() => expect(h.extractions.length).toBe(1));
		h.crashWorker('worker died mid-job');
		h.controller.handlePipelineMessage({
			type: 'clip-audio',
			requestId: h.extractions[0]!.requestId,
			pcm: new Float32Array(16000),
			sampleRate: 16000,
			channels: 1,
			clipOffsetS: 0,
			clipDurationS: CLIP.durationS
		});
		expect(await pending).toBe(false);
		expect(h.extractions.length).toBe(1);
		expect(h.controller.getState().job).toBeNull();
	});

	it('a cleanup-worker crash resets the feature without touching the rest of the app', async () => {
		const h = harness();
		h.controller.setCleanupProbe(PROBE_OK);
		expect(await h.controller.loadModel()).toBe(true);
		h.crashWorker('worker died');
		const state = h.controller.getState();
		expect(state.modelStatus).toBe('not-loaded');
		expect(state.job).toBeNull();
		expect(state.error).toBe('worker died');
		expect(h.errors).toEqual(['worker died']);
		expect(await h.controller.loadModel()).toBe(true);
		expect(h.spawnCount()).toBe(2);
	});

	it('reports extraction errors from the pipeline worker as job errors', async () => {
		const h = harness();
		h.controller.setCleanupProbe(PROBE_OK);
		h.autoRespond.extraction = false;
		const pending = h.controller.previewCleanup(CLIP);
		await vi.waitFor(() => expect(h.extractions.length).toBe(1));
		h.controller.handlePipelineMessage({
			type: 'clip-audio-error',
			requestId: h.extractions[0]!.requestId,
			message: 'Clip not found.'
		});
		expect(await pending).toBe(false);
		expect(h.controller.getState().error).toBe('Clip not found.');
		expect(h.controller.getState().job).toBeNull();
	});
});

describe('cleanupActionAvailability', () => {
	it('disables everything with the unavailable message when WASM is unsupported', () => {
		const h = harness();
		h.controller.setCleanupProbe(PROBE_ABSENT);
		const availability = cleanupActionAvailability(h.controller.getState(), CLIP);
		expect(availability.loadModel.enabled).toBe(false);
		expect(availability.preview.enabled).toBe(false);
		expect(availability.apply.enabled).toBe(false);
		expect(availability.loadModel.reason).toBe(CLEANUP_UNAVAILABLE_MESSAGE);
	});

	it('requires a selected audio clip for preview/apply', () => {
		const h = harness();
		h.controller.setCleanupProbe(PROBE_OK);
		const availability = cleanupActionAvailability(h.controller.getState(), null);
		expect(availability.loadModel.enabled).toBe(true);
		expect(availability.preview.enabled).toBe(false);
		expect(availability.preview.reason).toMatch(/Select an audio clip/);
		expect(availability.cancel.enabled).toBe(false);
	});
});

describe('preferredCleanupAccelerator', () => {
	it('uses the probe when one is present', () => {
		expect(preferredCleanupAccelerator(PROBE_WEBNN)).toBe('webnn');
		expect(preferredCleanupAccelerator(PROBE_WEBGPU)).toBe('webgpu');
	});

	it('falls back to wasm when no probe is available yet', () => {
		expect(preferredCleanupAccelerator(null)).toBe('wasm');
	});
});

describe('cleanedFileName', () => {
	it('derives a .cleaned.wav name from the original', () => {
		expect(cleanedFileName('interview.mov')).toBe('interview.cleaned.wav');
		expect(cleanedFileName('noext')).toBe('noext.cleaned.wav');
	});
});
