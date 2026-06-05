/** Preview playback loop, transport, and adaptive-resolution policy (Phase 2). */

import type { PreviewResolution } from '../protocol';

/** Minimal decoded-frame shape consumed by playback (satisfied by Mediabunny's VideoSample). */
export interface DecodedFrame {
  toVideoFrame(): VideoFrame;
  close(): void;
}

/** Clamp a requested time to [0, duration]. Negative durations are treated as 0. */
export function clampTime(time: number, duration: number): number {
  if (Number.isNaN(time)) return 0;
  const max = duration > 0 ? duration : 0;
  return Math.min(Math.max(0, time), max);
}

/** Target time for a one-frame step in `direction` (+1 forward, -1 back). */
export function frameStepTarget(
  currentTime: number,
  direction: 1 | -1,
  frameRate: number,
  duration: number,
): number {
  const fps = frameRate > 0 ? frameRate : 30;
  return clampTime(currentTime + direction / fps, duration);
}

/**
 * Preview-resolution ladder, capped at 1080p (preview never exceeds it) and never
 * upscaling beyond the source. Always returns at least one tier.
 */
export function buildPreviewLadder(srcWidth: number, srcHeight: number): PreviewResolution[] {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  if (srcWidth <= 0 || srcHeight <= 0) {
    return [{ width: 1280, height: 720, label: '720p' }];
  }

  const aspect = srcWidth / srcHeight;
  const tiers: PreviewResolution[] = [];
  for (const height of [1080, 720, 540]) {
    if (height > srcHeight) continue;
    tiers.push({ width: even(height * aspect), height, label: `${height}p` });
  }
  if (tiers.length === 0) {
    tiers.push({ width: even(srcWidth), height: even(srcHeight), label: `${srcHeight}p` });
  }
  return tiers;
}

/**
 * Walks down the preview ladder when frames consistently blow the budget. Downgrade
 * only (matches spec): once dropped, the tier stays until the next import.
 */
export class AdaptiveResolution {
  private index = 0;
  private slowStreak = 0;

  constructor(
    private readonly tiers: PreviewResolution[],
    private readonly budgetMs = 33,
    private readonly streakThreshold = 8,
  ) {}

  current(): PreviewResolution {
    return this.tiers[this.index]!;
  }

  /** Records a frame's wall time; returns the new tier if a downgrade occurred. */
  record(frameMs: number): PreviewResolution | null {
    if (this.index >= this.tiers.length - 1) return null;
    if (frameMs > this.budgetMs) {
      this.slowStreak += 1;
      if (this.slowStreak >= this.streakThreshold) {
        this.index += 1;
        this.slowStreak = 0;
        return this.tiers[this.index]!;
      }
    } else if (this.slowStreak > 0) {
      this.slowStreak -= 1;
    }
    return null;
  }
}

/** Dev-only watchdog: warns if a decoded frame stays open longer than a frame period. */
class FrameLeakTracker {
  private open = new Map<number, number>();
  private nextId = 0;
  private readonly enabled: boolean;
  private readonly framePeriodMs: number;

  constructor(frameRate: number) {
    this.enabled = Boolean(import.meta.env?.DEV);
    this.framePeriodMs = 1000 / (frameRate > 0 ? frameRate : 30);
  }

  track(): number {
    if (!this.enabled) return -1;
    const id = this.nextId++;
    this.open.set(id, performance.now());
    return id;
  }

  release(id: number): void {
    if (!this.enabled || id < 0) return;
    this.open.delete(id);
  }

  sweep(): void {
    if (!this.enabled) return;
    const now = performance.now();
    for (const [id, opened] of this.open) {
      if (now - opened > this.framePeriodMs) {
        console.warn(
          `[frame-leak] VideoFrame #${id} open ${(now - opened).toFixed(1)}ms ` +
            `(> ${this.framePeriodMs.toFixed(1)}ms frame period)`,
        );
        this.open.delete(id);
      }
    }
  }
}

export interface PlaybackDeps {
  duration: number;
  frameRate: number;
  /** Decode the frame at `timestamp` (keyframe-accurate); null if unavailable. */
  getFrame: (timestamp: number) => Promise<DecodedFrame | null>;
  /** Present a decoded frame to the canvas. */
  renderFrame: (frame: VideoFrame) => void;
  /** Write [currentTime, playing] to the shared clock. */
  writeClock: (currentTime: number, playing: boolean) => void;
  /** Per-frame wall time (decode + render), for adaptive resolution. */
  onFrameTime?: (ms: number) => void;
  /** Called when decode/render fails during playback so transport can recover. */
  onPlaybackError?: (error: unknown) => void;
  /** Injectable for tests. */
  now?: () => number;
  scheduler?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearScheduler?: (handle: ReturnType<typeof setTimeout>) => void;
}

/**
 * Wall-clock-driven preview transport. The worker is the sole writer of the shared
 * clock; the main thread reads it in rAF. The loop is real-time: if decode+render
 * lags, frames are skipped rather than slowing playback (audio becomes master in
 * Phase 5). All decoded frames are closed exactly once.
 */
export class PlaybackController {
  private readonly deps: PlaybackDeps;
  private readonly now: () => number;
  private readonly scheduler: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearScheduler: (handle: ReturnType<typeof setTimeout>) => void;
  private readonly leaks: FrameLeakTracker;

