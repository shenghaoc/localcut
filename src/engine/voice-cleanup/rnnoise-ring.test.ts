import { describe, expect, it } from 'vite-plus/test';
import { RnnoiseRing, type RnnoiseInstance } from './rnnoise-processor';

/** Create a mock RnnoiseInstance that echoes input to output. */
function mockInstance(): RnnoiseInstance {
	return {
		processFrame(input: Float32Array, output: Float32Array): number {
			output.set(input);
			return 0.5; // mock VAD
		},
		destroy(): void {}
	};
}

describe('RnnoiseRing', () => {
	it('push(N) always returns exactly N samples (fixed-size I/O)', () => {
		const ring = new RnnoiseRing(mockInstance());
		// push(128) returns 128 samples every time — from the output ring buffer
		// (pre-primed with 480 silence for latency compensation)
		for (let i = 0; i < 10; i++) {
			const block = new Float32Array(128);
			block.fill(i + 1);
			const out = ring.push(block);
			expect(out.length).toBe(128);
		}
	});

	it('pre-primed output is silence for the first 480 samples', () => {
		const ring = new RnnoiseRing(mockInstance());
		// First 480 output samples should be silence (pre-primed latency buffer)
		let totalRead = 0;
		for (let i = 0; i < 3; i++) {
			const out = ring.push(new Float32Array(128));
			for (let j = 0; j < out.length; j++) {
				expect(out[j]).toBe(0);
			}
			totalRead += out.length;
		}
		// 3 × 128 = 384 — still within the 480-sample silence priming
		expect(totalRead).toBe(384);
	});

	it('echoed samples appear after latency is consumed', () => {
		const ring = new RnnoiseRing(mockInstance());
		// Push 4 × 128 = 512 input samples. The first 480 go to silence priming,
		// and after 480 input samples are accumulated, one frame is processed.
		// The mock echoes input → output, so processed samples match input values.
		const allOutput: number[] = [];
		for (let i = 0; i < 4; i++) {
			const block = new Float32Array(128);
			for (let j = 0; j < 128; j++) {
				block[j] = i * 128 + j;
			}
			const out = ring.push(block);
			for (let j = 0; j < out.length; j++) {
				allOutput.push(out[j]);
			}
		}
		// First 480 are silence (0), then processed samples start appearing
		for (let i = 0; i < 480; i++) {
			expect(allOutput[i]).toBe(0);
		}
		// After silence, processed samples appear (values 0, 1, 2, ...)
		// The 4th push's 32 tail samples come from the processed frame
		for (let i = 480; i < 512; i++) {
			expect(allOutput[i]).toBe(i - 480);
		}
	});

	it('drain returns remaining output samples', () => {
		const ring = new RnnoiseRing(mockInstance());
		// Push 10 blocks × 128 = 1280 input samples
		let total = 0;
		for (let i = 0; i < 10; i++) {
			total += ring.push(new Float32Array(128)).length;
		}
		expect(total).toBe(1280); // push always returns input.length
		// Drain should return remaining buffered output
		const drained = ring.drain();
		expect(drained.length).toBeGreaterThan(0);
	});

	it('total output across push + drain accounts for all input', () => {
		const ring = new RnnoiseRing(mockInstance());
		let total = 0;
		for (let i = 0; i < 10; i++) {
			total += ring.push(new Float32Array(128)).length;
		}
		total += ring.drain().length;
		// 1280 push output + drain output. Drain returns the pre-primed silence
		// that wasn't consumed plus any remaining processed frames.
		expect(total).toBeGreaterThanOrEqual(1280);
	});

	it('handles large blocks (>480 samples) with fixed-size I/O', () => {
		const ring = new RnnoiseRing(mockInstance());
		const block = new Float32Array(1024);
		for (let i = 0; i < 1024; i++) block[i] = i;
		const out = ring.push(block);
		// push(1024) returns exactly 1024 samples
		expect(out.length).toBe(1024);
	});

	it('processFrame stays well within the real-time budget for 128 samples', () => {
		const ring = new RnnoiseRing(mockInstance());
		// Warm the JIT so the measurement isn't dominated by first-call compilation,
		// then average over many iterations. A single cold `performance.now()` sample
		// is machine-dependent and flakes on a loaded CI runner; the averaged figure
		// is microseconds and only trips on a gross regression. A 128-sample frame at
		// 48 kHz is ~2.67 ms of audio, so an average push well under 1 ms is real-time.
		for (let i = 0; i < 50; i++) ring.push(new Float32Array(128));
		const iterations = 200;
		const start = performance.now();
		for (let i = 0; i < iterations; i++) ring.push(new Float32Array(128));
		const perPushMs = (performance.now() - start) / iterations;
		expect(perPushMs).toBeLessThan(1);
	});
});
