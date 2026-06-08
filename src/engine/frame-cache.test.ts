import { describe, expect, it, vi } from 'vitest';
import { FrameCache, makeFrameCacheKey } from './frame-cache';

function makeFrame(width: number, height: number, closeSpy?: ReturnType<typeof vi.fn>) {
	const close = closeSpy ?? vi.fn();
	const frame = {
		codedWidth: width,
		codedHeight: height,
		close,
		clone: vi.fn(() => ({
			codedWidth: width,
			codedHeight: height,
			close: vi.fn(),
			clone: vi.fn()
		}))
	} as unknown as VideoFrame;
	return frame;
}

describe('frame-cache', () => {
	it('returns cached frames by key', () => {
		const cache = new FrameCache({
			maxBytes: 10000,
			estimateBytes: () => 1
		});
		const close = vi.fn();
		const cached = makeFrame(4, 4, close);

		cache.set(makeFrameCacheKey('src', 1), cached);
		expect(cache.size).toBe(1);

		const hit = cache.get(makeFrameCacheKey('src', 1));
		expect(hit).toBeTruthy();
		expect(cache.size).toBe(1);
		hit?.close();
		expect(close).toHaveBeenCalledTimes(0);
	});

	it('evicts the least-recently-used entry when over budget', () => {
		const firstClose = vi.fn();
		const secondClose = vi.fn();
		const thirdClose = vi.fn();

		const cache = new FrameCache({
			maxBytes: 2,
			estimateBytes: () => 1
		});

		const first = makeFrame(4, 4, firstClose);
		const second = makeFrame(4, 4, secondClose);
		const third = makeFrame(4, 4, thirdClose);

		cache.set(makeFrameCacheKey('src', 1), first);
		cache.set(makeFrameCacheKey('src', 2), second);
		expect(cache.size).toBe(2);
		cache.get(makeFrameCacheKey('src', 1));
		cache.set(makeFrameCacheKey('src', 3), third);

		expect(cache.size).toBe(2);
		expect(thirdClose).toHaveBeenCalledTimes(0);
		expect(secondClose).toHaveBeenCalledTimes(1);
	});

	it('closes all cached frames on clear', () => {
		const a = vi.fn();
		const b = vi.fn();
		const cache = new FrameCache({
			maxBytes: 999,
			estimateBytes: () => 1
		});
		cache.set(makeFrameCacheKey('src', 1), makeFrame(1, 1, a));
		cache.set(makeFrameCacheKey('src', 2), makeFrame(1, 1, b));
		cache.clear();

		expect(a).toHaveBeenCalledTimes(1);
		expect(b).toHaveBeenCalledTimes(1);
		expect(cache.size).toBe(0);
	});
});
