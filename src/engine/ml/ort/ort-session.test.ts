import { describe, expect, it } from 'vite-plus/test';

import { resolveDeviceOwner } from './ort-session';

describe('resolveDeviceOwner', () => {
	it('reports renderer when WebGPU is primary and a device is injected', () => {
		expect(resolveDeviceOwner('webgpu', true, false)).toBe('renderer');
	});

	it('reports ort-webgpu when WebGPU is primary and ORT owns the device', () => {
		expect(resolveDeviceOwner('webgpu', false, false)).toBe('ort-webgpu');
	});

	it('reports renderer for WebGPU-primary even if an MLContext is also supplied', () => {
		expect(resolveDeviceOwner('webgpu', true, true)).toBe('renderer');
	});

	it('reports webnn-context when WebNN is primary with an MLContext', () => {
		expect(resolveDeviceOwner('webnn', false, true)).toBe('webnn-context');
	});

	it('keeps webnn-context when WebNN is primary even with a fallback WebGPU device', () => {
		// The regression Codex flagged: a ['webnn','webgpu'] model given both an
		// MLContext and a renderer device must not be mislabeled 'renderer'.
		expect(resolveDeviceOwner('webnn', true, true)).toBe('webnn-context');
	});

	it('is undefined for WebNN primary without an MLContext', () => {
		expect(resolveDeviceOwner('webnn', false, false)).toBeUndefined();
		expect(resolveDeviceOwner('webnn', true, false)).toBeUndefined();
	});

	it('is undefined for a deviceless WASM session', () => {
		expect(resolveDeviceOwner('wasm', false, false)).toBeUndefined();
		expect(resolveDeviceOwner('wasm', true, true)).toBeUndefined();
	});
});
