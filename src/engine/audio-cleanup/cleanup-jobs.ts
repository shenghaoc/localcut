/**
 * Chunked, cancellable scheduling for audio-cleanup jobs. Pure logic — no
 * LiteRT, no worker globals — so frame alignment, state carry-over, progress
 * accounting, and cancellation are unit-testable with a fake runtime.
 */

import { DTLN_BLOCK_LEN, DTLN_BLOCK_SHIFT } from './dtln-dsp';
import type { DtlnDsp, DtlnFrameData } from './dtln-dsp';

export const CLEANUP_BATCH_FRAMES = 100;
export const DTLN_WARMUP_SAMPLES = DTLN_BLOCK_LEN - DTLN_BLOCK_SHIFT;

export interface CleanupInferenceRunner {
	runModel1(magnitude: Float32Array): Promise<Float32Array>;
	runModel2(estimated: Float32Array): Promise<Float32Array>;
}

export class CleanupCancelledError extends Error {
	constructor() {
		super('Audio cleanup cancelled');
		this.name = 'CleanupCancelledError';
	}
}

export interface CleanupBatchReport {
	processedFrames: number;
}

export interface CleanupJobOptions {
	batchFrames?: number;
	onBatch?: (report: CleanupBatchReport) => void;
}

export function downmixToMono(pcm: Float32Array, channels: number): Float32Array {
	if (channels <= 1) return pcm;
	const frames = Math.floor(pcm.length / channels);
	const out = new Float32Array(frames);
	const scale = 1 / channels;
	for (let frame = 0; frame < frames; frame++) {
		let sum = 0;
		for (let channel = 0; channel < channels; channel++) {
			sum += pcm[frame * channels + channel]!;
		}
		out[frame] = sum * scale;
	}
	return out;
}

/**
 * Streaming processor: push mono 16 kHz PCM in arbitrarily sized chunks,
 * get denoised PCM back. DTLN processes 128-sample frames (8 ms).
 */
export class CleanupJobProcessor {
	private readonly dsp: DtlnDsp;
	private readonly runner: CleanupInferenceRunner;
	private readonly batchFrames: number;
	private readonly onBatch: ((report: CleanupBatchReport) => void) | undefined;

	private readonly pending = new Float32Array(DTLN_BLOCK_SHIFT);
	private pendingCount = 0;
	private batchedFrameCount = 0;
	private processedFrames = 0;
	private totalInputSamples = 0;
	private aborted = false;
	private finalized = false;

	constructor(dsp: DtlnDsp, runner: CleanupInferenceRunner, options: CleanupJobOptions = {}) {
		this.dsp = dsp;
		this.runner = runner;
		this.batchFrames = options.batchFrames ?? CLEANUP_BATCH_FRAMES;
		this.onBatch = options.onBatch;
	}

	abort(): void {
		this.aborted = true;
	}

	private throwIfAborted(): void {
		if (this.aborted) throw new CleanupCancelledError();
	}

	private async processFrame(frame: Float32Array, outputs: Float32Array[]): Promise<void> {
		this.throwIfAborted();
		const fftData: DtlnFrameData = this.dsp.forwardStep(frame);
		const mask = await this.runner.runModel1(fftData.magnitude);
		this.throwIfAborted();
		const estimated = this.dsp.applyMaskAndIfft(mask, fftData);
		const enhanced = await this.runner.runModel2(estimated);
		this.throwIfAborted();
		const out = this.dsp.overlapAdd(enhanced);
		outputs.push(out);

		this.batchedFrameCount++;
		if (this.batchedFrameCount >= this.batchFrames) {
			this.processedFrames += this.batchedFrameCount;
			this.batchedFrameCount = 0;
			this.onBatch?.({ processedFrames: this.processedFrames });
		}
	}

	get inputSampleCount(): number {
		return this.totalInputSamples;
	}

	async push(pcm: Float32Array): Promise<Float32Array> {
		this.throwIfAborted();
		if (this.finalized) throw new Error('CleanupJobProcessor already finalized');
		this.totalInputSamples += pcm.length;
		const outputs: Float32Array[] = [];
		let cursor = 0;

		if (this.pendingCount > 0) {
			const take = Math.min(DTLN_BLOCK_SHIFT - this.pendingCount, pcm.length - cursor);
			this.pending.set(pcm.subarray(cursor, cursor + take), this.pendingCount);
			this.pendingCount += take;
			cursor += take;
			if (this.pendingCount === DTLN_BLOCK_SHIFT) {
				this.pendingCount = 0;
				await this.processFrame(this.pending, outputs);
			}
		}

		const frameInput = new Float32Array(DTLN_BLOCK_SHIFT);
		while (pcm.length - cursor >= DTLN_BLOCK_SHIFT) {
			frameInput.set(pcm.subarray(cursor, cursor + DTLN_BLOCK_SHIFT));
			cursor += DTLN_BLOCK_SHIFT;
			await this.processFrame(frameInput, outputs);
		}

		if (cursor < pcm.length) {
			this.pending.set(pcm.subarray(cursor), this.pendingCount);
			this.pendingCount += pcm.length - cursor;
		}

		return concatPcm(outputs);
	}

	async finalize(): Promise<Float32Array> {
		this.throwIfAborted();
		if (this.finalized) throw new Error('CleanupJobProcessor already finalized');
		this.finalized = true;
		const outputs: Float32Array[] = [];

		if (this.pendingCount > 0) {
			const frame = new Float32Array(DTLN_BLOCK_SHIFT);
			frame.set(this.pending.subarray(0, this.pendingCount));
			this.pendingCount = 0;
			await this.processFrame(frame, outputs);
		}

		const flush = this.dsp.flushOverlapAdd();
		if (flush.length > 0) outputs.push(flush);

		if (this.batchedFrameCount > 0) {
			this.processedFrames += this.batchedFrameCount;
			this.batchedFrameCount = 0;
			this.onBatch?.({ processedFrames: this.processedFrames });
		}

		return concatPcm(outputs);
	}

	get framesProcessed(): number {
		return this.processedFrames;
	}
}

export function concatPcm(chunks: readonly Float32Array[]): Float32Array {
	if (chunks.length === 0) return new Float32Array(0);
	if (chunks.length === 1) return chunks[0]!;
	let total = 0;
	for (const chunk of chunks) total += chunk.length;
	const out = new Float32Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

export function trimDtlnOutputToInput(
	rawPcm: Float32Array,
	inputSampleCount: number
): Float32Array {
	if (inputSampleCount <= 0) return new Float32Array(0);
	const start = Math.min(DTLN_WARMUP_SAMPLES, rawPcm.length);
	const end = Math.min(start + inputSampleCount, rawPcm.length);
	return rawPcm.subarray(start, end);
}
