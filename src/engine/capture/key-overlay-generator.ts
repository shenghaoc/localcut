/** Keystroke overlay clip generator — Phase 44 T6.
 *
 *  Pure function: takes a sorted CaptureEventLogEntry[] (kind 'key' only) and
 *  produces KeyOverlayClip[] for insertion as title clips on the timeline.
 */

import type { CaptureEventLogEntry } from './event-log';
import type { TitleStyle } from '../title';

/** A generated keystroke overlay clip. */
export interface KeyOverlayClip {
	/** Combo string or merged combos joined with ' · '. */
	text: string;
	/** Session-relative start time in seconds. */
	startS: number;
	/** Display duration in seconds. */
	durationS: number;
	/** TitleStyle override for the keycap appearance. */
	style: Partial<TitleStyle>;
}

/** Merge threshold: events within this gap (s) are joined into one clip. */
export const KEY_MERGE_THRESHOLD_S = 0.3;

/** Default overlay clip display duration. */
export const KEY_OVERLAY_DURATION_S = 1.2;

/** Keycap TitleStyle override applied to all generated clips (R3.3). */
export const KEYCAP_STYLE: Partial<TitleStyle> = {
	fontFamily: "'Courier New', Courier, monospace",
	fontSizePx: 36,
	color: '#FFFFFF',
	backgroundColor: '#1A1A1A',
	backgroundOpacity: 0.9,
	outlineColor: '#FFFFFF',
	outlineWidthPx: 2,
	shadowBlurPx: 0,
	shadowOffsetXPx: 0,
	shadowOffsetYPx: 0,
	align: 'center'
};

/**
 * Generate overlay clips from key event log entries.
 *
 * Entries are grouped by merge threshold: events < 300 ms apart have their
 * combos joined with ' · ' into a single clip starting at the first event's
 * time. The clip duration is always KEY_OVERLAY_DURATION_S from the first
 * event.
 *
 * @param entries Event log entries (all kinds accepted; non-key entries are filtered out).
 * @param sessionOffsetS Offset from project start to align session timestamps.
 * @returns Array of overlay clips sorted by startS ascending.
 */
export function generateKeyOverlayClips(
	entries: readonly CaptureEventLogEntry[],
	sessionOffsetS: number
): KeyOverlayClip[] {
	const keyEntries = entries
		.filter((e): e is { kind: 'key'; combo: string; t: number } => e.kind === 'key')
		.slice()
		.sort((a, b) => a.t - b.t);

	if (keyEntries.length === 0) return [];

	const clips: KeyOverlayClip[] = [];
	let groupCombos: string[] = [keyEntries[0]!.combo];
	let groupTimeS = keyEntries[0]!.t;

	for (let i = 1; i < keyEntries.length; i++) {
		const prev = keyEntries[i - 1]!;
		const curr = keyEntries[i]!;
		// t is in seconds (Phase 43 convention). Merge if gap < threshold.
		if (curr.t - prev.t < KEY_MERGE_THRESHOLD_S) {
			groupCombos.push(curr.combo);
		} else {
			// Flush the current group.
			clips.push({
				text: groupCombos.join(' · '),
				startS: groupTimeS + sessionOffsetS,
				durationS: KEY_OVERLAY_DURATION_S,
				style: KEYCAP_STYLE
			});
			// Start a new group.
			groupCombos = [curr.combo];
			groupTimeS = curr.t;
		}
	}

	// Flush the last group.
	clips.push({
		text: groupCombos.join(' · '),
		startS: groupTimeS + sessionOffsetS,
		durationS: KEY_OVERLAY_DURATION_S,
		style: KEYCAP_STYLE
	});

	return clips;
}
