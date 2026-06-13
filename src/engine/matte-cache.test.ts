import { describe, expect, it, vi } from 'vite-plus/test';
import { MatteCache } from './matte-cache';

function texture(): GPUTexture & { destroy: ReturnType<typeof vi.fn> } {
	return {
		createView: vi.fn(() => ({}) as GPUTextureView),
		destroy: vi.fn()
	} as unknown as GPUTexture & { destroy: ReturnType<typeof vi.fn> };
}

describe('MatteCache', () => {
	it('budgets r8unorm alpha textures at one byte per pixel', () => {
		const cache = new MatteCache({ maxBytes: 2 });
		const first = texture();
		const second = texture();
		const third = texture();

		cache.set('clip:0', first, 1, 1);
		cache.set('clip:1', second, 1, 1);
		expect(cache.size).toBe(2);
		expect(cache.bytesInUse).toBe(2);

		cache.set('clip:2', third, 1, 1);

		expect(first.destroy).toHaveBeenCalledTimes(1);
		expect(second.destroy).not.toHaveBeenCalled();
		expect(third.destroy).not.toHaveBeenCalled();
		expect(cache.size).toBe(2);
		expect(cache.bytesInUse).toBe(2);
	});
});
