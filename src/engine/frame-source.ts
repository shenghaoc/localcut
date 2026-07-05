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
		endTimestamp?: number
	): AsyncGenerator<VideoSampleLike, void, unknown>;
}

/**
 * The contract playback/export depend on for any video-bearing source. Both the
 * sequential decoder ({@link SequentialFrameSource}) and the still source
 * implement it so a still placed on a video track is a drop-in for a clip.
 */
export interface VideoFrameProvider {
	frameAt(time: number): Promise<DecodedFrame | null>;
	reset(): void;
}

/**
 * Phase 27 transition readahead primitive: two independent decode streams, each
 * with its own iterator and seek position, so the compositor can readahead two
 * different timestamps concurrently without sharing iterator state.
 */
export class DualStreamFrameSource {
	constructor(
		private readonly streamA: VideoFrameProvider,
		private readonly streamB: VideoFrameProvider
	) {}

	async frameAtA(time: number): Promise<DecodedFrame | null> {
		return this.streamA.frameAt(time);
	}

	async frameAtB(time: number): Promise<DecodedFrame | null> {
		return this.streamB.frameAt(time);
	}

	reset(): void {
		this.streamA.reset();
		this.streamB.reset();
	}

	dispose(): void {
		this.reset();
	}
}

/** Forward jumps larger than this (seconds) re-seek from a keyframe instead of scanning. */
const DEFAULT_RESYNC_THRESHOLD_S = 1;

export class SequentialFrameSource implements VideoFrameProvider {
	private iterator: AsyncGenerator<VideoSampleLike, void, unknown> | null = null;
	/** The sample currently on screen; owned here until we advance past it. */
	private current: VideoSampleLike | null = null;
	/** Timestamp of the held sample (or iterator start), for seek detection. */
	private anchor = Number.NEGATIVE_INFINITY;

	constructor(
		private readonly source: SequentialVideoSource,
		/** Floor for a sample's on-screen duration (guards zero-duration samples). */
		private readonly minFrameDuration = 0,
		private readonly resyncThreshold = DEFAULT_RESYNC_THRESHOLD_S
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
		try {
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
		} catch (error) {
			this.reset();
			throw error;
		}
		if (this.current && this.endOf(this.current) > time) {
			return this.current.clone();
		}
		return null;
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

/** Structural slice of MediaInputHandle the pool needs (avoids an import cycle). */
export interface SecondarySinkHandle {
	readonly sourceId: string;
	readonly frameSource: VideoFrameProvider | null;
	readonly createSecondaryFrameSource?: () => VideoFrameProvider | null;
}

/**
 * Lazily opens at most one secondary decode sink per source (Phase 13 T2.2).
 *
 * When a transition straddles two clips cut from the *same* source, the outgoing
 * and incoming layers decode at timestamps far apart on every frame of the
 * window; a single {@link SequentialFrameSource} would keyframe-re-seek each
 * call. Routing the incoming layer through a dedicated secondary sink keeps both
 * iterators sequential. Sources that cannot open one (stills, handles without
 * the factory) fall back to the primary provider, which stays correct — just
 * slower.
 */
export class SecondaryFrameSourcePool {
	private readonly providers = new Map<string, VideoFrameProvider>();

	/** Returns the source's secondary provider, creating it on first use. */
	acquire(handle: SecondarySinkHandle): VideoFrameProvider | null {
		const existing = this.providers.get(handle.sourceId);
		if (existing) return existing;
		const created = handle.createSecondaryFrameSource?.() ?? null;
		if (created) {
			this.providers.set(handle.sourceId, created);
			return created;
		}
		return handle.frameSource;
	}

	/** Drops the secondary for one source (when its handle is disposed/removed). */
	release(sourceId: string): void {
		const provider = this.providers.get(sourceId);
		if (!provider) return;
		provider.reset();
		this.providers.delete(sourceId);
	}

	/** Resets and forgets every secondary sink (teardown, end of export). */
	disposeAll(): void {
		for (const provider of this.providers.values()) provider.reset();
		this.providers.clear();
	}
}
