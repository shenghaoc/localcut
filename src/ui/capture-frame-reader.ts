/**
 * Off-main-thread "main-frames" recording fallback — main-thread half (bugfix
 * B5/T5.5). On profiles without Transferable MediaStreamTrack the source track
 * cannot be transferred into the pipeline worker, so the main thread keeps the
 * track, reads it with its own `MediaStreamTrackProcessor`, and forwards each
 * `VideoFrame`/`AudioData` to the worker's trackless push pipeline.
 *
 * This is the mirror of publish's main-frames tap (`publish-controller.ts`), with
 * the data flowing main → worker (recording) instead of worker → main (publish).
 *
 * Frame ownership: every frame this reader produces is handed to `pushFrame`,
 * which transfers it across the worker boundary; the worker then closes it exactly
 * once (encoded or dropped). The reader only closes a frame itself when it is read
 * after {@link CaptureFrameReader.stop} — i.e. when it will never be forwarded —
 * so the close-exactly-once invariant (hard architectural gate) holds end to end.
 *
 * Hard gate note: this reader runs a per-source MSTP read loop on the main thread.
 * It is the explicit, capability-tiered compatibility path the gate allows — it
 * does no pixel processing (no decode/encode/GPU/readback); it only shuttles frame
 * handles to the worker encoder. The accelerated worker-track path is preferred
 * whenever Transferable MediaStreamTrack is available (see `selectCaptureMode`).
 */

export interface CaptureFrameReader {
	/** Stops the read loop and cancels the underlying reader. Idempotent. */
	stop(): void;
}

/**
 * Starts reading frames from `track` on the main thread and forwarding them via
 * `pushFrame`. `pushFrame` must transfer the frame to the worker (transferring
 * moves ownership, so the caller must not also close it). `onError` fires once if
 * the read loop throws before being stopped. `onEnded` fires once when the track
 * ends on its own (e.g. the user stops sharing) — distinct from an explicit
 * {@link CaptureFrameReader.stop} — so the caller can end the worker-side source.
 */
export function startCaptureFrameReader(
	track: MediaStreamTrack,
	pushFrame: (frame: VideoFrame | AudioData) => void,
	onError?: (error: unknown) => void,
	onEnded?: () => void
): CaptureFrameReader {
	// `MediaStreamTrackProcessor` construction + getReader() can throw synchronously
	// (e.g. an unsupported track). Build them INSIDE the async runner so such a throw
	// is caught and routed to onError instead of propagating to the (synchronous)
	// caller — e.g. the Record panel's start handler.
	let reader: ReadableStreamDefaultReader<VideoFrame | AudioData> | null = null;
	let stopped = false;

	void (async () => {
		try {
			const processor = new MediaStreamTrackProcessor({ track });
			reader = (
				processor.readable as unknown as ReadableStream<VideoFrame | AudioData>
			).getReader();
			while (!stopped) {
				const result = await reader.read();
				if (result.done) {
					// The track ended on its own (not via stop()) — tell the caller so the
					// worker-side source can end and the all-sources-ended auto-stop runs.
					if (!stopped) onEnded?.();
					break;
				}
				const frame = result.value;
				if (stopped) {
					// Stopped between the read resolving and forwarding: close here so
					// this frame — which will never reach the worker — does not leak.
					frame.close();
					break;
				}
				try {
					pushFrame(frame); // transfers ownership to the worker
				} catch (err) {
					// pushFrame threw before transferring (the frame is still owned here),
					// so close it to avoid a leak, then surface the failure via onError.
					frame.close();
					throw err;
				}
			}
		} catch (error) {
			if (!stopped) onError?.(error);
		} finally {
			if (reader) {
				try {
					await reader.cancel();
				} catch {
					// best-effort teardown — the track may already be ended
				}
				try {
					reader.releaseLock();
				} catch {
					// best-effort teardown
				}
			}
		}
	})();

	return {
		stop(): void {
			if (stopped) return;
			stopped = true;
			// `reader` may still be null if stop() races the async initialization; the
			// runner's `while (!stopped)` guard then exits before the first read.
			if (reader) {
				try {
					void reader.cancel();
				} catch {
					// best-effort — the loop's finally also cancels
				}
			}
		}
	};
}
