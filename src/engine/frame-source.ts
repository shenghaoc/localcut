/**
 * Sequential decoded-frame source (Phase 2).
 *
 * Continuous playback advances a single Mediabunny sink iterator, so each GOP is
 * decoded once instead of re-decoding from the nearest keyframe on every frame
 * (which `VideoSampleSink.getSample` would do — it's documented as sparse access).
 * A backward seek or a large forward jump transparently re-seeks from a keyframe.
 *
 * This keeps the {@link PlaybackController}'s `getFrame(timestamp)` contract
 * unchanged: the optimization lives entirely behind it.
 */

import type { DecodedFrame } from './playback';

/** Structural shape of a decoded sample (satisfied by Mediabunny's VideoSample). */
export interface VideoSampleLike {
  readonly timestamp: number;
  readonly duration: number;
  clone(): VideoSampleLike;
  toVideoFrame(): VideoFrame;
  close(): void;
}

/** Structural shape of a sink yielding samples in presentation order. */
export interface SequentialVideoSource {
  samples(
    startTimestamp?: number,
    endTimestamp?: number,
  ): AsyncGenerator<VideoSampleLike, void, unknown>;
}

/** Forward jumps larger than this (seconds) re-seek from a keyframe instead of scanning. */
const DEFAULT_RESYNC_THRESHOLD_S = 1;

export class SequentialFrameSource {
  private iterator: AsyncGenerator<VideoSampleLike, void, unknown> | null = null;
  /** The sample currently on screen; owned here until we advance past it. */
  private current: VideoSampleLike | null = null;
  /** Timestamp of the held sample (or iterator start), for seek detection. */
  private anchor = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly source: SequentialVideoSource,
    /** Floor for a sample's on-screen duration (guards zero-duration samples). */
    private readonly minFrameDuration = 0,
    private readonly resyncThreshold = DEFAULT_RESYNC_THRESHOLD_S,
  ) {}

  /**
   * Returns the frame visible at `time` as a clone the caller owns and must close.
   * Forward playback advances the active iterator; a backward or large forward jump
   * re-seeks. Returns null past the end of the stream.
   *
   * Calls must not overlap (the playback controller serializes decodes), so the
   * single iterator is never read concurrently.
   */
  async frameAt(time: number): Promise<DecodedFrame | null> {
    if (this.needsResync(time)) {
      this.reset();
      this.iterator = this.source.samples(time);
      this.anchor = time;
    }
    const iterator = this.iterator!;
    while (!this.current || this.endOf(this.current) <= time) {
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
    return this.current ? this.current.clone() : null;
  }

  private endOf(sample: VideoSampleLike): number {
    return sample.timestamp + Math.max(sample.duration, this.minFrameDuration);
  }

  private needsResync(time: number): boolean {
    if (!this.iterator) return true;
    if (this.current && time < this.current.timestamp) return true; // backward jump
    return time - this.anchor > this.resyncThreshold; // large forward jump
  }

  /** Drops the held sample and ends the iterator (on seek-resync and teardown). */
  reset(): void {
    this.current?.close();
    this.current = null;
    void this.iterator?.return?.(undefined);
    this.iterator = null;
    this.anchor = Number.NEGATIVE_INFINITY;
  }
}
