import { describe, expect, it } from 'vite-plus/test';

import { DEFAULT_MATTE_BACKEND, resolveMatteBackend } from './matte-backend';

describe('resolveMatteBackend', () => {
	it('uses ORT/ONNX as the only matte backend', () => {
		expect(DEFAULT_MATTE_BACKEND).toBe('ort-onnx');
		expect(resolveMatteBackend()).toBe('ort-onnx');
	});
});
