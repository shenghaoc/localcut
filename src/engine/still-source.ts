/**
 * Still-image frame source (Phase 11).
 *
 * An image decodes once into a base frame; the source then serves clones of that
 * frame for any timestamp, so a still on a video track behaves like a clip whose
 * duration is purely clip-driven. It satisfies {@link VideoFrameProvider}, the
 * same contract as the sequential decoder, so playback/export treat it uniformly.
 */

import type { DecodedFrame } from './playback';
import type { VideoFrameProvider } from './frame-source';

/**
 * The decoded still's clone/close discipline, mirroring Mediabunny's VideoSample
 * so the source is unit-testable without a real `VideoFrame`. `clone()` hands the
 * caller an owned frame to render and close; `close()` releases the base frame.
 */
export interface StillFrameLike {
	clone(): VideoFrame;
	close(): void;
}

export class StillFrameSource implements VideoFrameProvider {
	private base: StillFrameLike | null;

	constructor(base: StillFrameLike) {
		this.base = base;
	}

	/**
	 * Returns a clone of the still for any time, or null once disposed. The
	 * returned `DecodedFrame.close()` is a no-op: the base stays owned by this
	 * source and is released only by {@link dispose}. Each `toVideoFrame()` hands
	 * back a distinct clone the caller must close.
	 */
	frameAt(_time: number): Promise<DecodedFrame | null> {
		const base = this.base;
		if (!base) return Promise.resolve(null);
		return Promise.resolve({
			toVideoFrame: () => base.clone(),
			close: () => {}
		});
	}

	/** No-op: a still has nothing to re-seek (unlike a sequential iterator). */
	reset(): void {}

	/** Closes the base frame exactly once; the source serves null afterwards. */
	dispose(): void {
		this.base?.close();
		this.base = null;
	}
}
