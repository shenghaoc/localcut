import { describe, expect, it } from 'vite-plus/test';
import type { WebNNProbeResult } from '../../protocol';
import { asrAvailable, probeAsr } from './asr-probe';

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
	it('does not expose WebNN as an available engine until a real runtime lands', () => {
		const result = probeAsr(WEBNN_READY);

		expect(result.webnn.modelSupport).toBe('supported');
		expect(result.recommended).toBe('none');
		expect(asrAvailable(result)).toBe(false);
	});

	it('reports unavailable when WebNN is absent', () => {
		const result = probeAsr(WEBNN_ABSENT);

		expect(result.recommended).toBe('none');
		expect(asrAvailable(result)).toBe(false);
	});

	it('does not carry any Browser SpeechRecognition signal', () => {
		// The removed Chrome Speech fallback must leave no probe surface behind.
		const result = probeAsr(WEBNN_READY);

		expect(Object.keys(result)).not.toContain('speechRecognition');
	});
});
