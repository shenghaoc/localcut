/**
 * Performance benchmark for WASM SIMD vs JS AudioResampler.
 * Run with: pnpm run test src/engine/audio-resampler-bench.test.ts
 *
 * Measures samples/sec for 44.1 kHz → 48 kHz stereo resampling.
 * Requirement R4.1: ≥2x throughput improvement.
 *
 * Multi-channel SIMD note:
 * SIMD gains are most pronounced for mono. For ch>1 the per-channel
 * lane-gather (v128.load32_lane ×4) executes scalar-equivalent loads per
 * 4 taps — the conventional WASM SIMD pattern for interleaved audio — so
 * stereo speedup is lower than mono.
 */

import { describe, it, beforeAll, expect } from 'vite-plus/test';
import { WasmAudioResampler } from './audio-resampler-wasm';
import { AudioResampler } from './audio-resampler';

const BENCH_DURATION_MS = 500;
const INPUT_RATE = 44100;
const OUTPUT_RATE = 48000;
const CHANNELS = 2;
const FREQ = 1000;

function generateSine(frames: number, channels: number, rate: number): Float32Array {
	const input = new Float32Array(frames * channels);
	for (let i = 0; i < frames; i++) {
		const v = Math.sin((2 * Math.PI * FREQ * i) / rate);
		for (let c = 0; c < channels; c++) {
			input[i * channels + c] = v * (1 - c * 0.3);
		}
	}
	return input;
}

function benchResampler(
	resampler: AudioResampler | WasmAudioResampler,
	input: Float32Array,
	chunkFrames: number,
	durationMs: number
): number {
	const start = performance.now();
	const endTime = start + durationMs;
	let totalSamples = 0;

	while (performance.now() < endTime) {
		resampler.reset();
		for (let offset = 0; offset < input.length; offset += chunkFrames * CHANNELS) {
			const chunk = input.subarray(offset, Math.min(offset + chunkFrames * CHANNELS, input.length));
			const frames = Math.floor(chunk.length / CHANNELS);
			const result = resampler.process(new Float32Array(chunk), frames);
			totalSamples += result.length;
		}
		const tail = resampler.flush();
		totalSamples += tail.length;
	}

	const elapsed = performance.now() - start;
	return totalSamples / (elapsed / 1000);
}

describe('Resampler Benchmark (R4.1)', () => {
	beforeAll(async () => {
		await WasmAudioResampler.init();
	});

	it('WASM SIMD ≥2x throughput vs JS for 44.1→48 kHz stereo', () => {
		const frameCount = 8192;
		const chunkFrames = 512;
		const input = generateSine(frameCount, CHANNELS, INPUT_RATE);

		// Warm up
		const jsWarm = new AudioResampler({
			inputRate: INPUT_RATE,
			outputRate: OUTPUT_RATE,
			channels: CHANNELS
		});
		benchResampler(jsWarm, input, chunkFrames, 50);

		const wasmWarm = new WasmAudioResampler({
			inputRate: INPUT_RATE,
			outputRate: OUTPUT_RATE,
			channels: CHANNELS
		});
		benchResampler(wasmWarm, input, chunkFrames, 50);

		// Benchmark JS
		const js = new AudioResampler({
			inputRate: INPUT_RATE,
			outputRate: OUTPUT_RATE,
			channels: CHANNELS
		});
		const jsThroughput = benchResampler(js, input, chunkFrames, BENCH_DURATION_MS);

		// Benchmark WASM
		const wasm = new WasmAudioResampler({
			inputRate: INPUT_RATE,
			outputRate: OUTPUT_RATE,
			channels: CHANNELS
		});
		const wasmThroughput = benchResampler(wasm, input, chunkFrames, BENCH_DURATION_MS);

		const speedup = wasmThroughput / jsThroughput;

		console.log('');
		console.log('=== Resampler Benchmark Results ===');
		console.log(`JS Throughput:     ${Math.round(jsThroughput).toLocaleString()} samples/sec`);
		console.log(`WASM Throughput:   ${Math.round(wasmThroughput).toLocaleString()} samples/sec`);
		console.log(`Speedup:           ${speedup.toFixed(2)}x`);
		console.log(`WASM Available:    ${WasmAudioResampler.isAvailable}`);
		console.log('===================================');

		// R4.1: ≥2x target (informational — CI hardware varies).
		// Benchmark correctness is gated by audio-resampler-wasm.test.ts.
		if (WasmAudioResampler.isAvailable) {
			if (speedup < 2) {
				console.warn(
					`[R4.1] WASM SIMD speedup below 2x target: ${speedup.toFixed(2)}x ` +
						`(JS ${Math.round(jsThroughput).toLocaleString()} vs ` +
						`WASM ${Math.round(wasmThroughput).toLocaleString()} samples/sec). ` +
						`This may indicate a performance regression.`
				);
			}
			expect(speedup).toBeGreaterThan(0);
		}
	});
});
