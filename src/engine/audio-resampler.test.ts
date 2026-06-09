import { describe, expect, it } from 'vitest';
import { AudioResampler, resampleBlock } from './audio-resampler';

describe('AudioResampler', () => {
	it('passes through when input and output rates match', () => {
		const resampler = new AudioResampler({
			inputRate: 48000,
			outputRate: 48000,
			channels: 1
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
		const resampler = new AudioResampler({ inputRate, outputRate, channels: 1 });
		const output = resampler.process(input, frames);
		const expectedFrames = Math.floor(frames * (outputRate / inputRate));
		expect(Math.abs(output.length - expectedFrames)).toBeLessThanOrEqual(2);
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
		const resampler = new AudioResampler({ inputRate, outputRate, channels: 1 });
		const output = resampler.process(input, frames);
		const expectedFrames = Math.floor(frames * (outputRate / inputRate));
		expect(Math.abs(output.length - expectedFrames)).toBeLessThanOrEqual(2);
	});

	it('handles stereo input', () => {
		const resampler = new AudioResampler({
			inputRate: 48000,
			outputRate: 24000,
			channels: 2
		});
		const frames = 480;
		const input = new Float32Array(frames * 2);
		for (let i = 0; i < frames; i++) {
			input[i * 2] = Math.sin((2 * Math.PI * 440 * i) / 48000);
			input[i * 2 + 1] = Math.cos((2 * Math.PI * 440 * i) / 48000);
		}
		const output = resampler.process(input, frames);
		expect(output.length % 2).toBe(0);
		const outFrames = output.length / 2;
		expect(Math.abs(outFrames - 240)).toBeLessThanOrEqual(2);
	});

	it('reset clears internal state', () => {
		const resampler = new AudioResampler({
			inputRate: 48000,
			outputRate: 24000,
			channels: 1
		});
		const input = new Float32Array(480).fill(0.5);
		resampler.process(input, 480);
		resampler.reset();
		const output = resampler.process(new Float32Array(48), 48);
		expect(output.length).toBeGreaterThan(0);
	});

	it('throws on invalid sample rate', () => {
		expect(
			() => new AudioResampler({ inputRate: 0, outputRate: 48000, channels: 1 })
		).toThrow('Sample rates must be positive');
	});

	it('throws on invalid channel count', () => {
		expect(
			() => new AudioResampler({ inputRate: 48000, outputRate: 48000, channels: 0 })
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

		const resampler = new AudioResampler({ inputRate, outputRate, channels: 1 });
		const output = resampler.process(input, frames);
		const tail = resampler.flush();

		const inputRMS = Math.sqrt(input.reduce((s, v) => s + v * v, 0) / input.length);
		const combined = new Float32Array(output.length + tail.length);
		combined.set(output);
		combined.set(tail, output.length);
		const mid = combined.subarray(
			Math.floor(combined.length * 0.2),
			Math.floor(combined.length * 0.8)
		);
		const outputRMS = Math.sqrt(mid.reduce((s, v) => s + v * v, 0) / mid.length);

		expect(outputRMS).toBeGreaterThan(inputRMS * 0.8);
		expect(outputRMS).toBeLessThan(inputRMS * 1.2);
	});

	it('handles streaming — consecutive process calls', () => {
		const resampler = new AudioResampler({
			inputRate: 44100,
			outputRate: 48000,
			channels: 1
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
});

describe('resampleBlock', () => {
	it('returns a copy when rates match', () => {
		const input = new Float32Array([0.1, 0.2, 0.3]);
		const output = resampleBlock(input, 3, 48000, 48000, 1);
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
		const output = resampleBlock(input, frames, 44100, 48000, 1);
		const expected = Math.round((frames * 48000) / 44100);
		expect(Math.abs(output.length - expected)).toBeLessThan(20);
	});
});
