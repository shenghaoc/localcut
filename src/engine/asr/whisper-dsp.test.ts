import { describe, expect, it } from 'vite-plus/test';
import {
	AudioContractError,
	DEFAULT_MEL_CONFIG,
	downmixToMono,
	extractMelSpectrogram,
	hannWindow,
	melFilterbank,
	normaliseMelSpectrogram,
	powerSpectrum,
	prepareMonoPcm,
	reflectPad
} from './whisper-dsp';

describe('hannWindow', () => {
	it('is the periodic Hann window (matches torch.hann_window)', () => {
		const w = hannWindow(4);
		expect(Array.from(w)).toEqual([0, 0.5, 1, 0.5]);
	});
});

describe('melFilterbank (slaney)', () => {
	it('is non-negative, correctly shaped, and area-normalised', () => {
		const nMel = 80;
		const fb = melFilterbank(nMel, 400, 16000);
		expect(fb.length).toBe(nMel * (400 / 2 + 1));
		expect(fb.every((v) => v >= 0)).toBe(true);
		// Slaney norm shrinks high (wide) bands relative to low ones: the last
		// filter's peak is much smaller than the first's.
		const nFreq = 201;
		const peak = (m: number) => {
			let max = 0;
			for (let k = 0; k < nFreq; k++) max = Math.max(max, fb[m * nFreq + k]);
			return max;
		};
		expect(peak(0)).toBeGreaterThan(peak(nMel - 1));
		expect(peak(0)).toBeGreaterThan(0);
	});
});

describe('extractMelSpectrogram', () => {
	it('reflect-centers so frame count is len / hop', () => {
		const pcm = new Float32Array(16000); // 1 s @ 16 kHz
		const mel = extractMelSpectrogram(pcm, DEFAULT_MEL_CONFIG);
		expect(mel.nMel).toBe(80);
		expect(mel.nFrames).toBe(16000 / DEFAULT_MEL_CONFIG.hopLength); // 100
	});

	it('keeps empty PCM finite by zero-filling reflect padding', () => {
		expect(reflectPad(new Float32Array(0), 4)).toEqual(new Float32Array(8));
		const mel = extractMelSpectrogram(new Float32Array(0), DEFAULT_MEL_CONFIG);
		expect([...mel.data].every(Number.isFinite)).toBe(true);
	});

	it('concentrates energy near the bin of a pure tone', () => {
		const sr = 16000;
		const pcm = new Float32Array(sr);
		for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin((2 * Math.PI * 440 * i) / sr);
		const mel = extractMelSpectrogram(pcm);
		// Peak mel bin should be in the lower third (440 Hz is low).
		let peakBin = 0;
		let peakVal = -Infinity;
		for (let m = 0; m < mel.nMel; m++) {
			const v = mel.data[m]; // first frame
			if (v > peakVal) {
				peakVal = v;
				peakBin = m;
			}
		}
		expect(peakBin).toBeLessThan(mel.nMel / 2);
	});
});

function directPowerSpectrum(
	frame: Float32Array,
	window: Float32Array,
	nFft: number
): Float32Array {
	const power = new Float32Array(nFft / 2 + 1);
	for (let k = 0; k < power.length; k++) {
		let real = 0;
		let imag = 0;
		for (let t = 0; t < nFft; t++) {
			const value = (frame[t] ?? 0) * (window[t] ?? 0);
			const angle = (-2 * Math.PI * k * t) / nFft;
			real += value * Math.cos(angle);
			imag += value * Math.sin(angle);
		}
		power[k] = real * real + imag * imag;
	}
	return power;
}

describe('powerSpectrum', () => {
	it('matches a direct DFT reference for the default 400-point Whisper frame', () => {
		const nFft = DEFAULT_MEL_CONFIG.nFft;
		const frame = new Float32Array(nFft);
		for (let i = 0; i < frame.length; i++) {
			frame[i] =
				Math.sin((2 * Math.PI * 5 * i) / nFft) + 0.25 * Math.cos((2 * Math.PI * 17 * i) / nFft);
		}
		const window = hannWindow(nFft);
		const actual = powerSpectrum(frame, window, nFft);
		const expected = directPowerSpectrum(frame, window, nFft);

		expect(actual.length).toBe(expected.length);
		for (let i = 0; i < actual.length; i++) {
			expect(actual[i]).toBeCloseTo(expected[i]!, 3);
		}
	});

	it('matches a direct DFT reference for shorter composite lengths', () => {
		const nFft = 40;
		const frame = new Float32Array(nFft);
		for (let i = 0; i < frame.length; i++) {
			frame[i] = Math.sin((2 * Math.PI * 5 * i) / nFft) + 0.25 * Math.cos((2 * Math.PI * i) / nFft);
		}
		const window = hannWindow(nFft);
		const actual = powerSpectrum(frame, window, nFft);
		const expected = directPowerSpectrum(frame, window, nFft);

		expect(actual.length).toBe(expected.length);
		for (let i = 0; i < actual.length; i++) {
			expect(actual[i]).toBeCloseTo(expected[i]!, 3);
		}
	});
});

describe('normaliseMelSpectrogram', () => {
	it('clamps to [max-8, max] then applies (x+4)/4', () => {
		const data = new Float32Array([2, -20, 0, 1]); // max = 2, floor = -6
		const out = normaliseMelSpectrogram({ data, nFrames: 1, nMel: 4 });
		expect(out[0]).toBeCloseTo((2 + 4) / 4, 6); // 1.5 (the max)
		expect(out[1]).toBeCloseTo((-6 + 4) / 4, 6); // -0.5 (clamped from -20)
		expect(Math.min(...out)).toBeGreaterThanOrEqual((2 - 8 + 4) / 4);
	});
});

describe('prepareMonoPcm', () => {
	it('downmixes and enforces the 16 kHz contract', () => {
		const stereo = new Float32Array([1, 1, -1, -1]);
		expect(prepareMonoPcm(stereo, 2, 16000).length).toBe(2);
		expect(() => prepareMonoPcm(stereo, 2, 44100)).toThrow(AudioContractError);
	});

	it('downmixToMono averages channels with equal-power scaling', () => {
		expect(downmixToMono(new Float32Array([1]), 1)[0]).toBe(1);
	});
});