  private playing = false;
  private currentTime = 0;
  /** Bumped to cancel any in-flight loop / scheduled tick. */
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  /** Serializes decodes so overlapping seeks never issue concurrent sink reads. */
  private decodeChain: Promise<void> = Promise.resolve();

  constructor(deps: PlaybackDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => performance.now());
    this.scheduler = deps.scheduler ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearScheduler = deps.clearScheduler ?? ((h) => clearTimeout(h));
    this.leaks = new FrameLeakTracker(deps.frameRate);
    if (import.meta.env?.DEV) {
      this.sweepTimer = setInterval(() => this.leaks.sweep(), 250);
    }
  }

  getCurrentTime(): number {
    return this.currentTime;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Decode + render a single frame at `time`, closing every resource it touches.
   * Calls are serialized through {@link decodeChain} so a seek can never trigger a
   * concurrent read on the (non-reentrant) sink. The generation captured here is
   * re-checked once the chain reaches this request, so obsolete decodes queued
   * during rapid scrubbing are skipped instead of run.
   */
  private renderAt(time: number): Promise<void> {
    const gen = this.generation;
    const next = this.decodeChain.then(() => {
      if (gen !== this.generation) return;
      return this.decodeAndRender(time, gen);
    });
    this.decodeChain = next.catch(() => {}); // keep the chain alive past failures
    return next;
  }

  private async decodeAndRender(time: number, gen: number): Promise<void> {
    const frame = await this.deps.getFrame(time);
    if (!frame) return;
    if (gen !== this.generation) {
      frame.close();
      return;
    }
    const id = this.leaks.track();
    try {
      const videoFrame = frame.toVideoFrame();
      try {
        this.deps.renderFrame(videoFrame);
      } finally {
        videoFrame.close();
      }
    } finally {
      frame.close();
      this.leaks.release(id);
    }
  }

  /** Fire-and-forget render that routes failures to {@link PlaybackDeps.onPlaybackError}. */
  private renderOnce(time: number): void {
    this.renderAt(time).catch((e) => this.deps.onPlaybackError?.(e));
  }

  play(): void {
    if (this.playing) return;
    if (this.currentTime >= this.deps.duration && this.deps.duration > 0) {
      this.currentTime = 0;
    }
    this.playing = true;
    this.deps.writeClock(this.currentTime, true);
    this.runLoop();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.generation += 1;
    this.cancelTimer();
    this.deps.writeClock(this.currentTime, false);
  }

  seek(time: number): void {
    const clamped = clampTime(time, this.deps.duration);
    this.currentTime = clamped;
    this.deps.writeClock(clamped, this.playing);
    if (this.playing) {
      this.runLoop(); // re-anchor from the seeked position
    } else {
      this.generation += 1;
      this.renderOnce(clamped);
    }
  }

  /** Frame-step pauses, then advances one frame in `direction`. */
  step(direction: 1 | -1): void {
    this.playing = false;
    this.cancelTimer();
    this.generation += 1;
    const target = frameStepTarget(
      this.currentTime,
      direction,
      this.deps.frameRate,
      this.deps.duration,
    );
    this.currentTime = target;
    this.deps.writeClock(target, false);
    this.renderOnce(target);
  }

  /** Render the current position once (e.g. first frame after import). */
  refresh(): void {
    this.generation += 1;
    this.renderOnce(this.currentTime);
  }

  dispose(): void {
    this.playing = false;
    this.generation += 1;
    this.cancelTimer();
    if (this.sweepTimer !== null) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.clearScheduler(this.timer);
      this.timer = null;
    }
  }

  /** (Re)starts the real-time loop, anchored at the current position. */
  private runLoop(): void {
    this.generation += 1;
    const gen = this.generation;
    this.cancelTimer();
    const anchorWall = this.now();
    const anchorMedia = this.currentTime;
    const period = 1000 / (this.deps.frameRate > 0 ? this.deps.frameRate : 30);

    const tick = async () => {
      if (!this.playing || gen !== this.generation) return;
      const start = this.now();
      const elapsed = (start - anchorWall) / 1000;
      let target = anchorMedia + elapsed;

      if (this.deps.duration > 0 && target >= this.deps.duration) {
        target = this.deps.duration;
        try {
          await this.renderAt(target);
        } catch (e) {
          if (gen !== this.generation) return;
          this.playing = false;
          this.deps.writeClock(this.currentTime, false);
          this.deps.onPlaybackError?.(e);
          return;
        }
        if (gen !== this.generation) return;
        this.currentTime = target;
        this.playing = false;
        this.deps.writeClock(target, false);
        return;
      }

      try {
        await this.renderAt(target);
      } catch (e) {
        if (gen !== this.generation) return;
        this.playing = false;
        this.deps.writeClock(this.currentTime, false);
        this.deps.onPlaybackError?.(e);
        return;
      }
      if (gen !== this.generation) return;
      this.currentTime = target;
      this.deps.writeClock(target, true);

      const frameMs = this.now() - start;
      this.deps.onFrameTime?.(frameMs);

      const delay = Math.max(0, period - frameMs);
      this.timer = this.scheduler(() => void tick(), delay);
    };

    this.timer = this.scheduler(() => void tick(), 0);
  }
}
