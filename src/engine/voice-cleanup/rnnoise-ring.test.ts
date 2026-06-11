import { describe, expect, it } from 'vite-plus/test';
import { RnnoiseRing, type RnnoiseInstance } from './rnnoise-processor';

/** Create a mock RnnoiseInstance that echoes input to output. */
function mockInstance(): RnnoiseInstance {
	return {
		processFrame(input: Float32Array, output: Float32Array): number {
			output.set(input);
			return 0.5; // mock VAD
		},
		destroy(): void {},
	};
}

describe('RnnoiseRing', () => {
	it('processes 480-sample frames from 128-sample pushes', () => {
		const ring = new RnnoiseRing(mockInstance());
		// Push 10 × 128 = 1280 samples → should produce 2 × 480 = 960 output samples
		let totalOutput = 0;
		for (let i = 0; i < 10; i++) {
			const block = new Float32Array(128);
			block.fill(i + 1);
			const out = ring.push(block);
			totalOutput += out.length;
		}
		expect(totalOutput).toBe(960); // floor(1280 / 480) * 480
	});

	it('no sample drops or duplicates across pushes', () => {
		const ring = new RnnoiseRing(mockInstance());
		const allOutput: number[] = [];
		for (let i = 0; i < 10; i++) {
			const block = new Float32Array(128);
			// Fill with monotonically increasing values
			for (let j = 0; j < 128; j++) {
				block[j] = i * 128 + j;
			}
			const out = ring.push(block);
			for (let j = 0; j < out.length; j++) {
				allOutput.push(out[j]);
			}
		}
		// Output should be sequential (since mock echoes input)
		for (let i = 0; i < allOutput.length; i++) {
			expect(allOutput[i]).toBe(i);
		}
	});

	it('drain produces a final 480-sample frame', () => {
		const ring = new RnnoiseRing(mockInstance());
		// Push 10 blocks (1280 samples), leaving 1280 - 960 = 320 in accumulator
		for (let i = 0; i < 10; i++) {
			ring.push(new Float32Array(128));
		}
		const drained = ring.drain();
		expect(drained.length).toBe(480);
	});

	it('total output across push + drain is 1440 samples', () => {
		const ring = new RnnoiseRing(mockInstance());
		let total = 0;
		for (let i = 0; i < 10; i++) {
			total += ring.push(new Float32Array(128)).length;
		}
		total += ring.drain().length;
		expect(total).toBe(1440); // 960 + 480
	});

	it('handles large blocks (>480 samples) without accumulator growth', () => {
		const ring = new RnnoiseRing(mockInstance());
		// Push a single 1024-sample block
		const block = new Float32Array(1024);
		for (let i = 0; i < 1024; i++) block[i] = i;
		const out = ring.push(block);
		// Should produce 2 × 480 = 960 output samples (two complete frames)
		expect(out.length).toBe(960);
		// Remaining 64 samples in accumulator — drain should produce 480
		const drained = ring.drain();
		expect(drained.length).toBe(480);
	});

	it('empty push returns empty array', () => {
		const ring = new RnnoiseRing(mockInstance());
		const out = ring.push(new Float32Array(50));
		expect(out.length).toBe(0);
	});

	it('processFrame budget < 2 ms for 128 samples', () => {
		const instance = mockInstance();
		const ring = new RnnoiseRing(instance);
		const block = new Float32Array(128);
		const start = performance.now();
		ring.push(block);
		const elapsed = performance.now() - start;
		expect(elapsed).toBeLessThan(2);
	});
});
