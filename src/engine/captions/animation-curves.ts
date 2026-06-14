/** Phase 30 — Caption animation curves module.
 *
 * Pure per-frame uniform computation for caption enter/exit animations.
 * No browser APIs; fully testable in Node.
 */

import type { CaptionAnimStylePreset, CaptionAnimKind } from './anim-style';

export interface CaptionAnimUniforms {
	opacity: number;
	translateXPx: number;
	translateYPx: number;
	scaleX: number;
	scaleY: number;
	/** [0, 1]; 1 = full width shown. Used by typewriter. */
	cropRightFrac: number;
}

export const CAPTION_ANIM_IDENTITY: CaptionAnimUniforms = {
	opacity: 1,
	translateXPx: 0,
	translateYPx: 0,
	scaleX: 1,
	scaleY: 1,
	cropRightFrac: 1
};

// ── Interpolation helpers (inline; no external dependency) ────────────────

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

/** Smooth-step easing (ease-in-out): t*t*(3-2t). */
function easeInOut(t: number): number {
	const clamped = Math.min(1, Math.max(0, t));
	return clamped * clamped * (3 - 2 * clamped);
}

/** Ease-out: 1 - (1-t)^2. */
function easeOut(t: number): number {
	const clamped = Math.min(1, Math.max(0, t));
	return 1 - (1 - clamped) * (1 - clamped);
}

// ── Per-kind curve evaluation ─────────────────────────────────────────────

/**
 * Evaluate enter animation uniforms for a given normalized progress `t` in [0, 1].
 * At t=0 the animation starts; at t=1 it is fully "in".
 */
function enterUniforms(kind: CaptionAnimKind, t: number): CaptionAnimUniforms {
	switch (kind) {
		case 'none':
			return CAPTION_ANIM_IDENTITY;
		case 'pop': {
			// Scale: 0→1.15 (first 70%), 1.15→1.0 settle (last 30%). Smooth overshoot.
			const scale =
				t < 0.7 ? lerp(0, 1.15, easeOut(t / 0.7)) : lerp(1.15, 1.0, easeInOut((t - 0.7) / 0.3));
			const opacity = easeInOut(t);
			return { ...CAPTION_ANIM_IDENTITY, scaleX: scale, scaleY: scale, opacity };
		}
		case 'bounce': {
			// TranslateY: +40 → -8 (overshoot) → 0, two-phase ease-out.
			// First 60% of the enter sweeps 40→-8; last 40% settles -8→0.
			const bounceT = easeOut(t);
			const ty =
				t < 0.6
					? lerp(40, -8, bounceT / easeOut(0.6))
					: lerp(-8, 0, (bounceT - easeOut(0.6)) / (1 - easeOut(0.6)));
			const opacity = easeInOut(t);
			return { ...CAPTION_ANIM_IDENTITY, translateYPx: ty, opacity };
		}
		case 'slide-up': {
			const ty = lerp(60, 0, easeInOut(t));
			const opacity = easeInOut(t);
			return { ...CAPTION_ANIM_IDENTITY, translateYPx: ty, opacity };
		}
		case 'slide-down': {
			const ty = lerp(-60, 0, easeInOut(t));
			const opacity = easeInOut(t);
			return { ...CAPTION_ANIM_IDENTITY, translateYPx: ty, opacity };
		}
		case 'typewriter': {
			// cropRightFrac advances linearly from 0 to 1 over enter duration.
			const crop = Math.min(1, Math.max(0, t));
			return { ...CAPTION_ANIM_IDENTITY, cropRightFrac: crop };
		}
	}
}

/**
 * Evaluate exit animation uniforms for a given normalized progress `t` in [0, 1].
 * At t=0 the exit starts (segment is at hold); at t=1 the segment is fully out.
 */
function exitUniforms(kind: CaptionAnimKind, t: number): CaptionAnimUniforms {
	switch (kind) {
		case 'none':
			return CAPTION_ANIM_IDENTITY;
		case 'pop': {
			const scale = lerp(1.0, 0.8, easeInOut(t));
			const opacity = lerp(1, 0, easeInOut(t));
			return { ...CAPTION_ANIM_IDENTITY, scaleX: scale, scaleY: scale, opacity };
		}
		case 'bounce': {
			const ty = lerp(0, 40, easeOut(t));
			const opacity = lerp(1, 0, easeInOut(t));
			return { ...CAPTION_ANIM_IDENTITY, translateYPx: ty, opacity };
		}
		case 'slide-up': {
			const ty = lerp(0, 60, easeInOut(t));
			const opacity = lerp(1, 0, easeInOut(t));
			return { ...CAPTION_ANIM_IDENTITY, translateYPx: ty, opacity };
		}
		case 'slide-down': {
			const ty = lerp(0, -60, easeInOut(t));
			const opacity = lerp(1, 0, easeInOut(t));
			return { ...CAPTION_ANIM_IDENTITY, translateYPx: ty, opacity };
		}
		// Typewriter exit is 'none' — hold at full reveal through segment end.
		case 'typewriter':
			return CAPTION_ANIM_IDENTITY;
	}
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Compute caption animation uniforms for a segment at `currentTimeS`.
 *
 * Pure function with no side effects, suitable for Node-environment unit tests.
 * Uses overlap-clamp logic: when `segDurationS < 2 × animation.durationS`,
 * enter and exit durations are each clamped to `segDurationS / 2`.
 */
export function computeCaptionAnimUniforms(
	preset: CaptionAnimStylePreset,
	segStartS: number,
	segDurationS: number,
	currentTimeS: number
): CaptionAnimUniforms {
	const anim = preset.animation;
	if (!anim || (anim.enter === 'none' && anim.exit === 'none')) {
		return CAPTION_ANIM_IDENTITY;
	}

	const localT = currentTimeS - segStartS;
	if (localT < 0 || localT > segDurationS) {
		return CAPTION_ANIM_IDENTITY;
	}

	// Overlap clamp: when segment is shorter than 2×durationS, each half is
	// clamped so enter and exit don't overlap.
	const maxHalf = segDurationS / 2;
	const enterDur = Math.min(anim.durationS, maxHalf);
	const exitDur = Math.min(anim.durationS, maxHalf);
	const holdStart = enterDur;
	const exitStart = segDurationS - exitDur;

	if (localT < holdStart) {
		// Enter phase.
		const t = enterDur > 0 ? localT / enterDur : 1;
		return enterUniforms(anim.enter, t);
	}

	if (localT >= exitStart) {
		// Exit phase.
		const t = exitDur > 0 ? (localT - exitStart) / exitDur : 1;
		return exitUniforms(anim.exit, t);
	}

	// Hold phase — fully in.
	return CAPTION_ANIM_IDENTITY;
}

// ── Karaoke active-word identification ────────────────────────────────────

export interface KaraokeWord {
	text: string;
	startS: number;
	endS: number;
}

/**
 * Given a `words` array and `currentTimeS`, return the index of the active
 * word where `word.startS <= currentTimeS < word.endS`, or `-1` when outside
 * all word ranges. Pure lookup — no animation interpolation.
 */
export function karaokeActiveWordIndex(
	words: readonly KaraokeWord[],
	currentTimeS: number
): number {
	for (let i = 0; i < words.length; i++) {
		const w = words[i]!;
		if (currentTimeS >= w.startS && currentTimeS < w.endS) return i;
	}
	return -1;
}
