import { describe, expect, it } from 'vite-plus/test';
import { createFrameSpectra, FRAME_SIZE, NB_BANDS, NB_FEATURES, RnnoiseDsp } from './rnnoise-dsp';

/** Deterministic multi-tone test signal, band-limited well below 20 kHz so the
 *  band-gain interpolation (which has no bands above 20 kHz) passes it intact. */
function testSignal(samples: number): Float32Array {
	const out = new Float32Array(samples);
	const tones = [
		{ f: 220, a: 0.11 },
		{ f: 997, a: 0.13 },
		{ f: 3203, a: 0.07 },
		{ f: 7919, a: 0.05 },
		{ f: 12007, a: 0.03 }
	];
	for (let i = 0; i < samples; i++) {
		let v = 0;
		for (const { f, a } of tones) {
			v += a * Math.sin((2 * Math.PI * f * i) / 48000 + f);
		}
		out[i] = v;
	}
	return out;
}

/** Reference high-pass biquad identical to the one inside the DSP. */
function biquadHp(input: Float32Array): Float32Array {
	const out = new Float32Array(input.length);
	let mem0 = 0;
	let mem1 = 0;
	for (let i = 0; i < input.length; i++) {
		const xi = input[i]! * 32768;
		const yi = xi + mem0;
		mem0 = mem1 + (-2 * xi - -1.99599 * yi);
		mem1 = 1 * xi - 0.996 * yi;
		out[i] = yi / 32768;
	}
	return out;
}

