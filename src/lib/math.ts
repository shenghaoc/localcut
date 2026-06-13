/** Shared numeric helpers.
 *
 *  Dependency-free on purpose: engine and worker modules import these, so they
 *  must not pull in UI-only libraries (clsx/tailwind-merge live in `utils.ts`).
 *  Consolidated from copies that had drifted across transform/title/audio-mix/
 *  source-timing/canvas-compositor and the timeline UI.
 */

/** Clamp `value` into the inclusive range [`min`, `max`]. */
export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/** Clamp `value` into [0, 1] — common for opacity, gain, and normalized params. */
export function clamp01(value: number): number {
	return clamp(value, 0, 1);
}

/** Return `value` when it is a finite number, otherwise `fallback`. */
export function finiteOr(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
