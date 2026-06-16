/**
 * Phase 45: Live Compose Tap — per-source bridge from MSTP reader to
 * ProgramCompositor.
 *
 * Called by TrackPipeline immediately after `frame.clone()` and before
 * `encoder.encode(frame)`. The tap retains the latest frame per source
 * regardless of visibility — when a newer clone arrives, the previous one
 * is closed. Frames from invisible sources are kept warm so that switching
 * to a scene where the source IS visible has a frame available within one
 * tick (preserving the one-frame scene-switch invariant for low-FPS
 * captures like screen sharing).
 *
 * Close-exactly-once: every VideoFrame handed to the tap is closed either
 * by forwarding to the compositor (closed there after the frame is no
 * longer needed) or by the tap on drop/dispose.
 */

import type { ProgramCompositor } from './program-compositor';

export interface LiveComposeTap {
	/**
	 * Hands a cloned VideoFrame to the tap. The tap takes ownership.
	 * If the previous frame from this source has not yet been consumed,
	 * it is closed (latest-frame-wins per source).
	 */
	onFrame(sourceId: string, frame: VideoFrame): void;

	/** Disposes the tap, closing any held frames. */
	dispose(): void;
}

/**
 * Creates a LiveComposeTap that bridges MSTP reader frames to the
 * ProgramCompositor.
 *
 * @param compositor - The program compositor that receives frames.
 * @param isSourceVisible - Optional callback to check if a source is visible
 *   in the current scene. Used only for diagnostics; frames are kept warm
 *   regardless of visibility (R6.7).
 */
export function createLiveComposeTap(compositor: ProgramCompositor): LiveComposeTap {
	/** Latest held frame per source, awaiting compositor consumption. */
	const heldFrames = new Map<string, VideoFrame>();

	return {
		onFrame(sourceId: string, frame: VideoFrame): void {
			// Close the previous held frame for this source (latest-frame-wins)
			const prev = heldFrames.get(sourceId);
			if (prev) {
				prev.close();
			}
			// Store the new frame; the compositor will consume it on the next
			// renderTick and close it after importExternalTexture.
			heldFrames.set(sourceId, frame);
			compositor.updateFrame(sourceId, frame);
		},

		dispose(): void {
			// Close all held frames
			for (const frame of heldFrames.values()) {
				frame.close();
			}
			heldFrames.clear();
		}
	};
}
