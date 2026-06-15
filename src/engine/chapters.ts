/** YouTube chapter export — Phase 44 T7.
 *
 *  Pure module; no browser APIs. Generates YouTube chapter text from timeline
 *  markers and validates against YouTube's format rules.
 */

/** A chapter entry for YouTube chapter text. */
export interface ChapterEntry {
	/** Time in seconds. */
	time: number;
	/** Non-empty label. */
	label: string;
}

/** Validation result from generateChapterText. */
export type ChapterValidationResult =
	| { valid: true; text: string; entries: ChapterEntry[] }
	| { valid: false; reason: string };

/**
 * Formats seconds as HH:MM:SS (no fractional seconds — YouTube drops them).
 * Integer arithmetic only.
 */
export function formatChapterTimestamp(s: number): string {
	const totalSeconds = Math.max(0, Math.floor(s));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Generate YouTube chapter text from timeline markers.
 *
 * Rules enforced (R4.2):
 * 1. Filter markers to those with non-empty labels.
 * 2. Sort ascending by time.
 * 3. If no entry has time === 0, prepend "Intro" at 00:00:00.
 * 4. Drop entries past `totalDurationS` (only meaningful when supplied).
 * 5. Check entries.length >= 3.
 * 6. Check each adjacent pair satisfies entries[i+1].time - entries[i].time >= 10.
 * 7. Check the final chapter leaves >= 10 s of headroom before the program end.
 * 8. Produce text: one line per entry, `${formatChapterTimestamp(time)} ${label}`.
 *
 * @param markers ProjectDoc.markers (TimelineMarker[]).
 * @param totalDurationS Total program duration in seconds. When omitted (or
 *   non-finite / non-positive) the post-end and final-headroom checks are
 *   skipped — callers that know the program length should always pass it so
 *   YouTube's "last chapter ≥ 10 s before end" rule is enforced.
 */
export function generateChapterText(
	markers: readonly { time: number; label: string }[],
	totalDurationS?: number
): ChapterValidationResult {
	const haveDuration =
		typeof totalDurationS === 'number' && Number.isFinite(totalDurationS) && totalDurationS > 0;
	// Step 1: filter to non-empty labels.
	const filtered = markers.filter((m) => m.label.trim().length > 0);
	// Step 2: sort ascending by time.
	const sorted = [...filtered].sort((a, b) => a.time - b.time);
	// Step 3: auto-insert Intro at 0 if absent.
	const hasZero = sorted.some((m) => m.time === 0);
	const seeded: ChapterEntry[] = hasZero
		? sorted.map((m) => ({ time: m.time, label: m.label.trim() }))
		: [
				{ time: 0, label: 'Intro' },
				...sorted.map((m) => ({ time: m.time, label: m.label.trim() }))
			];

	// Step 4: drop entries past the end of the program (can never appear).
	const entries = haveDuration ? seeded.filter((e) => e.time <= totalDurationS!) : seeded;

	// Step 5: check minimum 3 chapters.
	if (entries.length < 3) {
		return { valid: false, reason: 'YouTube requires at least 3 chapters. Add more markers.' };
	}

	// Step 6: check 10-second spacing.
	for (let i = 1; i < entries.length; i++) {
		const prev = entries[i - 1]!;
		const curr = entries[i]!;
		if (curr.time - prev.time < 10) {
			return {
				valid: false,
				reason: `Chapters must be at least 10 seconds apart. Chapter "${curr.label}" is too close to the previous.`
			};
		}
	}

	// Step 7: check final-chapter headroom (YouTube hides sub-10 s chapters).
	if (haveDuration) {
		const last = entries[entries.length - 1]!;
		if (totalDurationS! - last.time < 10) {
			return {
				valid: false,
				reason: `The last chapter must leave at least 10 seconds before the end of the video. Move "${last.label}" earlier or extend the program.`
			};
		}
	}

	// Step 8: format.
	const text = entries.map((e) => `${formatChapterTimestamp(e.time)} ${e.label}`).join('\n');
	return { valid: true, text, entries };
}

/**
 * Returns a JSON string (pretty-printed) of ChapterEntry[].
 * Precondition: entries have already been validated.
 */
export function generateChaptersJson(entries: readonly ChapterEntry[]): string {
	return JSON.stringify(
		entries.map((e) => ({ time: e.time, label: e.label })),
		null,
		2
	);
}
