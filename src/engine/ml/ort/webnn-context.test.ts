import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { createWebnnContextFromDevice, isWebnnAvailable } from './webnn-context';

const FAKE_DEVICE = {} as GPUDevice;

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('WebNN shared-context helper', () => {
	it('reports unavailable when navigator.ml is absent (clean, no throw)', async () => {
		vi.stubGlobal('navigator', {});
		expect(isWebnnAvailable()).toBe(false);
		const result = await createWebnnContextFromDevice(FAKE_DEVICE);
		expect(result.supported).toBe(false);
		if (!result.supported) expect(result.reason).toMatch(/WebNN/);
	});

	it('creates a context from the GPUDevice when WebNN is present', async () => {
		const context = { id: 'ml-context' };
		const createContext = vi.fn(async () => context);
		vi.stubGlobal('navigator', { ml: { createContext } });
		expect(isWebnnAvailable()).toBe(true);
		const result = await createWebnnContextFromDevice(FAKE_DEVICE);
		expect(result.supported).toBe(true);
		if (result.supported) expect(result.context).toBe(context);
		expect(createContext).toHaveBeenCalledWith(FAKE_DEVICE);
	});

	it('reports unsupported (not throw) when context creation fails', async () => {
		vi.stubGlobal('navigator', {
			ml: {
				createContext: async () => {
					throw new Error('no NPU/GPU backend');
				}
			}
		});
		const result = await createWebnnContextFromDevice(FAKE_DEVICE);
		expect(result.supported).toBe(false);
		if (!result.supported) expect(result.reason).toContain('no NPU/GPU backend');
	});

	it('reports unsupported when createContext yields no context', async () => {
		vi.stubGlobal('navigator', { ml: { createContext: async () => null } });
		const result = await createWebnnContextFromDevice(FAKE_DEVICE);
		expect(result.supported).toBe(false);
	});
});
