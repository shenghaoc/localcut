import { describe, expect, it, beforeAll } from 'vitest';
import { WasmAudioResampler, resampleBlockWasm } from './audio-resampler-wasm';
import { AudioResampler } from './audio-resampler';

describe('WasmAudioResampler', () => {
	beforeAll(async () => {
		await WasmAudioResampler.init();
	});

	it('passes through when input and output rates match', () => {
		const resampler = new WasmAudioResampler({
			inputRate: 48000,
			outputRate: 48000,
			channels: 1,
		});
		const input = new Float32Array([0.1, 0.2, 0.3, 0.4]);
		const output = resampler.process(input, 4);
		expect(output.length).toBe(4);
		for (let i = 0; i < 4; i++) {
			expect(output[i]).toBeCloseTo(input[i]!, 1);
		}
	});

	it('downsamples 48000 → 44100', () => {
		const inputRate = 48000;
		const outputRate = 44100;
		const frames = 480;
		const input = new Float32Array(frames);
		const freq = 440;
		for (let i = 0; i < frames; i++) {
			input[i] = Math.sin((2 * Math.PI * freq * i) / inputRate);
		}
		const resampler = new WasmAudioResampler({ inputRate, outputRate, channels: 1 });
		const output = resampler.process(input, frames);
		const tail = resampler.flush();
		const totalFrames = output.length + tail.length;
		const expectedFrames = Math.floor(frames * (outputRate / inputRate));
		expect(Math.abs(totalFrames - expectedFrames)).toBeLessThanOrEqual(20);
	});

	it('upsamples 44100 → 48000', () => {
		const inputRate = 44100;
		const outputRate = 48000;
		const frames = 441;
		const input = new Float32Array(frames);
		const freq = 440;
		for (let i = 0; i < frames; i++) {
			input[i] = Math.sin((2 * Math.PI * freq * i) / inputRate);
		}
		const resampler = new WasmAudioResampler({ inputRate, outputRate, channels: 1 });
		const output = resampler.process(input, frames);
		const tail = resampler.flush();
		const totalFrames = output.length + tail.length;
		const expectedFrames = Math.floor(frames * (outputRate / inputRate));
		expect(Math.abs(totalFrames - expectedFrames)).toBeLessThanOrEqual(20);
	});

	it('handles stereo input', () => {
		const resampler = new WasmAudioResampler({
			inputRate: 48000,
			outputRate: 24000,
			channels: 2,
		});
		const frames = 480;
		const input = new Float32Array(frames * 2);
		for (let i = 0; i < frames; i++) {
			input[i * 2] = Math.sin((2 * Math.PI * 440 * i) / 48000);
			input[i * 2 + 1] = Math.cos((2 * Math.PI * 440 * i) / 48000);
		}
		const output = resampler.process(input, frames);
		const tail = resampler.flush();
		expect(output.length % 2).toBe(0);
		expect(tail.length % 2).toBe(0);
		const totalFrames = (output.length + tail.length) / 2;
		expect(Math.abs(totalFrames - 240)).toBeLessThanOrEqual(20);
	});

	it('reset clears internal state', () => {
		const resampler = new WasmAudioResampler({
			inputRate: 48000,
			outputRate: 24000,
			channels: 1,
		});
		const input = new Float32Array(480).fill(0.5);
		resampler.process(input, 480);
		resampler.reset();
		const output = resampler.process(new Float32Array(48), 48);
		expect(output.length).toBeGreaterThan(0);
	});

	it('throws on invalid sample rate', () => {
		expect(
			() => new WasmAudioResampler({ inputRate: 0, outputRate: 48000, channels: 1 }),
		).toThrow('Sample rates must be positive');
	});

	it('throws on invalid channel count', () => {
		expect(
			() => new WasmAudioResampler({ inputRate: 48000, outputRate: 48000, channels: 0 }),
		).toThrow('Channel count must be positive');
	});

	it('preserves sine wave energy through 44100→48000 conversion', () => {
		const inputRate = 44100;
		const outputRate = 48000;
		const freq = 1000;
		const duration = 0.1;
		const frames = Math.floor(inputRate * duration);
		const input = new Float32Array(frames);
		for (let i = 0; i < frames; i++) {
			input[i] = Math.sin((2 * Math.PI * freq * i) / inputRate);
		}

		const resampler = new WasmAudioResampler({ inputRate, outputRate, channels: 1 });
		const output = resampler.process(input, frames);
		const tail = resampler.flush();

		const inputRMS = Math.sqrt(input.reduce((s, v) => s + v * v, 0) / input.length);
		const combined = new Float32Array(output.length + tail.length);
		combined.set(output);
		combined.set(tail, output.length);
		const mid = combined.subarray(
			Math.floor(combined.length * 0.2),
			Math.floor(combined.length * 0.8),
		);
		const outputRMS = Math.sqrt(mid.reduce((s, v) => s + v * v, 0) / mid.length);

		expect(outputRMS).toBeGreaterThan(inputRMS * 0.8);
		expect(outputRMS).toBeLessThan(inputRMS * 1.2);
	});

	it('handles streaming — consecutive process calls', () => {
		const resampler = new WasmAudioResampler({
			inputRate: 44100,
			outputRate: 48000,
			channels: 1,
		});
		const chunkSize = 1024;
		const chunks = 4;
		let totalOutput = 0;

		for (let c = 0; c < chunks; c++) {
			const input = new Float32Array(chunkSize);
			for (let i = 0; i < chunkSize; i++) {
				input[i] = Math.sin((2 * Math.PI * 440 * (c * chunkSize + i)) / 44100);
			}
			const output = resampler.process(input, chunkSize);
			totalOutput += output.length;
		}

		const expectedTotal = Math.floor((chunkSize * chunks * 48000) / 44100);
		expect(Math.abs(totalOutput - expectedTotal)).toBeLessThan(20);
	});

	it('output is within f32 tolerance of JS AudioResampler (R1.3)', () => {
		const inputRate = 44100;
		const outputRate = 48000;
		const freq = 1000;
		const frames = 1024;
		const input = new Float32Array(frames);
		for (let i = 0; i < frames; i++) {
			input[i] = Math.sin((2 * Math.PI * freq * i) / inputRate);
		}

		const jsResampler = new AudioResampler({ inputRate, outputRate, channels: 1 });
		const jsOutput = jsResampler.process(input, frames);

		const wasmResampler = new WasmAudioResampler({ inputRate, outputRate, channels: 1 });
		const wasmOutput = wasmResampler.process(input, frames);

		// Output lengths should be close
		expect(Math.abs(jsOutput.length - wasmOutput.length)).toBeLessThanOrEqual(5);

		// Compare up to the minimum length
		const minLen = Math.min(jsOutput.length, wasmOutput.length);
		let maxError = 0;
		for (let i = 0; i < minLen; i++) {
			const err = Math.abs(jsOutput[i]! - wasmOutput[i]!);
			if (err > maxError) maxError = err;
		}

		// < 1e-5 per-sample error tolerance (f64 → f32 precision reduction)
		expect(maxError).toBeLessThan(1e-5);
	});

	it('stereo output is within f32 tolerance of JS', () => {
		const inputRate = 48000;
		const outputRate = 44100;
		const frames = 960;
		const input = new Float32Array(frames * 2);
		for (let i = 0; i < frames; i++) {
			input[i * 2] = Math.sin((2 * Math.PI * 440 * i) / inputRate);
			input[i * 2 + 1] = Math.cos((2 * Math.PI * 880 * i) / inputRate);
		}

		const jsResampler = new AudioResampler({ inputRate, outputRate, channels: 2 });
		const jsOutput = jsResampler.process(input, frames);

		const wasmResampler = new WasmAudioResampler({ inputRate, outputRate, channels: 2 });
		const wasmOutput = wasmResampler.process(input, frames);

		expect(Math.abs(jsOutput.length - wasmOutput.length)).toBeLessThanOrEqual(10);

		const minLen = Math.min(jsOutput.length, wasmOutput.length);
		let maxError = 0;
		for (let i = 0; i < minLen; i++) {
			const err = Math.abs(jsOutput[i]! - wasmOutput[i]!);
			if (err > maxError) maxError = err;
		}
		expect(maxError).toBeLessThan(1e-5);
	});
});

