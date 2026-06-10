/**
 * Chunked, cancellable scheduling for audio-cleanup jobs. Pure logic — no
 * WebNN, no worker globals — so frame alignment, recurrent-state carry-over,
 * progress accounting, and cancellation are unit-testable with a fake model.
 */

import { RNNOISE_FEATURE_SIZE, RNNOISE_FRAME_SIZE, RNNOISE_GAINS_SIZE } from './model-manifest';
import { createFrameSpectra, type FrameSpectra } from './rnnoise-dsp';

/** Frames per inference batch (1 s of audio), matching the WebNN sample. */
export const CLEANUP_BATCH_FRAMES = 100;

/** Per-frame DSP contract implemented by `RnnoiseDsp` (and by test fakes). */
export interface FrameDsp {
	preProcessFrame(input: Float32Array, features: Float32Array, spectra: FrameSpectra): boolean;
	postProcessFrame(gains: Float32Array, spectra: FrameSpectra, out: Float32Array): void;
}

/** Runs model inference for a batch of frames; returns per-frame band gains. */
export interface CleanupInferenceRunner {
	infer(features: Float32Array, frameCount: number): Promise<Float32Array>;
}

export class CleanupCancelledError extends Error {
	constructor() {
		super('Audio cleanup cancelled');
		this.name = 'CleanupCancelledError';
	}
}

export interface CleanupBatchReport {
	/** Input frames consumed so far (after delay compensation bookkeeping). */
	processedFrames: number;
}

export interface CleanupJobOptions {
	batchFrames?: number;
	/**
	 * The analysis/synthesis windowing delays output by exactly one frame
	 * (10 ms). When enabled (default) the first output frame is dropped and
	 * `finalize()` flushes one zero frame so output aligns 1:1 with input.
	 */
	delayCompensation?: boolean;
	onBatch?: (report: CleanupBatchReport) => void;
}

/** Equal-gain downmix of interleaved PCM to mono. */
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
 * Streaming processor: push mono 48 kHz PCM in arbitrarily sized chunks, get
 * denoised PCM back. Recurrent model state lives in the injected runner and
 * the DSP state in the injected `FrameDsp`, both carried across pushes so
 * chunk boundaries are inaudible.
 */
export class CleanupJobProcessor {
	private readonly dsp: FrameDsp;
	private readonly runner: CleanupInferenceRunner;
	private readonly batchFrames: number;
	private readonly onBatch: ((report: CleanupBatchReport) => void) | undefined;

	private readonly pending: number[] = [];
	private readonly features: Float32Array;
	private readonly spectra: FrameSpectra[];
	private readonly frameIn = new Float32Array(RNNOISE_FRAME_SIZE);
	private readonly frameOut = new Float32Array(RNNOISE_FRAME_SIZE);
	private batchedFrames = 0;
	private processedFrames = 0;
	private leadingSamplesToDrop: number;
	private aborted = false;
	private finalized = false;

	constructor(dsp: FrameDsp, runner: CleanupInferenceRunner, options: CleanupJobOptions = {}) {
		this.dsp = dsp;
		this.runner = runner;
		this.batchFrames = options.batchFrames ?? CLEANUP_BATCH_FRAMES;
		this.onBatch = options.onBatch;
		this.leadingSamplesToDrop = (options.delayCompensation ?? true) ? RNNOISE_FRAME_SIZE : 0;
		this.features = new Float32Array(this.batchFrames * RNNOISE_FEATURE_SIZE);
		this.spectra = Array.from({ length: this.batchFrames }, () => createFrameSpectra());
	}

	abort(): void {
		this.aborted = true;
	}

	private throwIfAborted(): void {
		if (this.aborted) throw new CleanupCancelledError();
	}

