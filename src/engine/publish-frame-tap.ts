/**
 * Phase 47 (T5): bounded tap of the compositor's program output into the WHIP
 * publish path. The compositor keeps ownership of the original frame (it still
 * feeds the preview); the tap clones it and writes the clone to a
 * `MediaStreamTrackGenerator` writer, which closes frames it consumes.
 *
 * Bounds (R4.2): at most one write in flight plus one pending clone. A new
 * frame arriving while a clone is pending replaces it — the stale clone is
 * closed and counted as dropped. Nothing queues unboundedly, and every clone
 * is closed exactly once across write/drop/stop/error (R4.3).
 *
 * Generic over the frame type so unit tests run on plain fakes; the worker
 * instantiates it with real `VideoFrame`s.
 */

export interface TapFrame {
	clone(): this;
	close(): void;
}

/** Structural subset of `WritableStreamDefaultWriter<VideoFrame>`. */
export interface TapWriter<F> {
	write(frame: F): Promise<void>;
	close(): Promise<void>;
}

export interface PublishFrameTapStats {
	framesDelivered: number;
	framesDropped: number;
}

export interface PublishFrameTap<F> {
	/** Called by the render loop with the program frame; never blocks it. */
	push(frame: F): void;
	stats(): PublishFrameTapStats;
	/** Idempotent. Closes pending clones, then the writer. */
	stop(): Promise<void>;
}

export function createPublishFrameTap<F extends TapFrame>(
	writer: TapWriter<F>,
	onError?: (error: unknown) => void
): PublishFrameTap<F> {
	let pending: F | null = null;
	let writing = false;
	let stopped = false;
	let delivered = 0;
	let dropped = 0;

	function fail(error: unknown) {
		if (stopped) return;
		stopped = true;
		if (pending !== null) {
			pending.close();
			pending = null;
		}
		onError?.(error);
	}

	function pump() {
		if (writing || stopped || pending === null) return;
		const frame = pending;
		pending = null;
		writing = true;
		// write() can also throw synchronously (released lock, or a postMessage
		// DataCloneError in the fallback writer); without the catch that would
		// leave `writing` stuck true and leak every later frame.
		try {
			writer.write(frame).then(
				() => {
					// The generator consumed (and closed) the frame.
					delivered += 1;
					writing = false;
					pump();
				},
				(error) => {
					// Writer contract: a rejected write does not consume the chunk.
					frame.close();
					writing = false;
					fail(error);
				}
			);
		} catch (error) {
			frame.close();
			writing = false;
			fail(error);
		}
	}

	return {
		push(frame) {
			if (stopped) return;
			let clone: F;
			try {
				clone = frame.clone();
			} catch (error) {
				fail(error);
				return;
			}
			if (pending !== null) {
				pending.close();
				dropped += 1;
			}
			pending = clone;
			pump();
		},
		stats() {
			return { framesDelivered: delivered, framesDropped: dropped };
		},
		async stop() {
			if (stopped) return;
			stopped = true;
			if (pending !== null) {
				pending.close();
				pending = null;
			}
			try {
				await writer.close();
			} catch {
				// The stream may already be errored/closed; stop must not throw.
			}
		}
	};
}