describe('resampleBlockWasm', () => {
	beforeAll(async () => {
		await WasmAudioResampler.init();
	});

	it('returns a copy when rates match', () => {
		const input = new Float32Array([0.1, 0.2, 0.3]);
		const output = resampleBlockWasm(input, 3, 48000, 48000, 1);
		expect(output.length).toBe(3);
		expect([...output]).toEqual([...input]);
		input[0] = 999;
		expect(output[0]).toBeCloseTo(0.1);
	});

	it('resamples a block from 44100 to 48000', () => {
		const frames = 441;
		const input = new Float32Array(frames);
		for (let i = 0; i < frames; i++) {
			input[i] = Math.sin((2 * Math.PI * 440 * i) / 44100);
		}
		const output = resampleBlockWasm(input, frames, 44100, 48000, 1);
		const expected = Math.round((frames * 48000) / 44100);
		expect(Math.abs(output.length - expected)).toBeLessThan(20);
	});
});

describe('WasmAudioResampler SIMD feature detection', () => {
	it('WasmAudioResampler.isAvailable reflects runtime availability', () => {
		// In Node.js (v18+), WebAssembly and SIMD are typically available
		if (typeof WebAssembly !== 'undefined') {
			expect(typeof WasmAudioResampler.isAvailable).toBe('boolean');
		}
	});
});