	private async flushBatch(outputs: Float32Array[]): Promise<void> {
		if (this.batchedFrames === 0) return;
		this.throwIfAborted();
		const frameCount = this.batchedFrames;
		// Zero any padding so a partial final batch never feeds stale features.
		this.features.fill(0, frameCount * RNNOISE_FEATURE_SIZE);
		const gains = await this.runner.infer(this.features, frameCount);
		this.throwIfAborted();
		for (let frame = 0; frame < frameCount; frame++) {
			const frameGains = gains.subarray(
				frame * RNNOISE_GAINS_SIZE,
				(frame + 1) * RNNOISE_GAINS_SIZE
			);
			this.dsp.postProcessFrame(new Float32Array(frameGains), this.spectra[frame]!, this.frameOut);
			if (this.leadingSamplesToDrop >= RNNOISE_FRAME_SIZE) {
				this.leadingSamplesToDrop -= RNNOISE_FRAME_SIZE;
			} else {
				outputs.push(this.frameOut.slice(this.leadingSamplesToDrop));
				this.leadingSamplesToDrop = 0;
			}
		}
		this.processedFrames += frameCount;
		this.batchedFrames = 0;
		this.onBatch?.({ processedFrames: this.processedFrames });
	}

	private async pushFrame(frame: Float32Array, outputs: Float32Array[]): Promise<void> {
		const featureSlot = this.features.subarray(
			this.batchedFrames * RNNOISE_FEATURE_SIZE,
			(this.batchedFrames + 1) * RNNOISE_FEATURE_SIZE
		);
		this.dsp.preProcessFrame(frame, featureSlot, this.spectra[this.batchedFrames]!);
		this.batchedFrames += 1;
		if (this.batchedFrames === this.batchFrames) {
			await this.flushBatch(outputs);
		}
	}

	/** Feeds mono PCM; returns whatever denoised PCM became available. */
	async push(pcm: Float32Array): Promise<Float32Array> {
		this.throwIfAborted();
		if (this.finalized) throw new Error('CleanupJobProcessor already finalized');
		const outputs: Float32Array[] = [];
		let cursor = 0;
		// Top up any residual partial frame first.
		if (this.pending.length > 0) {
			while (this.pending.length < RNNOISE_FRAME_SIZE && cursor < pcm.length) {
				this.pending.push(pcm[cursor]!);
				cursor += 1;
			}
			if (this.pending.length === RNNOISE_FRAME_SIZE) {
				this.frameIn.set(this.pending);
				this.pending.length = 0;
				await this.pushFrame(this.frameIn, outputs);
			}
		}
		while (pcm.length - cursor >= RNNOISE_FRAME_SIZE) {
			this.frameIn.set(pcm.subarray(cursor, cursor + RNNOISE_FRAME_SIZE));
			cursor += RNNOISE_FRAME_SIZE;
			await this.pushFrame(this.frameIn, outputs);
		}
		for (; cursor < pcm.length; cursor++) this.pending.push(pcm[cursor]!);
		return concatPcm(outputs);
	}

	/**
	 * Flushes the residual partial frame (zero-padded) plus the one-frame
	 * delay-compensation tail, then runs the final partial batch.
	 */
	async finalize(): Promise<Float32Array> {
		this.throwIfAborted();
		if (this.finalized) throw new Error('CleanupJobProcessor already finalized');
		this.finalized = true;
		const outputs: Float32Array[] = [];
		let tailPadding = 0;
		if (this.pending.length > 0) {
			tailPadding = RNNOISE_FRAME_SIZE - this.pending.length;
			this.frameIn.fill(0);
			this.frameIn.set(this.pending);
			this.pending.length = 0;
			await this.pushFrame(this.frameIn, outputs);
		}
		// One zero frame recovers the last real frame from the synthesis overlap.
		this.frameIn.fill(0);
		await this.pushFrame(this.frameIn, outputs);
		await this.flushBatch(outputs);
		let out = concatPcm(outputs);
		// Trim the zero-padding echo so output length matches input exactly.
		if (tailPadding > 0 && tailPadding <= out.length) {
			out = out.slice(0, out.length - tailPadding);
		}
		return out;
	}

	get framesProcessed(): number {
		return this.processedFrames;
	}
}

export function concatPcm(chunks: readonly Float32Array[]): Float32Array {
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
