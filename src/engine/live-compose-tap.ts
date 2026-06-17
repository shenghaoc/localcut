/**
 * Phase 45: Live Compose Tap — per-source bridge from MSTP reader to
 * ProgramCompositor.
 *
 * Called by TrackPipeline immediately after `frame.clone()` and before
 * `encoder.encode(frame)`. The tap always forwards cloned frames to the
 * compositor regardless of source visibility. The compositor owns forwarded
 * frames and keeps the latest frame warm per source, preserving the one-frame
 * scene-switch invariant for low-FPS captures like screen sharing.
 *
 * Close-exactly-once: every VideoFrame handed to the tap is transferred to
 * the compositor and closed there when replaced or disposed.
 */

import type { ProgramCompositor } from './program-compositor';

export interface LiveComposeTap {
	/**
	 * Hands a cloned VideoFrame to the tap. Ownership is transferred to the
	 * compositor before this method returns.
	 */
	onFrame(sourceId: string, frame: VideoFrame): void;

	/** Disposes the tap. Forwarded frames are compositor-owned. */
	dispose(): void;
}

/**
 * Creates a LiveComposeTap that bridges MSTP reader frames to the
 * ProgramCompositor.
 *
 * @param compositor - The program compositor that receives frames.
 */
export function createLiveComposeTap(compositor: ProgramCompositor): LiveComposeTap {
	return {
		onFrame(sourceId: string, frame: VideoFrame): void {
			compositor.updateFrame(sourceId, frame);
		},

		dispose(): void {
			// Forwarded frames are owned by ProgramCompositor.
		}
	};
}
