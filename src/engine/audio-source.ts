/** Sequential decoded-audio source for real-time PCM pumping (Phase 5). */

export interface AudioSampleLike {
  readonly timestamp: number;
  readonly duration: number;
  readonly numberOfFrames: number;
  allocationSize(options: { format: 'f32'; planeIndex: number }): number;
  copyTo(destination: Float32Array, options: { format: 'f32'; planeIndex: number }): void;
  close(): void;
}

export interface AudioSampleStream {
  samples(
    startTimestamp?: number,
    endTimestamp?: number,
  ): AsyncGenerator<AudioSampleLike, void, unknown>;
}

const DEFAULT_RESYNC_THRESHOLD_S = 0.5;

export class SequentialAudioSource {
  private iterator: AsyncGenerator<AudioSampleLike, void, unknown> | null = null;
  private current: AudioSampleLike | null = null;
  private anchor = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly source: AudioSampleStream,
    private readonly resyncThreshold = DEFAULT_RESYNC_THRESHOLD_S,
  ) {}

  private needsResync(time: number): boolean {
    if (!this.iterator) return true;
    if (time + 1e-6 < this.anchor) return true;
    return time - this.anchor > this.resyncThreshold;
  }

  reset(): void {
    this.iterator = null;
    this.current?.close();
    this.current = null;
    this.anchor = Number.NEGATIVE_INFINITY;
  }

  /**
   * Returns interleaved f32 PCM for samples overlapping `time`, or null past EOF.
   * The caller owns the returned buffer.
   */
  async pcmAt(time: number, channels: number): Promise<Float32Array | null> {
    if (this.needsResync(time)) {
      this.reset();
      this.iterator = this.source.samples(time);
      this.anchor = time;
    }
    const iterator = this.iterator!;
    try {
      while (!this.current || this.current.timestamp + this.current.duration <= time + 1e-6) {
        const next = await iterator.next();
        if (next.done) {
          this.current?.close();
          this.current = null;
          break;
        }
        this.current?.close();
        this.current = next.value;
        this.anchor = next.value.timestamp;
      }
    } catch (error) {
      this.reset();
      throw error;
    }
    if (!this.current) return null;

    const bytes = this.current.allocationSize({ format: 'f32', planeIndex: 0 });
    const floats = new Float32Array(bytes / 4);
    this.current.copyTo(floats, { format: 'f32', planeIndex: 0 });
    if (channels <= 1) {
      const sourceChannels = Math.round(floats.length / this.current.numberOfFrames);
      if (sourceChannels <= 1) {
        return floats;
      }
      const mono = new Float32Array(this.current.numberOfFrames);
      for (let i = 0; i < mono.length; i += 1) {
        mono[i] = floats[i * sourceChannels] ?? 0;
      }
      return mono;
    }
    if (floats.length >= this.current.numberOfFrames * channels) {
      return floats.slice(0, this.current.numberOfFrames * channels);
    }
    const out = new Float32Array(this.current.numberOfFrames * channels);
    out.set(floats.subarray(0, out.length));
    return out;
  }

  dispose(): void {
    this.reset();
  }

  /** Samples the start of the stream for waveform peak buckets. */
  async collectPeaks(maxSeconds: number, bucketCount: number): Promise<Float32Array> {
    const { computeWaveformPeaks } = await import('./waveform');
    const chunks: number[] = [];
    let frames = 0;
    const maxFrames = Math.max(1, Math.floor(maxSeconds * 48_000));
    this.reset();
    const iterator = this.source.samples(0, maxSeconds);
    try {
      for await (const sample of iterator) {
        const bytes = sample.allocationSize({ format: 'f32', planeIndex: 0 });
        const buf = new Float32Array(bytes / 4);
        sample.copyTo(buf, { format: 'f32', planeIndex: 0 });
        for (let i = 0; i < buf.length; i += 1) chunks.push(buf[i]!);
        frames += sample.numberOfFrames;
        sample.close();
        if (frames >= maxFrames) break;
      }
    } catch {
      return computeWaveformPeaks(new Float32Array(0), bucketCount);
    }
    return computeWaveformPeaks(new Float32Array(chunks), bucketCount);
  }
}
