import { describe, expect, it } from 'vite-plus/test';
import {
	CleanupCancelledError,
	CleanupJobProcessor,
	concatPcm,
	downmixToMono,
	type CleanupInferenceRunner
} from './cleanup-jobs';
import { DTLN_BLOCK_SHIFT, DtlnDsp } from './dtln-dsp';

function passthrough(): CleanupInferenceRunner & { model1Calls: number; model2Calls: number } {
	return {
		model1Calls: 0,
		model2Calls: 0,
		async runModel1(magnitude: Float32Array) {
			this.model1Calls++;
			return new Float32Array(magnitude.length).fill(1);
		},
		async runModel2(estimated: Float32Array) {
			this.model2Calls++;
			return estimated.slice();
		}
	};
}

function ramp(samples: number): Float32Array {
	const out = new Float32Array(samples);
	for (let i = 0; i < samples; i++) out[i] = (i % 1000) / 1000;
	return out;
}

describe('CleanupJobProcessor', () => {
	it('aligns arbitrary chunk sizes to 128-sample frames and produces output', async () => {
		const runner = passthrough();
		const dsp = new DtlnDsp();
		const processor = new CleanupJobProcessor(dsp, runner, { batchFrames: 4 });
		const input = ramp(DTLN_BLOCK_SHIFT * 5 + 23);
		const outputs: Float32Array[] = [];
		let cursor = 0;
		for (const size of [50, 200, 127, 129, 256]) {
			outputs.push(await processor.push(input.subarray(cursor, cursor + size)));
			cursor += size;
		}
		outputs.push(await processor.push(input.subarray(cursor)));
		outputs.push(await processor.finalize());
		const out = concatPcm(outputs);
		const expectedFrames = Math.ceil(input.length / DTLN_BLOCK_SHIFT);
		expect(out.length).toBe(expectedFrames * DTLN_BLOCK_SHIFT);
		expect(runner.model1Calls).toBeGreaterThan(0);
		expect(runner.model2Calls).toBe(runner.model1Calls);
	});

	it('produces identical output regardless of chunking (state carried across chunks)', async () => {
		const input = ramp(DTLN_BLOCK_SHIFT * 7 + 50);
		const runAll = async (chunkSizes: number[]): Promise<Float32Array> => {
			const processor = new CleanupJobProcessor(new DtlnDsp(), passthrough(), { batchFrames: 3 });
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
		const chunked = await runAll([50, 128, 300, 100]);
		expect(chunked.length).toBe(whole.length);
		expect([...chunked]).toEqual([...whole]);
	});

	it('reports monotonic progress per batch', async () => {
		const reports: number[] = [];
		const processor = new CleanupJobProcessor(new DtlnDsp(), passthrough(), {
			batchFrames: 2,
			onBatch: ({ processedFrames }) => reports.push(processedFrames)
		});
		await processor.push(ramp(DTLN_BLOCK_SHIFT * 7));
		await processor.finalize();
		expect(reports.length).toBeGreaterThan(1);
		for (let i = 1; i < reports.length; i++) {
			expect(reports[i]!).toBeGreaterThan(reports[i - 1]!);
		}
	});

	it('abort() cancels promptly between frames and rejects further pushes', async () => {
		const dsp = new DtlnDsp();
		const processor = new CleanupJobProcessor(
			dsp,
			{
				async runModel1(mag) {
					processor.abort();
					return new Float32Array(mag.length).fill(1);
				},
				async runModel2(est) {
					return est.slice();
				}
			},
			{ batchFrames: 2 }
		);
		await expect(processor.push(ramp(DTLN_BLOCK_SHIFT * 4))).rejects.toThrow(CleanupCancelledError);
		await expect(processor.push(ramp(DTLN_BLOCK_SHIFT))).rejects.toThrow(CleanupCancelledError);
	});

	it('abort() before finalize rejects finalize', async () => {
		const processor = new CleanupJobProcessor(new DtlnDsp(), passthrough(), { batchFrames: 2 });
		await processor.push(ramp(DTLN_BLOCK_SHIFT));
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
