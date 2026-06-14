import { describe, expect, it } from 'vite-plus/test';
import { ANIM_CAPTION_PRESETS } from './anim-style';
import {
	CAPTION_ANIM_IDENTITY,
	computeCaptionAnimUniforms,
	karaokeActiveWordIndex
} from './animation-curves';

describe('animation-curves', () => {
	describe('computeCaptionAnimUniforms', () => {
		it('returns identity for a preset with no animation', () => {
			const preset = ANIM_CAPTION_PRESETS.find((p) => p.id === 'subtitle')!;
			const u = computeCaptionAnimUniforms(preset, 0, 5, 2.5);
			expect(u).toEqual(CAPTION_ANIM_IDENTITY);
		});

		it('returns identity outside segment range', () => {
			const preset = ANIM_CAPTION_PRESETS.find((p) => p.id === 'pop-card')!;
			const u = computeCaptionAnimUniforms(preset, 10, 5, 2);
			expect(u).toEqual(CAPTION_ANIM_IDENTITY);
		});

		describe('pop', () => {
			const preset = ANIM_CAPTION_PRESETS.find((p) => p.id === 'pop-card')!;

			it('at t=0 (start of enter): opacity near 0, scale near 0', () => {
				const u = computeCaptionAnimUniforms(preset, 0, 5, 0);
				expect(u.opacity).toBeLessThan(0.05);
				expect(u.scaleX).toBeLessThan(0.05);
			});

			it('at t=0.5 (mid enter): opacity and scale rising', () => {
				const dur = preset.animation!.durationS;
				const u = computeCaptionAnimUniforms(preset, 0, 5, dur * 0.5);
				expect(u.opacity).toBeGreaterThan(0.3);
				expect(u.scaleX).toBeGreaterThan(0.5);
			});

			it('at t=1 (end of enter): identity (hold phase)', () => {
				const dur = preset.animation!.durationS;
				const u = computeCaptionAnimUniforms(preset, 0, 5, dur);
				expect(u.opacity).toBe(1);
				expect(u.scaleX).toBe(1);
			});
		});

		describe('bounce', () => {
			const preset = ANIM_CAPTION_PRESETS.find((p) => p.id === 'bounce-card')!;

			it('at t=0: translateY starts high, opacity near 0', () => {
				const u = computeCaptionAnimUniforms(preset, 0, 5, 0);
				expect(u.translateYPx).toBeGreaterThan(30);
				expect(u.opacity).toBeLessThan(0.05);
			});

			it('at t=1 (end of enter): identity', () => {
				const dur = preset.animation!.durationS;
				const u = computeCaptionAnimUniforms(preset, 0, 5, dur);
				expect(u.translateYPx).toBeCloseTo(0, 0);
				expect(u.opacity).toBe(1);
			});
		});

		describe('slide-up', () => {
			const preset = ANIM_CAPTION_PRESETS.find((p) => p.id === 'slide-news')!;

			it('at t=0: translateY high, opacity near 0', () => {
				const u = computeCaptionAnimUniforms(preset, 0, 5, 0);
				expect(u.translateYPx).toBeGreaterThan(50);
				expect(u.opacity).toBeLessThan(0.05);
			});

			it('at t=1 (end of enter): identity', () => {
				const dur = preset.animation!.durationS;
				const u = computeCaptionAnimUniforms(preset, 0, 5, dur);
				expect(u.translateYPx).toBeCloseTo(0, 0);
				expect(u.opacity).toBe(1);
			});
		});

		describe('slide-down', () => {
			const preset = ANIM_CAPTION_PRESETS.find((p) => p.id === 'lower-third')!;
			// lower-third uses slide-up enter, let's test with a custom one
			// Actually, let's test by using compute directly with a custom config.
			it('at t=0: translateY negative, opacity near 0', () => {
				const p = {
					...preset,
					animation: { enter: 'slide-down' as const, exit: 'none' as const, durationS: 0.3 }
				};
				const u = computeCaptionAnimUniforms(p, 0, 5, 0);
				expect(u.translateYPx).toBeLessThan(-50);
				expect(u.opacity).toBeLessThan(0.05);
			});
		});

		describe('typewriter', () => {
			it('at t=0: cropRightFrac near 0', () => {
				const p = {
					...ANIM_CAPTION_PRESETS[0]!,
					animation: { enter: 'typewriter' as const, exit: 'none' as const, durationS: 0.5 }
				};
				const u = computeCaptionAnimUniforms(p, 0, 5, 0);
				expect(u.cropRightFrac).toBeCloseTo(0, 1);
			});

			it('at mid enter: cropRightFrac around 0.5', () => {
				const p = {
					...ANIM_CAPTION_PRESETS[0]!,
					animation: { enter: 'typewriter' as const, exit: 'none' as const, durationS: 0.5 }
				};
				const u = computeCaptionAnimUniforms(p, 0, 5, 0.25);
				expect(u.cropRightFrac).toBeCloseTo(0.5, 1);
			});

			it('at end of enter: cropRightFrac = 1', () => {
				const p = {
					...ANIM_CAPTION_PRESETS[0]!,
					animation: { enter: 'typewriter' as const, exit: 'none' as const, durationS: 0.5 }
				};
				const u = computeCaptionAnimUniforms(p, 0, 5, 0.5);
				expect(u.cropRightFrac).toBeCloseTo(1, 1);
			});

			it('exit is none for typewriter (hold at full reveal)', () => {
				const p = {
					...ANIM_CAPTION_PRESETS[0]!,
					animation: { enter: 'typewriter' as const, exit: 'none' as const, durationS: 0.5 }
				};
				// In exit window (segment ends at 5, exit starts at 4.5)
				const u = computeCaptionAnimUniforms(p, 0, 5, 4.8);
				expect(u.cropRightFrac).toBe(1);
				expect(u).toEqual(CAPTION_ANIM_IDENTITY);
			});
		});

		describe('none', () => {
			it('returns exact identity with no drift', () => {
				const p = {
					...ANIM_CAPTION_PRESETS[0]!,
					animation: { enter: 'none' as const, exit: 'none' as const, durationS: 0.25 }
				};
				const u = computeCaptionAnimUniforms(p, 0, 5, 2.5);
				expect(u).toEqual(CAPTION_ANIM_IDENTITY);
				expect(u.opacity).toBe(1);
				expect(u.translateXPx).toBe(0);
				expect(u.translateYPx).toBe(0);
				expect(u.scaleX).toBe(1);
				expect(u.scaleY).toBe(1);
				expect(u.cropRightFrac).toBe(1);
			});
		});

		describe('overlap clamping', () => {
			it('clamps enter and exit when segment is too short', () => {
				const p = {
					...ANIM_CAPTION_PRESETS[0]!,
					animation: { enter: 'pop' as const, exit: 'pop' as const, durationS: 0.25 }
				};
				// Segment 0.3s, durationS 0.25 → each half clamped to 0.15s
				// At t=0.15 we should be in hold phase (fully in)
				const u = computeCaptionAnimUniforms(p, 0, 0.3, 0.15);
				expect(u.opacity).toBe(1);
				expect(u.scaleX).toBe(1);
			});
		});
	});

	describe('karaokeActiveWordIndex', () => {
		const words = [
			{ text: 'Hello', startS: 1, endS: 1.5 },
			{ text: 'world', startS: 1.5, endS: 2.0 },
			{ text: 'foo', startS: 2.5, endS: 3.0 }
		];

		it('returns -1 when before all words', () => {
			expect(karaokeActiveWordIndex(words, 0.5)).toBe(-1);
		});

		it('returns -1 when after all words', () => {
			expect(karaokeActiveWordIndex(words, 3.5)).toBe(-1);
		});

		it('returns -1 in a gap between words', () => {
			expect(karaokeActiveWordIndex(words, 2.2)).toBe(-1);
		});

		it('returns correct index for first word', () => {
			expect(karaokeActiveWordIndex(words, 1.0)).toBe(0);
			expect(karaokeActiveWordIndex(words, 1.49)).toBe(0);
		});

		it('returns correct index for second word', () => {
			expect(karaokeActiveWordIndex(words, 1.5)).toBe(1);
			expect(karaokeActiveWordIndex(words, 1.99)).toBe(1);
		});

		it('returns correct index for third word', () => {
			expect(karaokeActiveWordIndex(words, 2.5)).toBe(2);
		});

		it('returns -1 for empty words array', () => {
			expect(karaokeActiveWordIndex([], 1.0)).toBe(-1);
		});
	});

	// ── Direct exit-curve coverage ────────────────────────────────────────────
	//
	// The prior pop/bounce/slide-up/slide-down test groups exercised the enter
	// half only. Direction regressions on the exit side (sign-flip, missing
	// fade, hold-on-exit instead of slide-away) wouldn't surface — these
	// tests sample the exit window of each kind and assert direction.
	describe('exit curves', () => {
		const base = ANIM_CAPTION_PRESETS.find((p) => p.id === 'pop-card')!;
		const dur = 0.3;
		const segDur = 5;
		// Exit starts at (segDur - dur); midpoint at (segDur - dur/2).
		const midExit = segDur - dur / 2;
		const lateExit = segDur - dur * 0.1;
		const presetWith = (enter: 'pop' | 'bounce' | 'slide-up' | 'slide-down') => ({
			...base,
			animation: { enter, exit: enter, durationS: dur }
		});

		it('pop exit fades opacity 1→0 and shrinks scale', () => {
			const u = computeCaptionAnimUniforms(presetWith('pop'), 0, segDur, midExit);
			expect(u.opacity).toBeLessThan(1);
			expect(u.opacity).toBeGreaterThan(0);
			expect(u.scaleX).toBeLessThan(1);
		});

		it('bounce exit moves translateY positive (away) and fades', () => {
			const u = computeCaptionAnimUniforms(presetWith('bounce'), 0, segDur, midExit);
			expect(u.translateYPx).toBeGreaterThan(5);
			expect(u.opacity).toBeLessThan(1);
		});

		it('slide-up exit moves translateY positive (down off-screen)', () => {
			const u = computeCaptionAnimUniforms(presetWith('slide-up'), 0, segDur, midExit);
			expect(u.translateYPx).toBeGreaterThan(10);
			expect(u.opacity).toBeLessThan(1);
		});

		it('slide-down exit moves translateY negative (up off-screen)', () => {
			const u = computeCaptionAnimUniforms(presetWith('slide-down'), 0, segDur, midExit);
			expect(u.translateYPx).toBeLessThan(-10);
			expect(u.opacity).toBeLessThan(1);
		});

		it('opacity tends to 0 near end of exit window', () => {
			const u = computeCaptionAnimUniforms(presetWith('pop'), 0, segDur, lateExit);
			expect(u.opacity).toBeLessThan(0.2);
		});

		it('typewriter exit holds at full reveal (cropRightFrac stays 1)', () => {
			const p = {
				...base,
				animation: { enter: 'typewriter' as const, exit: 'typewriter' as const, durationS: dur }
			};
			const u = computeCaptionAnimUniforms(p, 0, segDur, midExit);
			expect(u.cropRightFrac).toBe(1);
			expect(u.opacity).toBe(1);
		});
	});
});
