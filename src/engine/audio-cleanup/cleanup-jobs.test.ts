import { describe, expect, it, vi } from 'vitest';
import {
	CleanupCancelledError,
	CleanupJobProcessor,
	concatPcm,
	downmixToMono,
	type FrameDsp
} from './cleanup-jobs';
import { RNNOISE_FEATURE_SIZE, RNNOISE_FRAME_SIZE, RNNOISE_GAINS_SIZE } from './model-manifest';
import type { FrameSpectra } from './rnnoise-dsp';

/**
 * Fake DSP mirroring the real one's contract: one-frame algorithmic delay
 * (output frame n replays input frame n−1, scaled by the first gain) with
 * streaming state carried across frames, so chunk-boundary continuity and
 * delay compensation are both observable.
 */
function fakeDsp(): FrameDsp & { framesSeen: number } {
	const inputs: Float32Array[] = [];
	let postCount = 0;
	return {
		framesSeen: 0,
		preProcessFrame(input, features, spectra: FrameSpectra) {
			spectra.xRe.set(input.subarray(0, RNNOISE_FRAME_SIZE));
			inputs.push(input.slice(0, RNNOISE_FRAME_SIZE));
			features[0] = this.framesSeen;
			this.framesSeen += 1;
			return false;
		},
		postProcessFrame(gains, _spectra: FrameSpectra, out) {
			const delayed = postCount > 0 ? inputs[postCount - 1]! : new Float32Array(RNNOISE_FRAME_SIZE);
			postCount += 1;
			for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) out[i] = delayed[i]! * gains[0]!;
		}
	};
}

function unitRunner(batchFrames: number) {
	return {
		calls: [] as number[],
		async infer(features: Float32Array, frameCount: number) {
			this.calls.push(frameCount);
			expect(features.length).toBe(batchFrames * RNNOISE_FEATURE_SIZE);
			return new Float32Array(batchFrames * RNNOISE_GAINS_SIZE).fill(1);
		}
	};
}

function ramp(samples: number): Float32Array {
	const out = new Float32Array(samples);
	for (let i = 0; i < samples; i++) out[i] = (i % 1000) / 1000;
	return out;
}

describe('CleanupJobProcessor', () => {
	it('aligns arbitrary chunk sizes to 480-sample frames and preserves all samples', async () => {
		const runner = unitRunner(4);
		const processor = new CleanupJobProcessor(fakeDsp(), runner, { batchFrames: 4 });
		const input = ramp(480 * 5 + 123);
		const outputs: Float32Array[] = [];
		// Push in deliberately awkward chunk sizes; the remainder goes last.
		let cursor = 0;
		for (const size of [100, 700, 479, 481, 960]) {
			outputs.push(await processor.push(input.subarray(cursor, cursor + size)));
			cursor += size;
		}
		outputs.push(await processor.push(input.subarray(cursor)));
		outputs.push(await processor.finalize());
		const out = concatPcm(outputs);
		expect(out.length).toBe(input.length);
		// Delay compensation makes output align 1:1 with input (unit gains).
		for (let i = 0; i < input.length; i += 997) {
			expect(out[i]).toBeCloseTo(input[i]!, 6);
		}
	});

	it('produces identical output regardless of chunking (state carried across chunks)', async () => {
		const input = ramp(480 * 7 + 250);
		const runAll = async (chunkSizes: number[]): Promise<Float32Array> => {
			const processor = new CleanupJobProcessor(fakeDsp(), unitRunner(3), { batchFrames: 3 });
			const outputs: Float32Array[] = [];
			let cursor = 0;
			for (const size of chunkSizes) {
				outputs.push(await processor.push(input.subarray(cursor, cursor + size)));
				cursor += size;
			}
			outputs.push(await processor.push(input.subarray(cursor)));
			outputs.push(await processor.finalize());
			return concatPcm(outputs);
		};
		const whole = await runAll([]);
		const chunked = await runAll([100, 480, 1000, 333]);
		expect(chunked.length).toBe(whole.length);
		expect([...chunked]).toEqual([...whole]);
	});

	it('reports monotonic progress per batch', async () => {
		const reports: number[] = [];
		const processor = new CleanupJobProcessor(fakeDsp(), unitRunner(2), {
			batchFrames: 2,
			onBatch: ({ processedFrames }) => reports.push(processedFrames)
		});
		await processor.push(ramp(480 * 7));
		await processor.finalize();
		expect(reports.length).toBeGreaterThan(1);
		for (let i = 1; i < reports.length; i++) {
			expect(reports[i]!).toBeGreaterThan(reports[i - 1]!);
		}
		// 7 input frames + 1 delay-compensation flush frame.
		expect(reports[reports.length - 1]).toBe(8);
	});

	it('zero-pads the features of a partial final batch', async () => {
		const seen: Float32Array[] = [];
		const runner = {
			async infer(features: Float32Array) {
				seen.push(features.slice());
				return new Float32Array(4 * RNNOISE_GAINS_SIZE).fill(1);
			}
		};
		const dsp = fakeDsp();
		const processor = new CleanupJobProcessor(dsp, runner, { batchFrames: 4 });
		await processor.push(ramp(480 * 4));
		await processor.finalize();
		const last = seen[seen.length - 1]!;
		// Final batch holds 1 flush frame; features for frames 2..4 must be zero.
		const tail = last.subarray(1 * RNNOISE_FEATURE_SIZE);
		expect(Math.max(...tail.map(Math.abs))).toBe(0);
	});

	it('abort() cancels promptly between batches and releases nothing half-done', async () => {
		const processor = new CleanupJobProcessor(
			fakeDsp(),
			{
				infer: vi.fn(async () => {
					processor.abort();
					return new Float32Array(2 * RNNOISE_GAINS_SIZE).fill(1);
				})
			},
			{ batchFrames: 2 }
		);
		await expect(processor.push(ramp(480 * 4))).rejects.toThrow(CleanupCancelledError);
		await expect(processor.push(ramp(480))).rejects.toThrow(CleanupCancelledError);
	});

	it('abort() before finalize rejects finalize', async () => {
		const processor = new CleanupJobProcessor(fakeDsp(), unitRunner(2), { batchFrames: 2 });
		await processor.push(ramp(480));
		processor.abort();
		await expect(processor.finalize()).rejects.toThrow(CleanupCancelledError);
	});
});

describe('downmixToMono', () => {
	it('averages interleaved channels', () => {
		const stereo = new Float32Array([1, 0, 0.5, 0.5, -1, 1]);
		expect([...downmixToMono(stereo, 2)]).toEqual([0.5, 0.5, 0]);
	});

	it('returns mono input unchanged', () => {
		const mono = new Float32Array([0.1, 0.2]);
		expect(downmixToMono(mono, 1)).toBe(mono);
	});
});
