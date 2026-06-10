import type { ProjectDoc } from '../project';

/**
 * The single sequence rate used for all frame-snapped interchange times:
 * export fps when set, else the most common source video frame rate
 * (ties break toward the higher rate for determinism), else 30.
 */
export function interchangeRate(doc: ProjectDoc): number {
	const fps = doc.exportSettings?.fps;
	if (typeof fps === 'number' && Number.isFinite(fps) && fps > 0) return fps;
	const counts = new Map<number, number>();
	for (const source of doc.sources) {
		const rate = source.video?.frameRate;
		if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
			counts.set(rate, (counts.get(rate) ?? 0) + 1);
		}
	}
	let best: number | null = null;
	let bestCount = 0;
	for (const [rate, count] of counts) {
		if (count > bestCount || (count === bestCount && (best === null || rate > best))) {
			best = rate;
			bestCount = count;
		}
	}
	return best ?? 30;
}

/**
 * Snap a time in seconds to a whole frame count at `rate`.
 *
 * Boundaries must be snapped independently and durations derived as
 * `endFrames - startFrames` — never snap a duration directly — so clips
 * adjacent in seconds stay adjacent in frames.
 */
export function snapToFrames(timeS: number, rate: number): number {
	return Math.round(timeS * rate);
}

/** Frame count between two independently snapped boundaries; never negative. */
export function snappedDurationFrames(startS: number, endS: number, rate: number): number {
	return Math.max(0, snapToFrames(endS, rate) - snapToFrames(startS, rate));
}

/**
 * Locale-independent code-unit string comparison. Interchange ordering must
 * be byte-stable across environments (golden fixtures compare exact bytes),
 * so `localeCompare` — whose result depends on the host ICU locale — is
 * deliberately not used.
 */
export function compareStrings(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** Non-drop HH:MM:SS:FF at an integer frame rate. */
export function formatTimecode(frames: number, fps: number): string {
	if (!Number.isInteger(fps) || fps <= 0) {
		throw new Error(`Timecode requires a positive integer frame rate, got ${fps}.`);
	}
	// A non-finite count means an upstream bug; failing loudly beats silently
	// emitting a wrong-but-plausible timecode into a broadcast EDL.
	if (!Number.isFinite(frames)) {
		throw new Error(`Timecode requires a finite frame count, got ${frames}.`);
	}
	const total = Math.max(0, Math.trunc(frames));
	const ff = total % fps;
	const totalSeconds = Math.trunc(total / fps);
	const ss = totalSeconds % 60;
	const mm = Math.trunc(totalSeconds / 60) % 60;
	const hh = Math.trunc(totalSeconds / 3600);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}
