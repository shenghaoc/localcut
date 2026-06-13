import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type {
	AsrProbeResult,
	AsrWorkerCommand,
	AsrWorkerState,
	WebNNProbeResult
} from '../protocol';
import { ASR_UNAVAILABLE_MESSAGE } from '../engine/asr/asr-probe';
import {
	AsrController,
	ASR_EMPTY_TRANSCRIPT_MESSAGE,
	type AsrControllerState,
	type ClipAudioRequest
} from './asr-controller';

const WEBNN_READY: WebNNProbeResult = {
	mlPresent: true,
	backends: { cpu: 'supported', gpu: 'unsupported', npu: 'unsupported' },
	modelSupport: 'supported'
};

const WEBNN_ABSENT: WebNNProbeResult = {
	mlPresent: false,
	backends: { cpu: 'unsupported', gpu: 'unsupported', npu: 'unsupported' },
	modelSupport: 'unknown'
};

const WEBNN_PROBE: AsrProbeResult = {
	webnn: WEBNN_READY,
	recommended: 'webnn-whisper'
};

interface Harness {
	controller: AsrController;
	commands: AsrWorkerCommand[];
	extractions: ClipAudioRequest[];
	createCaptionTrack: ReturnType<typeof vi.fn>;
	postState: (msg: AsrWorkerState) => void;
	spawnCount: () => number;
}

interface MutableController {
	state: AsrControllerState;
}

function flushMicrotasks(): Promise<void> {
	return Promise.resolve().then(() => undefined);
}

async function flushUntil(assertion: () => void): Promise<void> {
	let lastError: unknown = null;
	for (let i = 0; i < 20; i += 1) {
		try {
			assertion();
			return;
		} catch (error) {
			lastError = error;
			await flushMicrotasks();
		}
	}
	if (lastError) throw lastError;
}

function harness(): Harness {
	let spawns = 0;
	let postState: (msg: AsrWorkerState) => void = () => undefined;
	const commands: AsrWorkerCommand[] = [];
	const extractions: ClipAudioRequest[] = [];
	const createCaptionTrack = vi.fn();

	const controller = new AsrController({
		spawnWorker: async (onState) => {
			spawns += 1;
			postState = onState;
			return {
				send(cmd) {
					commands.push(cmd);
				},
				terminate: vi.fn()
			};
		},
		requestClipAudio: (request) => {
			extractions.push(request);
		},
		createCaptionTrack
	});

	return {
		controller,
		commands,
		extractions,
		createCaptionTrack,
		postState: (msg) => postState(msg),
		spawnCount: () => spawns
	};
}

function forceWebNNState(controller: AsrController): void {
	(controller as unknown as MutableController).state = {
		...controller.getState(),
		probe: WEBNN_PROBE,
		available: true,
		recommendedEngine: 'webnn-whisper'
	};
}

describe('AsrController', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('does not make Auto Captions available from WebNN or Browser SpeechRecognition probes', async () => {
		vi.stubGlobal('SpeechRecognition', class {});
		const h = harness();

		h.controller.setProbe(WEBNN_READY);

		expect(h.controller.getState().available).toBe(false);
		expect(h.controller.getState().recommendedEngine).toBe('none');
		expect(h.spawnCount()).toBe(0);

		await expect(
			h.controller.transcribeClip({
				trackId: 'track-1',
				clipId: 'clip-1',
				durationS: 1,
				fileName: 'speech.mp4'
			})
		).resolves.toBe(false);
		expect(h.controller.getState().error).toBe(ASR_UNAVAILABLE_MESSAGE);
		expect(h.createCaptionTrack).not.toHaveBeenCalled();
	});

	it('rejects empty transcript results instead of creating an empty caption track', async () => {
		const h = harness();
		forceWebNNState(h.controller);

		await expect(h.controller.loadModel()).resolves.toBe(true);
		h.postState({
			type: 'asr-model-status',
			status: 'loaded',
			engine: 'webnn-whisper',
			backend: 'cpu',
			sizeBytes: 77_700_000
		});

		const transcribe = h.controller.transcribeClip(
			{
				trackId: 'track-1',
				clipId: 'clip-1',
				durationS: 1,
				fileName: 'speech.mp4'
			},
			'en'
		);

		await flushUntil(() => expect(h.extractions).toHaveLength(1));
		h.controller.handlePipelineMessage({
			type: 'clip-audio',
			requestId: h.extractions[0]!.requestId,
			pcm: new Float32Array(16_000),
			sampleRate: 16_000,
			channels: 1,
			clipOffsetS: 0,
			clipDurationS: 1
		});

		await flushUntil(() =>
			expect(h.commands.some((cmd) => cmd.type === 'asr-transcribe')).toBe(true)
		);
		const transcribeCommand = h.commands.find((cmd) => cmd.type === 'asr-transcribe');
		expect(transcribeCommand?.type).toBe('asr-transcribe');
		if (transcribeCommand?.type === 'asr-transcribe') {
			h.postState({
				type: 'asr-result',
				jobId: transcribeCommand.jobId,
				engine: 'webnn-whisper',
				segments: [],
				language: 'en',
				phraseLevel: false,
				durationMs: 20
			});
		}

		await expect(transcribe).resolves.toBe(false);
		expect(h.createCaptionTrack).not.toHaveBeenCalled();
		expect(h.controller.getState().error).toBe(ASR_EMPTY_TRANSCRIPT_MESSAGE);
	});

	it('keeps unavailable state when no ASR diagnostics are present', () => {
		const h = harness();

		h.controller.setProbe(WEBNN_ABSENT);

		expect(h.controller.getState().available).toBe(false);
		expect(h.controller.getState().recommendedEngine).toBe('none');
	});
});