describe('RnnoiseDsp', () => {
	it('reconstructs the (high-passed) input with unit gains, delayed by one frame', () => {
		const frames = 12;
		const input = testSignal(frames * FRAME_SIZE);
		const expected = biquadHp(input);
		const dsp = new RnnoiseDsp();
		const features = new Float32Array(NB_FEATURES);
		const gains = new Float32Array(NB_BANDS).fill(1);
		const out = new Float32Array(frames * FRAME_SIZE);
		const frameOut = new Float32Array(FRAME_SIZE);
		for (let n = 0; n < frames; n++) {
			const spectra = createFrameSpectra();
			const frame = input.subarray(n * FRAME_SIZE, (n + 1) * FRAME_SIZE);
			const silence = dsp.preProcessFrame(frame, features, spectra);
			expect(silence).toBe(false);
			dsp.postProcessFrame(gains, spectra, frameOut);
			out.set(frameOut, n * FRAME_SIZE);
		}
		// Output frame n reproduces input frame n-1 (one-frame algorithmic delay);
		// skip the first output frame, which overlaps the zero history. Tolerance
		// allows the intrinsic pitch-filter contribution on strongly periodic
		// content (present in the C reference too) while still failing loudly on
		// real porting bugs, which produce errors on the order of the signal.
		let errorEnergy = 0;
		let signalEnergy = 0;
		let maxError = 0;
		for (let i = FRAME_SIZE; i < frames * FRAME_SIZE; i++) {
			const diff = out[i]! - expected[i - FRAME_SIZE]!;
			errorEnergy += diff * diff;
			signalEnergy += expected[i - FRAME_SIZE]! * expected[i - FRAME_SIZE]!;
			maxError = Math.max(maxError, Math.abs(diff));
		}
		expect(maxError).toBeLessThan(0.02);
		expect(Math.sqrt(errorEnergy / signalEnergy)).toBeLessThan(0.03);
	});

	it('flags digital silence and zeroes the features', () => {
		const dsp = new RnnoiseDsp();
		const features = new Float32Array(NB_FEATURES).fill(123);
		const spectra = createFrameSpectra();
		const silence = dsp.preProcessFrame(new Float32Array(FRAME_SIZE), features, spectra);
		expect(silence).toBe(true);
		expect([...features]).toEqual(Array.from({ length: NB_FEATURES }, () => 0));
	});

	it('produces finite, bounded features for real audio', () => {
		const dsp = new RnnoiseDsp();
		const features = new Float32Array(NB_FEATURES);
		const input = testSignal(8 * FRAME_SIZE);
		for (let n = 0; n < 8; n++) {
			const spectra = createFrameSpectra();
			dsp.preProcessFrame(input.subarray(n * FRAME_SIZE, (n + 1) * FRAME_SIZE), features, spectra);
		}
		for (const value of features) {
			expect(Number.isFinite(value)).toBe(true);
			expect(Math.abs(value)).toBeLessThan(100);
		}
	});

	it('attenuates output when band gains are low', () => {
		const frames = 8;
		const input = testSignal(frames * FRAME_SIZE);
		const run = (gainValue: number): number => {
			const dsp = new RnnoiseDsp();
			const features = new Float32Array(NB_FEATURES);
			const gains = new Float32Array(NB_BANDS).fill(gainValue);
			const frameOut = new Float32Array(FRAME_SIZE);
			let energy = 0;
			for (let n = 0; n < frames; n++) {
				const spectra = createFrameSpectra();
				dsp.preProcessFrame(
					input.subarray(n * FRAME_SIZE, (n + 1) * FRAME_SIZE),
					features,
					spectra
				);
				dsp.postProcessFrame(gains, spectra, frameOut);
				if (n > 0) for (const v of frameOut) energy += v * v;
			}
			return energy;
		};
		const full = run(1);
		const attenuated = run(0.1);
		expect(attenuated).toBeLessThan(full * 0.2);
		expect(attenuated).toBeGreaterThan(0);
	});

	it('keeps concurrent instances independent (no shared mutable scratch)', () => {
		const frames = 4;
		const inputA = testSignal(frames * FRAME_SIZE);
		const inputB = testSignal(frames * FRAME_SIZE).map((v, i) => v * Math.sin(i * 0.37));
		const gains = new Float32Array(NB_BANDS).fill(1);

		const processFrame = (dsp: RnnoiseDsp, input: Float32Array, n: number): Float32Array => {
			const features = new Float32Array(NB_FEATURES);
			const frameOut = new Float32Array(FRAME_SIZE);
			const spectra = createFrameSpectra();
			dsp.preProcessFrame(input.subarray(n * FRAME_SIZE, (n + 1) * FRAME_SIZE), features, spectra);
			dsp.postProcessFrame(gains, spectra, frameOut);
			return frameOut;
		};

		// Reference: instance A runs alone.
		const alone = new RnnoiseDsp();
		const aloneOut: number[] = [];
		for (let n = 0; n < frames; n++) aloneOut.push(...processFrame(alone, inputA, n));

		// Same input on A, but with instance B processing different audio
		// between every A frame; A's output must be unaffected.
		const a = new RnnoiseDsp();
		const b = new RnnoiseDsp();
		const interleavedOut: number[] = [];
		for (let n = 0; n < frames; n++) {
			interleavedOut.push(...processFrame(a, inputA, n));
			processFrame(b, inputB, n);
		}

		expect(interleavedOut).toEqual(aloneOut);
	});

	it('reset() clears streaming state so identical inputs give identical outputs', () => {
		const input = testSignal(4 * FRAME_SIZE);
		const dsp = new RnnoiseDsp();
		const runOnce = (): Float32Array => {
			const features = new Float32Array(NB_FEATURES);
			const gains = new Float32Array(NB_BANDS).fill(1);
			const frameOut = new Float32Array(FRAME_SIZE);
			const out = new Float32Array(4 * FRAME_SIZE);
			for (let n = 0; n < 4; n++) {
				const spectra = createFrameSpectra();
				dsp.preProcessFrame(
					input.subarray(n * FRAME_SIZE, (n + 1) * FRAME_SIZE),
					features,
					spectra
				);
				dsp.postProcessFrame(gains, spectra, frameOut);
				out.set(frameOut, n * FRAME_SIZE);
			}
			return out;
		};
		const first = runOnce();
		dsp.reset();
		const second = runOnce();
		expect([...second]).toEqual([...first]);
	});
});
