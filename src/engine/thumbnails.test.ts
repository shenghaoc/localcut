/* eslint-disable typescript/unbound-method -- vi.fn() mock accessors are unbound by design */
import { describe, expect, it, vi } from 'vite-plus/test';
import { ThumbnailGenerator, thumbnailBucket, type ThumbnailResult } from './thumbnails';

function makeFrame() {
	return { close: vi.fn() } as unknown as VideoFrame;
}

function makeBitmap(width = 160, height = 90) {
	return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('thumbnailBucket', () => {
	it('rounds to the millisecond and floors at zero', () => {
		expect(thumbnailBucket(1.23456)).toBe(1.235);
		expect(thumbnailBucket(-5)).toBe(0);
	});
});

describe('ThumbnailGenerator', () => {
	it('decodes, downscales, emits, and closes each frame exactly once', async () => {
		const frames: VideoFrame[] = [];
		const emitted: ThumbnailResult[] = [];
		const gen = new ThumbnailGenerator({
			decode: async () => {
				const frame = makeFrame();
				frames.push(frame);
				return frame;
			},
			toBitmap: async () => makeBitmap(120, 80),
			emit: (result) => emitted.push(result),
			targetWidth: 120
		});

		gen.request('src', [0, 1, 2]);
		await flush();

		expect(emitted).toHaveLength(3);
		expect(emitted.map((e) => e.width)).toEqual([120, 120, 120]);
		expect(frames).toHaveLength(3);
		for (const frame of frames) {
			expect(frame.close).toHaveBeenCalledTimes(1);
		}
	});

	it('deduplicates repeated timestamps for the same source', async () => {
		const decode = vi.fn(async () => makeFrame());
		const gen = new ThumbnailGenerator({
			decode,
			toBitmap: async () => makeBitmap(),
			emit: () => {}
		});

		gen.request('src', [0.5, 0.5, 0.5004]); // all bucket to 0.5
		await flush();

		expect(decode).toHaveBeenCalledTimes(1);
	});

	it('never exceeds the configured concurrency', async () => {
		let active = 0;
		let peak = 0;
		let release: (() => void) | undefined;
		const gate = () => new Promise<void>((resolve) => (release = resolve));

		const gen = new ThumbnailGenerator({
			decode: async () => {
				active += 1;
				peak = Math.max(peak, active);
				await gate();
				active -= 1;
				return makeFrame();
			},
			toBitmap: async () => makeBitmap(),
			emit: () => {},
			concurrency: 2
		});

		gen.request('src', [0, 1, 2, 3]);
		await flush();
		expect(gen.active).toBe(2);
		// Release everything in flight; the queue drains in concurrency-bounded waves.
		for (let i = 0; i < 6; i += 1) {
			release?.();
			await flush();
		}
		expect(peak).toBe(2);
	});

	it('drops queued requests for a cancelled source', async () => {
		let release: (() => void) | undefined;
		const decode = vi.fn(async () => {
			await new Promise<void>((resolve) => (release = resolve));
			return makeFrame();
		});
		const gen = new ThumbnailGenerator({
			decode,
			toBitmap: async () => makeBitmap(),
			emit: () => {},
			concurrency: 1
		});

		gen.request('src', [0, 1, 2]);
		await flush();
		expect(gen.active).toBe(1); // one decode gated, two queued
		gen.cancelSource('src');
		expect(gen.queued).toBe(0);
		release?.();
		await flush();
		expect(decode).toHaveBeenCalledTimes(1); // queued two never started
	});
});
