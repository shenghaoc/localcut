import { describe, expect, it } from 'vitest';
import {
  SequentialFrameSource,
  type SequentialVideoSource,
  type VideoSampleLike,
} from './frame-source';

class FakeSample implements VideoSampleLike {
  closed = false;
  constructor(
    readonly timestamp: number,
    readonly duration: number,
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
