import { describe, expect, it } from 'vitest';
import {
	SequentialFrameSource,
	type SequentialVideoSource,
	type VideoSampleLike
} from './frame-source';

class FakeSample implements VideoSampleLike {
	closed = false;
	constructor(
		readonly timestamp: number,
		readonly duration: number
	) {}
	clone(): VideoSampleLike {
		// The clone is what the caller owns; the original is retained by the source.
		return new FakeSample(this.timestamp, this.duration);
	}
	toVideoFrame(): VideoFrame {
		return {} as VideoFrame;
	}
	close(): void {
		this.closed = true;
	}
}

class FakeSource implements SequentialVideoSource {
	readonly starts: number[] = [];
	constructor(private readonly frames: FakeSample[]) {}
	async *samples(startTimestamp = 0): AsyncGenerator<VideoSampleLike, void, unknown> {
		this.starts.push(startTimestamp);
		for (const frame of this.frames) {
			// Mimic Mediabunny: yield from the frame covering startTimestamp onward.
			if (frame.timestamp + frame.duration <= startTimestamp) continue;
			yield frame;
		}
	}
}

// Frames at 0, 0.5, 1.0, 1.5, 2.0 (each 0.5s long).
function makeFrames(): FakeSample[] {
	return [0, 0.5, 1.0, 1.5, 2.0].map((t) => new FakeSample(t, 0.5));
}

describe('SequentialFrameSource', () => {
	it('advances one iterator across forward playback (no re-seek)', async () => {
		const frames = makeFrames();
		const source = new FakeSource(frames);
		const fs = new SequentialFrameSource(source);

		await fs.frameAt(0);
		await fs.frameAt(0.6); // -> frame @0.5
		await fs.frameAt(1.1); // -> frame @1.0

		expect(source.starts).toEqual([0]); // samples() created exactly once
	});

	it('returns the held frame for repeated reads within its interval', async () => {
		const source = new FakeSource(makeFrames());
		const fs = new SequentialFrameSource(source);

		const a = await fs.frameAt(0.1);
		const b = await fs.frameAt(0.2); // still within frame @0

		expect(a).not.toBeNull();
		expect(b).not.toBeNull();
		expect(source.starts).toHaveLength(1); // iterator created once
	});

	it('closes frames it advances past', async () => {
		const frames = makeFrames();
		// Generous resync threshold so the sub-second advance stays sequential.
		const fs = new SequentialFrameSource(new FakeSource(frames), 0, 10);

		await fs.frameAt(0);
		await fs.frameAt(1.1); // advances past frames @0 and @0.5

		expect(frames[0]!.closed).toBe(true);
		expect(frames[1]!.closed).toBe(true);
		expect(frames[2]!.closed).toBe(false); // @1.0 is the held frame
	});

	it('re-seeks on a backward jump', async () => {
		const source = new FakeSource(makeFrames());
		const fs = new SequentialFrameSource(source);

		await fs.frameAt(1.6); // frame @1.5
		await fs.frameAt(0.2); // backward -> new iterator

		expect(source.starts).toEqual([1.6, 0.2]);
	});

	it('re-seeks on a large forward jump beyond the threshold', async () => {
		const source = new FakeSource(makeFrames());
		const fs = new SequentialFrameSource(source, 0, 1); // 1s resync threshold

		await fs.frameAt(0);
		await fs.frameAt(1.9); // 1.9 - 0 > 1 -> re-seek

		expect(source.starts).toEqual([0, 1.9]);
	});

	it('returns null past the end of the stream', async () => {
		const fs = new SequentialFrameSource(new FakeSource([]));
		expect(await fs.frameAt(0)).toBeNull();
	});

	it('returns null when advancing past the last frame', async () => {
		const fs = new SequentialFrameSource(new FakeSource(makeFrames()));

		await fs.frameAt(2.0); // last frame @2.0
		expect(await fs.frameAt(3.0)).toBeNull();
	});

	it('resets the iterator when advancing fails and can recover on the next read', async () => {
		const frames = makeFrames();
		let calls = 0;
		const source: SequentialVideoSource = {
			async *samples(startTimestamp = 0) {
				for (const frame of frames) {
					if (frame.timestamp + frame.duration <= startTimestamp) continue;
					calls += 1;
					if (calls === 2) throw new Error('decode failed');
					yield frame;
				}
			}
		};
		const fs = new SequentialFrameSource(source);

		await fs.frameAt(0);
		await expect(fs.frameAt(1.1)).rejects.toThrow('decode failed');
		expect(await fs.frameAt(1.1)).not.toBeNull();
	});

	it('advances short-duration VFR frames at their actual duration when minFrameDuration is near zero', async () => {
		// Simulates VFR content with alternating 16ms/33ms frames (mixed 30/60fps).
		// With minFrameDuration = 1/30 those 16ms frames would be held for 33ms each,
		// causing the next frame to be skipped. With minFrameDuration = 1e-4 each frame
		// advances at its actual reported duration.
		const frames = [
			new FakeSample(0, 0.016),
			new FakeSample(0.016, 0.033),
			new FakeSample(0.049, 0.016),
			new FakeSample(0.065, 0.033)
		];
		const fs = new SequentialFrameSource(new FakeSource(frames), 1e-4, 10);

		const f0 = await fs.frameAt(0);
		const f1 = await fs.frameAt(0.016); // short frame ends at 0.016+1e-4; must advance
		const f2 = await fs.frameAt(0.049); // must reach frame @0.049, not stay on @0.016

		expect((f0 as FakeSample).timestamp).toBe(0);
		expect((f1 as FakeSample).timestamp).toBe(0.016);
		expect((f2 as FakeSample).timestamp).toBe(0.049);
	});

	it('holds short-duration frames for the nominal interval when minFrameDuration = 1/fps (CFR)', async () => {
		// CFR path: a 16ms frame at 30fps nominal is held for 33ms; the iterator
		// must NOT advance at 16ms.
		const frames = [new FakeSample(0, 0.016), new FakeSample(0.016, 0.033)];
		const fs = new SequentialFrameSource(new FakeSource(frames), 1 / 30, 10);

		const f0 = await fs.frameAt(0);
		const fStill = await fs.frameAt(0.016); // still within the 33ms nominal window
		const f1 = await fs.frameAt(1 / 30 + 0.001); // just past the 33ms window

		expect((f0 as FakeSample).timestamp).toBe(0);
		expect((fStill as FakeSample).timestamp).toBe(0); // still frame 0
		expect((f1 as FakeSample).timestamp).toBe(0.016); // now frame 1
	});

	it('reset() closes the held frame and forces a re-seek', async () => {
		const frames = makeFrames();
		const source = new FakeSource(frames);
		const fs = new SequentialFrameSource(source);

		await fs.frameAt(0);
		fs.reset();
		expect(frames[0]!.closed).toBe(true);

		await fs.frameAt(0.2);
		expect(source.starts).toEqual([0, 0.2]);
	});
});
