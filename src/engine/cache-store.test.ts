import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCacheStore, opaqueCachePath } from './cache-store';

describe('opaqueCachePath', () => {
	it('derives sanitized opaque paths instead of preserving source names', () => {
		const path = opaqueCachePath('proxy files', 'Vacation Raw Footage.mov', 'mp4!');

		expect(path).toMatch(/^proxy-files\/[0-9a-f]{64}\.mp4$/);
		expect(path).not.toContain('Vacation');
		expect(path).not.toContain('Footage');
	});
});

describe('createCacheStore', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('falls back when OPFS exists but getDirectory throws', async () => {
		const getDirectory = vi.fn(async () => {
			throw new Error('OPFS unavailable in this context.');
		});
		vi.stubGlobal('navigator', {
			storage: {
				getDirectory,
				estimate: async () => ({ usage: 0, quota: 1024 })
			}
		});

		await expect(createCacheStore()).resolves.toMatchObject({});
		expect(getDirectory).toHaveBeenCalledTimes(1);
	});
});
