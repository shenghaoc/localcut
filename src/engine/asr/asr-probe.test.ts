import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { WebNNProbeResult } from '../../protocol';
import { probeAsr } from './asr-probe';

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

describe('probeAsr', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('does not expose placeholder WebNN ASR as an available engine', () => {
		const result = probeAsr(WEBNN_READY);

		expect(result.webnn.modelSupport).toBe('supported');
		expect(result.recommended).toBe('none');
	});

	it('reports Browser SpeechRecognition but does not select it for clip transcription', () => {
		vi.stubGlobal('SpeechRecognition', class {});

		const result = probeAsr(WEBNN_ABSENT);

		expect(result.speechRecognition).toBe('supported');
		expect(result.recommended).toBe('none');
	});

	it('reports unavailable when neither WebNN nor Browser SpeechRecognition is available', () => {
		const result = probeAsr(WEBNN_ABSENT);

		expect(result.speechRecognition).toBe('unsupported');
		expect(result.recommended).toBe('none');
	});
});
