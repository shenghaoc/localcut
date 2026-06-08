import { describe, expect, it, vi } from 'vitest';
import { StillFrameSource, type StillFrameLike } from './still-source';

function makeBase() {
	const close = vi.fn();
	const clones: Array<{ close: ReturnType<typeof vi.fn> }> = [];
	const base: StillFrameLike = {
		close,
		clone: vi.fn(() => {
			const clone = { close: vi.fn() };
			clones.push(clone);
			return clone as unknown as VideoFrame;
		})
	};
	return { base, close, clones };
}

describe('StillFrameSource', () => {
	it('serves a clone of the base frame for any timestamp', async () => {
		const { base } = makeBase();
		const source = new StillFrameSource(base);

		const a = await source.frameAt(0);
		const b = await source.frameAt(123.4);

		expect(a).not.toBeNull();
		expect(b).not.toBeNull();
		// Each frameAt() yields a fresh clone (the caller owns it).
		expect(a!.toVideoFrame()).not.toBe(b!.toVideoFrame());
	});

	it('never closes the base frame from a decoded frame (close() is a no-op)', async () => {
		const { base, close } = makeBase();
		const source = new StillFrameSource(base);

		const decoded = await source.frameAt(0);
		decoded!.close();
		source.reset();

		expect(close).not.toHaveBeenCalled();
	});

	it('closes the base exactly once on dispose and then serves null', async () => {
		const { base, close } = makeBase();
		const source = new StillFrameSource(base);

		expect(await source.frameAt(0)).not.toBeNull();
		source.dispose();
		source.dispose(); // idempotent

		expect(close).toHaveBeenCalledTimes(1);
		expect(await source.frameAt(0)).toBeNull();
	});
});
