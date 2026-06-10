import { describe, expect, it, vi } from 'vitest';
import { probeWebNN, webNNAvailable } from './webnn-probe';

function mlWith(supported: Partial<Record<'cpu' | 'gpu' | 'npu', boolean>>): ML {
	return {
		createContext: vi.fn(async (options?: MLContextOptions) => {
			const device = options?.deviceType ?? 'cpu';
			if (supported[device]) {
				return { destroy: vi.fn() } as unknown as MLContext;
			}
			throw new Error(`no ${device} backend`);
		})
	} as unknown as ML;
}

describe('probeWebNN', () => {
	it('reports navigator.ml absent as unsupported backends with unknown model support', async () => {
		const result = await probeWebNN({});
		expect(result.mlPresent).toBe(false);
		expect(result.backends).toEqual({ cpu: 'unsupported', gpu: 'unsupported', npu: 'unsupported' });
		expect(result.modelSupport).toBe('unknown');
	});

	it('probes each backend independently', async () => {
		const result = await probeWebNN({ ml: mlWith({ cpu: true, gpu: true }) });
		expect(result.mlPresent).toBe(true);
		expect(result.backends.cpu).toBe('supported');
		expect(result.backends.gpu).toBe('supported');
		expect(result.backends.npu).toBe('unsupported');
		expect(result.modelSupport).toBe('unknown');
	});

	it('destroys probe contexts and retains nothing', async () => {
		const destroy = vi.fn();
		const ml = {
			createContext: vi.fn(async () => ({ destroy }))
		} as unknown as ML;
		await probeWebNN({ ml });
		expect(destroy).toHaveBeenCalledTimes(3);
	});

	it('maps a throwing navigator.ml accessor to unknown without throwing', async () => {
		const trap = new Proxy(
			{},
			{
				get() {
					throw new Error('blocked');
				}
			}
		) as { ml?: ML };
		const result = await probeWebNN(trap);
		expect(result.modelSupport).toBe('unknown');
		expect(result.mlPresent).toBe(false);
	});

	it('treats a malformed ml object (no createContext) as absent', async () => {
		const result = await probeWebNN({ ml: {} as unknown as ML });
		expect(result.mlPresent).toBe(false);
	});

	it('model support starts unknown and never claims supported from the probe alone', async () => {
		const result = await probeWebNN({ ml: mlWith({ cpu: true, gpu: true, npu: true }) });
		expect(result.modelSupport).toBe('unknown');
	});
});

describe('webNNAvailable', () => {
	it('requires at least one supported backend', async () => {
		expect(webNNAvailable(await probeWebNN({ ml: mlWith({}) }))).toBe(false);
		expect(webNNAvailable(await probeWebNN({ ml: mlWith({ npu: true }) }))).toBe(true);
		expect(webNNAvailable(null)).toBe(false);
		expect(webNNAvailable(undefined)).toBe(false);
	});
});
