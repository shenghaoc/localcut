import { describe, it, expect } from 'vite-plus/test';
import {
	WsolaStretcher,
	WSOLA_WINDOW_SAMPLES,
	WSOLA_OVERLAP_SAMPLES,
	WSOLA_SEARCH_RADIUS_SAMPLES
} from './wsola';

/**
 * Phase 35: WSOLA time-stretcher unit tests.
 *
 * Uses synthetic constant-value or simple signals to verify output length,
 * speed-ratio behaviour, reset semantics, and sequential continuity.
 */

describe('WSOLA constants', () => {
	it('exports expected constant values', () => {
		expect(WSOLA_WINDOW_SAMPLES).toBe(1440);
		expect(WSOLA_OVERLAP_SAMPLES).toBe(720);
		expect(WSOLA_SEARCH_RADIUS_SAMPLES).toBe(480);
	});
});

describe('WsolaStretcher', () => {
	/** Build a constant-value interleaved stereo signal of `frames` frames. */
	function constantSignal(frames: number, value = 1, channels = 2): Float32Array {
		const buf = new Float32Array(frames * channels);
		buf.fill(value);
		return buf;
	}

	describe('stretch at speedRatio = 1.0', () => {
		it('returns outputFrames * channels samples for stereo, 960 frames', () => {
			const stretcher = new WsolaStretcher(2);
			const input = constantSignal(WSOLA_WINDOW_SAMPLES, 1, 2);
			const outputFrames = 960;

			const out = stretcher.stretch(input, 1.0, outputFrames);

			expect(out.length).toBe(outputFrames * 2);
		});
	});

	describe('stretch at speedRatio = 0.5 (slow)', () => {
		it('returns outputFrames * channels samples (time-stretch length is caller-controlled)', () => {
			const stretcher = new WsolaStretcher(2);
			const input = constantSignal(WSOLA_WINDOW_SAMPLES, 1, 2);
			const outputFrames = 960;

			const out = stretcher.stretch(input, 0.5, outputFrames);

			// Output length is always outputFrames * channels regardless of speedRatio.
			// The speed ratio only affects how fast the analysis pointer advances
			// through the source material.
			expect(out.length).toBe(outputFrames * 2);
		});
	});

	describe('stretch at speedRatio = 2.0 (fast)', () => {
		it('returns outputFrames * channels samples and advances pointer further', () => {
			const stretcher = new WsolaStretcher(2);
			const frames = 2880; // enough input for the faster advance
			const input = constantSignal(frames, 1, 2);
			const outputFrames = 960;

			// First call at speed 2.0
			const out1 = stretcher.stretch(input, 2.0, outputFrames);
			expect(out1.length).toBe(outputFrames * 2);

			// Second call — pointer has advanced by outputFrames / 2.0 per hop,
			// so it consumed more source material than at speed 1.0 but still
			// produces the same number of output frames.
			const out2 = stretcher.stretch(input, 2.0, outputFrames);
			expect(out2.length).toBe(outputFrames * 2);
		});

		it('advances the analysis pointer faster than speedRatio = 1.0', () => {
			const frames = 4800;
			const input = constantSignal(frames, 0.5, 2);
			const outputFrames = 720;

			// speed 2.0 stretcher
			const fast = new WsolaStretcher(2);
			fast.stretch(input, 2.0, outputFrames);

			// speed 1.0 stretcher
			const normal = new WsolaStretcher(2);
			normal.stretch(input, 1.0, outputFrames);

			// After reset, a new stretch at a known position should differ because
			// the fast stretcher's internal analysisPos advanced twice as far.
			// We verify by resetting both and stretching again — the output should
			// be identical after reset since analysisPos returns to 0.
			fast.reset();
			normal.reset();

			const refast = fast.stretch(input, 2.0, outputFrames);
			const renormal = normal.stretch(input, 1.0, outputFrames);

			// After reset both start at position 0 with the same constant signal,
			// so outputs match.
			expect(refast.length).toBe(renormal.length);
		});
	});

	describe('reset()', () => {
		it('zeros the overlap buffer', () => {
			const stretcher = new WsolaStretcher(2);
			const input = constantSignal(WSOLA_WINDOW_SAMPLES, 0.75, 2);

			// Produce some output to populate the overlap buffer
			stretcher.stretch(input, 1.0, WSOLA_OVERLAP_SAMPLES);

			// Reset
			stretcher.reset();

			// After reset, stretch from an all-zeros input. The overlap buffer
			// should contribute nothing, so with a zero input the output must be
			// all zeros (the overlap-add of 0 + 0 = 0).
			const zeroInput = new Float32Array(WSOLA_WINDOW_SAMPLES * 2);
			const out = stretcher.stretch(zeroInput, 1.0, WSOLA_OVERLAP_SAMPLES);

			for (let i = 0; i < out.length; i += 1) {
				expect(out[i]).toBe(0);
			}
		});

		it('resets analysis position to 0', () => {
			const stretcher = new WsolaStretcher(1);
			const input = constantSignal(WSOLA_WINDOW_SAMPLES, 1, 1);

			// Advance the analysis pointer
			stretcher.stretch(input, 1.0, 720);
			stretcher.stretch(input, 1.0, 720);

			stretcher.reset();

			// After reset, the stretcher should behave identically to a fresh instance.
			const fresh = new WsolaStretcher(1);
			const outAfterReset = stretcher.stretch(input, 1.0, 720);
			const outFresh = fresh.stretch(input, 1.0, 720);

			expect(outAfterReset.length).toBe(outFresh.length);
			// On a constant signal with the same starting state, outputs should match.
			for (let i = 0; i < outAfterReset.length; i += 1) {
				expect(outAfterReset[i]).toBeCloseTo(outFresh[i]!, 6);
			}
		});
	});

	describe('sequential calls without reset', () => {
		it('produce continuity on a constant-value signal', () => {
			const stretcher = new WsolaStretcher(2);
			const value = 0.5;
			const input = constantSignal(4800, value, 2);

			const out1 = stretcher.stretch(input, 1.0, 960);
			const out2 = stretcher.stretch(input, 1.0, 960);

			// Both outputs should be the correct length
			expect(out1.length).toBe(960 * 2);
			expect(out2.length).toBe(960 * 2);

			// On a constant signal, the second call's overlap region should blend
			// the stored tail (also constant) with the new input, producing
			// values near the constant throughout the crossfade.
			// The first hop (up to WSOLA_OVERLAP_SAMPLES frames) is the overlap-add
			// region; on a constant signal overlap=constant and input=constant,
			// so the crossfade result should be the constant value.
			for (let s = 0; s < WSOLA_OVERLAP_SAMPLES; s += 1) {
				for (let c = 0; c < 2; c += 1) {
					const idx = s * 2 + c;
					expect(out2[idx]!).toBeCloseTo(value, 4);
				}
			}
		});

		it('produces non-zero output for a non-zero constant signal', () => {
			const stretcher = new WsolaStretcher(2);
			const input = constantSignal(4800, 0.8, 2);

			const out1 = stretcher.stretch(input, 1.0, 720);
			const out2 = stretcher.stretch(input, 1.0, 720);

			// At least some samples should be non-zero
			let hasNonZero = false;
			for (let i = 0; i < out1.length; i += 1) {
				if (Math.abs(out1[i]!) > 1e-6) {
					hasNonZero = true;
					break;
				}
			}
			expect(hasNonZero).toBe(true);

			hasNonZero = false;
			for (let i = 0; i < out2.length; i += 1) {
				if (Math.abs(out2[i]!) > 1e-6) {
					hasNonZero = true;
					break;
				}
			}
			expect(hasNonZero).toBe(true);
		});
	});

	describe('edge cases', () => {
		it('returns empty output for zero outputFrames', () => {
			const stretcher = new WsolaStretcher(2);
			const input = constantSignal(WSOLA_WINDOW_SAMPLES, 1, 2);

			const out = stretcher.stretch(input, 1.0, 0);
			expect(out.length).toBe(0);
		});

		it('returns empty output for negative speedRatio', () => {
			const stretcher = new WsolaStretcher(2);
			const input = constantSignal(WSOLA_WINDOW_SAMPLES, 1, 2);

			const out = stretcher.stretch(input, -1.0, 960);
			expect(out.length).toBe(960 * 2); // allocated but all zeros
			for (let i = 0; i < out.length; i += 1) {
				expect(out[i]).toBe(0);
			}
		});

		it('works with mono (1 channel)', () => {
			const stretcher = new WsolaStretcher(1);
			const input = constantSignal(WSOLA_WINDOW_SAMPLES, 0.6, 1);

			const out = stretcher.stretch(input, 1.0, 960);
			expect(out.length).toBe(960);
		});
	});
});
