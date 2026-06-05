import { describe, expect, it, vi } from 'vitest';
import { SequentialAudioSource, type AudioSampleLike } from './audio-source';

class MockAudioSample implements AudioSampleLike {
  readonly duration: number;
  readonly close = vi.fn();

  constructor(
    readonly timestamp: number,
    readonly sampleRate: number,
    private readonly data: Float32Array,
    private readonly channels = 1,
  ) {
    this.duration = this.numberOfFrames / sampleRate;
  }

  get numberOfFrames(): number {
    return this.data.length / this.channels;
  }

  allocationSize(): number {
    return this.data.byteLength;
  }

  copyTo(destination: Float32Array): void {
    destination.set(this.data);
  }
}

describe('SequentialAudioSource', () => {
  it('returns exact PCM windows across decoded sample boundaries', async () => {
    const samples = [
      new MockAudioSample(0, 4, new Float32Array([0, 1, 2, 3])),
      new MockAudioSample(1, 4, new Float32Array([4, 5, 6, 7])),
    ];
    const source = new SequentialAudioSource(
      {
        async *samples() {
          for (const sample of samples) yield sample;
        },
      },
      4,
    );

    const window = await source.pcmWindowAt(0.5, 4, 1);

    expect([...window]).toEqual([2, 3, 4, 5]);
    expect(samples[0]!.close).toHaveBeenCalled();
  });

  it('fills gaps with silence before the next decoded sample', async () => {
    const source = new SequentialAudioSource(
      {
        async *samples() {
          yield new MockAudioSample(1, 4, new Float32Array([4, 5, 6, 7]));
        },
      },
      4,
    );

    const window = await source.pcmWindowAt(0.5, 4, 1);

    expect([...window]).toEqual([0, 0, 4, 5]);
  });
});
