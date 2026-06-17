import { describe, expect, it } from 'vite-plus/test';

import { DEFAULT_MATTE_BACKEND, resolveMatteBackend } from './matte-backend';

describe('resolveMatteBackend (feature flag)', () => {
	it('defaults to the deployed LiteRT MediaPipe backend', () => {
		expect(DEFAULT_MATTE_BACKEND).toBe('litert');
		expect(resolveMatteBackend(false)).toBe('litert');
	});

	it('selects the experimental ORT/ONNX backend only when the spike flag is on', () => {
		expect(resolveMatteBackend(true)).toBe('ort-onnx');
	});
});
