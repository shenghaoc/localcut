/**
 * Budgeted thumbnail generation (Phase 11) — worker side.
 *
 * Decodes thumbnail frames through a dedicated per-asset sink (never the playback
 * iterator), downscales them to transferable `ImageBitmap`s, and emits them with
 * bounded concurrency so a decode storm can never starve playback. Every decoded
 * `VideoFrame` is closed exactly once; the transferred bitmap's lifetime then
 * belongs to the UI-side store.
 */

export interface ThumbnailResult {
	sourceId: string;
	timestamp: number;
	bitmap: ImageBitmap;
	width: number;
	height: number;
}

export interface ThumbnailGeneratorOptions {
	/** Decodes a source frame; this generator owns and closes it. Null = skip. */
	decode: (sourceId: string, timestamp: number) => Promise<VideoFrame | null>;
	/** Downscales a decoded frame to a transferable bitmap. */
	toBitmap: (frame: VideoFrame, targetWidth: number) => Promise<ImageBitmap>;
	/** Emits a finished thumbnail (the worker transfers the bitmap to the UI). */
	emit: (result: ThumbnailResult) => void;
	/** Surfaces a decode/encode failure; defaults to swallowing it. */
	onError?: (error: unknown) => void;
	/** Target bitmap width in pixels. */
	targetWidth?: number;
	/** Max concurrent decodes in flight (the per-frame ceiling). */
	concurrency?: number;
}

interface ThumbnailRequest {
	sourceId: string;
	timestamp: number;
}

/** Buckets a timestamp so near-identical requests collapse to one decode. */
export function thumbnailBucket(timestamp: number): number {
	return Math.round(Math.max(0, timestamp) * 1000) / 1000;
}

function requestKey(sourceId: string, timestamp: number): string {
	return `${sourceId}:${thumbnailBucket(timestamp)}`;
}

export class ThumbnailGenerator {
	private readonly decode: ThumbnailGeneratorOptions['decode'];
	private readonly toBitmap: ThumbnailGeneratorOptions['toBitmap'];
	private readonly emit: ThumbnailGeneratorOptions['emit'];
	private readonly onError: (error: unknown) => void;
	private readonly targetWidth: number;
	private readonly concurrency: number;

	private readonly queue: ThumbnailRequest[] = [];
	/** Keys queued or in flight, so a repeat request never decodes twice. */
	private readonly pending = new Set<string>();
	private inFlight = 0;

	constructor(options: ThumbnailGeneratorOptions) {
		this.decode = options.decode;
		this.toBitmap = options.toBitmap;
		this.emit = options.emit;
		this.onError = options.onError ?? (() => {});
		this.targetWidth = Math.max(16, Math.floor(options.targetWidth ?? 160));
		this.concurrency = Math.max(1, Math.floor(options.concurrency ?? 2));
	}

	/** Queues deduplicated thumbnail requests for one source. */
	request(sourceId: string, timestamps: readonly number[]): void {
		for (const timestamp of timestamps) {
			const bucket = thumbnailBucket(timestamp);
			const key = requestKey(sourceId, bucket);
			if (this.pending.has(key)) continue;
			this.pending.add(key);
			this.queue.push({ sourceId, timestamp: bucket });
		}
		this.pump();
	}

	/** Drops queued (not yet in-flight) requests for a removed source. */
	cancelSource(sourceId: string): void {
		for (let i = this.queue.length - 1; i >= 0; i -= 1) {
			const req = this.queue[i]!;
			if (req.sourceId !== sourceId) continue;
			this.pending.delete(requestKey(req.sourceId, req.timestamp));
			this.queue.splice(i, 1);
		}
	}

	get queued(): number {
		return this.queue.length;
	}

	get active(): number {
		return this.inFlight;
	}

	private pump(): void {
		while (this.inFlight < this.concurrency && this.queue.length > 0) {
			const req = this.queue.shift()!;
			this.inFlight += 1;
			void this.run(req)
				.catch((error) => this.onError(error))
				.finally(() => {
					this.inFlight -= 1;
					this.pending.delete(requestKey(req.sourceId, req.timestamp));
					this.pump();
				});
		}
	}

	private async run(req: ThumbnailRequest): Promise<void> {
		const frame = await this.decode(req.sourceId, req.timestamp);
		if (!frame) return;
		try {
			const bitmap = await this.toBitmap(frame, this.targetWidth);
			this.emit({
				sourceId: req.sourceId,
				timestamp: req.timestamp,
				bitmap,
				width: bitmap.width,
				height: bitmap.height
			});
		} finally {
			frame.close();
		}
	}
}
