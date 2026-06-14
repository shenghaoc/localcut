/**
 * Unit tests for beat-analysis.ts -- DSP helpers and analysis pipeline.
 */

import { describe, expect, it } from 'vite-plus/test';
import {
	hannWindow,
	spectralFlux,
	pickOnsets,
	estimateTempo,
	alignBeatGrid,
	encodeDeltaBeatTimes,
	decodeDeltaBeatTimes,
	analyseBeatTimes
} from './beat-analysis';

// ---------------------------------------------------------------------------
// hannWindow
// ---------------------------------------------------------------------------

describe('hannWindow', () => {
	it('returns correct coefficients at boundary and midpoint', () => {
		const w = hannWindow(1024);
		expect(w.length).toBe(1024);
		expect(w[0]).toBeCloseTo(0, 4);
		expect(w[512]).toBeCloseTo(1.0, 4);
		expect(w[1023]).toBeCloseTo(0, 4);
	});

	it('is symmetric', () => {
		const w = hannWindow(1024);
		for (let n = 0; n < 1024; n++) {
			expect(w[n]).toBeCloseTo(w[1023 - n], 10);
		}
	});
});

// ---------------------------------------------------------------------------
// spectralFlux
// ---------------------------------------------------------------------------

describe('spectralFlux', () => {
	it('returns 0 on identical magnitudes', () => {
		const mag = new Float32Array([1, 2, 3, 4, 5]);
		expect(spectralFlux(mag, mag)).toBeCloseTo(0, 6);
	});

	it('returns positive value when current magnitudes increase', () => {
		const prev = new Float32Array([1, 1, 1]);
		const cur = new Float32Array([2, 2, 2]);
		const flux = spectralFlux(cur, prev);
		expect(flux).toBeGreaterThan(0);
	});

	it('ignores negative differences (half-wave rectification)', () => {
		const prev = new Float32Array([5, 5, 5]);
		const cur = new Float32Array([1, 1, 1]);
		expect(spectralFlux(cur, prev)).toBeCloseTo(0, 6);
	});
});

// ---------------------------------------------------------------------------
// pickOnsets
// ---------------------------------------------------------------------------

describe('pickOnsets', () => {
	it('picks peaks above threshold and enforces min gap', () => {
		// 100-frame flux array with two clear peaks
		// Use W=4 and alpha=1.1 for simpler threshold behavior
		const flux = new Float32Array(100);
		// Set a low baseline
		for (let i = 0; i < 100; i++) flux[i] = 0.01;
		// Peak at frame 20 (well above threshold)
		flux[20] = 10.0;
		// Peak at frame 60 (well above threshold)
		flux[60] = 10.0;
		// Too-close peak at frame 62 (within min gap)
		flux[62] = 10.0;

		const hopSeconds = 512 / 48000; // ~0.01067s
		// Use smaller W and alpha to make threshold less aggressive
		const onsets = pickOnsets(flux, hopSeconds, 4, 1.1, 0.25);

		// Should find onset at frame 20 and frame 60, but NOT frame 62
		expect(onsets.length).toBe(2);
		expect(onsets[0]).toBeCloseTo(20 * hopSeconds, 3);
		expect(onsets[1]).toBeCloseTo(60 * hopSeconds, 3);
	});
});

// ---------------------------------------------------------------------------
// estimateTempo
// ---------------------------------------------------------------------------

describe('estimateTempo', () => {
	it('estimates 120 BPM from synthetic onset envelope', () => {
		// Create a synthetic onset-strength array with impulses every 47 frames
		// 120 BPM = 0.5s per beat, at hopSeconds=512/48000 ~ 0.01067s
		// 0.5 / 0.01067 ~ 46.87 frames per beat -> 47 frames
		const hopSeconds = 512 / 48000;
		const frameCount = 1000;
		const onsetStrength = new Float32Array(frameCount);
		for (let i = 0; i < frameCount; i += 47) {
			onsetStrength[i] = 1.0;
		}

		const bpm = estimateTempo(onsetStrength, hopSeconds);
		// Allow wider tolerance due to parabolic interpolation effects
		expect(bpm).toBeGreaterThanOrEqual(115);
		expect(bpm).toBeLessThanOrEqual(125);
	});
});

// ---------------------------------------------------------------------------
// alignBeatGrid
// ---------------------------------------------------------------------------

describe('alignBeatGrid', () => {
	it('produces beats within duration', () => {
		const hopSeconds = 512 / 48000;
		const frameCount = 1000;
		const onsetStrength = new Float32Array(frameCount);
		// Put some energy at the start
		for (let i = 0; i < 10; i++) onsetStrength[i] = 1.0;

		const beats = alignBeatGrid(120, onsetStrength, hopSeconds, 10);
		for (const beat of beats) {
			expect(beat).toBeGreaterThanOrEqual(0);
			expect(beat).toBeLessThanOrEqual(10);
		}
		expect(beats.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// Delta encoding
// ---------------------------------------------------------------------------

describe('encodeDeltaBeatTimes / decodeDeltaBeatTimes', () => {
	it('round-trips correctly', () => {
		const original = [500, 1000, 1500];
		const encoded = encodeDeltaBeatTimes(original);
		expect(encoded).toEqual([500, 500, 500]);
		const decoded = decodeDeltaBeatTimes(encoded);
		expect(decoded).toEqual([500, 1000, 1500]);
	});

	it('handles empty array', () => {
		expect(encodeDeltaBeatTimes([])).toEqual([]);
		expect(decodeDeltaBeatTimes([])).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// analyseBeatTimes (determinism)
// ---------------------------------------------------------------------------

describe('analyseBeatTimes', () => {
	it('produces deterministic results across two calls', async () => {
		// Create a mock SequentialAudioSource that returns a 2-second 440 Hz sine
		const sampleRate = 48000;
		const duration = 2;
		const totalFrames = sampleRate * duration;
		const pcm = new Float32Array(totalFrames);
		for (let i = 0; i < totalFrames; i++) {
			pcm[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5;
		}

		const mockSource = {
			async pcmWindowAt(
				time: number,
				frameCount: number,
				_channels: number,
				targetSampleRate?: number
			) {
				const startFrame = Math.floor(time * (targetSampleRate ?? sampleRate));
				const result = new Float32Array(frameCount);
				for (let i = 0; i < frameCount; i++) {
					const idx = startFrame + i;
					result[i] = idx >= 0 && idx < pcm.length ? pcm[idx] : 0;
				}
				return result;
			}
		};

		const result1 = await analyseBeatTimes(
			mockSource as unknown as Parameters<typeof analyseBeatTimes>[0],
			duration
		);
		const result2 = await analyseBeatTimes(
			mockSource as unknown as Parameters<typeof analyseBeatTimes>[0],
			duration
		);

		expect(result1.tempoBpm).toBe(result2.tempoBpm);
		expect(result1.beatTimesMs).toEqual(result2.beatTimesMs);
		expect(result1.analyserVersion).toBe(1);
	});
});
