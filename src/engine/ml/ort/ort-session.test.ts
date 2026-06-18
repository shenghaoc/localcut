import { describe, expect, it } from 'vite-plus/test';

import { resolveDeviceOwner } from './ort-session';

describe('resolveDeviceOwner', () => {
	it('always reports ort-webgpu for a WebGPU-primary session (ORT owns the device)', () => {
		// ORT cannot adopt an externally-created GPUDevice (known limitation), so a
		// WebGPU session is always ORT-owned; the renderer adopts ORT's device.
		expect(resolveDeviceOwner('webgpu', false)).toBe('ort-webgpu');
		expect(resolveDeviceOwner('webgpu', true)).toBe('ort-webgpu');
	});

	it('reports webnn-context when WebNN is primary with an MLContext', () => {
		expect(resolveDeviceOwner('webnn', true)).toBe('webnn-context');
	});

	it('is undefined for WebNN primary without an MLContext', () => {
		expect(resolveDeviceOwner('webnn', false)).toBeUndefined();
	});

	it('is undefined for a deviceless WASM session', () => {
		expect(resolveDeviceOwner('wasm', false)).toBeUndefined();
		expect(resolveDeviceOwner('wasm', true)).toBeUndefined();
	});
});
