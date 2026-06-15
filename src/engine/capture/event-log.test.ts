/** Capture event log unit tests — Phase 44 T9.3. */

import { describe, it, expect } from 'vite-plus/test';
import { shouldRecordKey, formatKeyCombo, type CaptureEventLogEntry } from './event-log';
import { generateKeyOverlayClips } from './key-overlay-generator';

/** Create a mock KeyboardEvent-like object for Node test environment. */
function mockKeyboardEvent(
	key: string,
	init: Partial<{
		ctrlKey: boolean;
		metaKey: boolean;
		altKey: boolean;
		shiftKey: boolean;
		target: unknown;
	}> = {}
) {
	return {
		key,
		ctrlKey: init.ctrlKey ?? false,
		metaKey: init.metaKey ?? false,
		altKey: init.altKey ?? false,
		shiftKey: init.shiftKey ?? false,
		target: init.target ?? { tagName: 'BODY', getAttribute: () => null, isContentEditable: false }
	} as unknown as KeyboardEvent;
}

describe('shouldRecordKey', () => {
	it('accepts Ctrl+S (modifier combo)', () => {
		const event = mockKeyboardEvent('s', { ctrlKey: true });
		expect(shouldRecordKey(event)).toBe(true);
	});

	it('rejects bare "a" key (no modifier, single printable)', () => {
		const event = mockKeyboardEvent('a');
		expect(shouldRecordKey(event)).toBe(false);
	});

	it('rejects events from INPUT elements', () => {
		const input = { tagName: 'INPUT', getAttribute: () => null, isContentEditable: false };
		const event = mockKeyboardEvent('s', { ctrlKey: true, target: input });
		expect(shouldRecordKey(event)).toBe(false);
	});

	it('accepts bare Escape key (non-printable, no modifier)', () => {
		const event = mockKeyboardEvent('Escape');
		expect(shouldRecordKey(event)).toBe(true);
	});

	it('accepts F5 key (non-printable)', () => {
		const event = mockKeyboardEvent('F5');
		expect(shouldRecordKey(event)).toBe(true);
	});

	it('accepts Shift+Tab (modifier + non-printable)', () => {
		const event = mockKeyboardEvent('Tab', { shiftKey: true });
		expect(shouldRecordKey(event)).toBe(true);
	});

	it('rejects events from TEXTAREA elements', () => {
		const textarea = { tagName: 'TEXTAREA', getAttribute: () => null, isContentEditable: false };
		const event = mockKeyboardEvent('s', { ctrlKey: true, target: textarea });
		expect(shouldRecordKey(event)).toBe(false);
	});

	it('rejects events from password fields', () => {
		const pwd = {
			tagName: 'INPUT',
			getAttribute: (attr: string) => (attr === 'type' ? 'password' : null),
			isContentEditable: false
		};
		const event = mockKeyboardEvent('s', { ctrlKey: true, target: pwd });
		expect(shouldRecordKey(event)).toBe(false);
	});

	it('rejects Shift+letter (capitalised text entry, not a shortcut)', () => {
		// Shift+a → "A" must not be recorded — it's plain capitalised typing.
		const event = mockKeyboardEvent('A', { shiftKey: true });
		expect(shouldRecordKey(event)).toBe(false);
	});

	it('rejects Shift+digit (e.g. Shift+1 → "!") for the same reason', () => {
		const event = mockKeyboardEvent('!', { shiftKey: true });
		expect(shouldRecordKey(event)).toBe(false);
	});

	it('accepts Ctrl+Shift+S (a real shortcut combo)', () => {
		const event = mockKeyboardEvent('S', { ctrlKey: true, shiftKey: true });
		expect(shouldRecordKey(event)).toBe(true);
	});

	it('accepts Alt+Shift+letter (Alt is a non-Shift modifier)', () => {
		const event = mockKeyboardEvent('A', { altKey: true, shiftKey: true });
		expect(shouldRecordKey(event)).toBe(true);
	});
});

describe('formatKeyCombo', () => {
	it('produces Ctrl+Shift+Z from event with ctrlKey+shiftKey+key "z"', () => {
		const event = mockKeyboardEvent('z', { ctrlKey: true, shiftKey: true });
		expect(formatKeyCombo(event)).toBe('Ctrl+Shift+Z');
	});

	it('produces "Space" for bare space key', () => {
		const event = mockKeyboardEvent(' ');
		expect(formatKeyCombo(event)).toBe('Space');
	});

	it('produces "Escape" for Escape key', () => {
		const event = mockKeyboardEvent('Escape');
		expect(formatKeyCombo(event)).toBe('Escape');
	});

	it('sorts modifiers alphabetically', () => {
		const event = mockKeyboardEvent('s', { metaKey: true, altKey: true });
		expect(formatKeyCombo(event)).toBe('Alt+Meta+S');
	});
});

describe('generateKeyOverlayClips', () => {
	it('merges events < 300 ms apart into one clip', () => {
		const entries: CaptureEventLogEntry[] = [
			{ kind: 'key', combo: 'Ctrl+C', t: 1.0 },
			{ kind: 'key', combo: 'Ctrl+V', t: 1.2 } // 200 ms gap
		];
		const clips = generateKeyOverlayClips(entries, 0);
		expect(clips).toHaveLength(1);
		expect(clips[0]!.text).toBe('Ctrl+C · Ctrl+V');
		expect(clips[0]!.startS).toBe(1.0);
	});

	it('does not merge events >= 300 ms apart', () => {
		const entries: CaptureEventLogEntry[] = [
			{ kind: 'key', combo: 'Ctrl+C', t: 1.0 },
			{ kind: 'key', combo: 'Ctrl+V', t: 1.4 } // 400 ms gap
		];
		const clips = generateKeyOverlayClips(entries, 0);
		expect(clips).toHaveLength(2);
		expect(clips[0]!.text).toBe('Ctrl+C');
		expect(clips[1]!.text).toBe('Ctrl+V');
	});

	it('returns empty array for empty input', () => {
		const clips = generateKeyOverlayClips([], 0);
		expect(clips).toHaveLength(0);
	});

	it('filters out non-key entries', () => {
		const entries: CaptureEventLogEntry[] = [
			{ kind: 'mouse', t: 0.5 } as CaptureEventLogEntry,
			{ kind: 'key', combo: 'Escape', t: 1.0 }
		];
		const clips = generateKeyOverlayClips(entries, 0);
		expect(clips).toHaveLength(1);
		expect(clips[0]!.text).toBe('Escape');
	});

	it('applies sessionOffsetS correctly', () => {
		const entries: CaptureEventLogEntry[] = [{ kind: 'key', combo: 'Ctrl+S', t: 5.0 }];
		const clips = generateKeyOverlayClips(entries, 10.0);
		expect(clips[0]!.startS).toBe(15.0);
	});

	it('splits when the merged group reaches the max combo count', () => {
		// 6 combos 200 ms apart — gap is below threshold, but the 4-combo cap
		// forces a split into [4 combos, 2 combos].
		const entries: CaptureEventLogEntry[] = Array.from({ length: 6 }, (_, i) => ({
			kind: 'key' as const,
			combo: `Ctrl+${String.fromCharCode(65 + i)}`,
			t: 1.0 + i * 0.2
		}));
		const clips = generateKeyOverlayClips(entries, 0);
		expect(clips).toHaveLength(2);
		expect(clips[0]!.text.split(' · ')).toHaveLength(4);
		expect(clips[1]!.text.split(' · ')).toHaveLength(2);
	});

	it('splits when the merged span would exceed the max span', () => {
		// Combos 250 ms apart — each gap is below threshold (300 ms), the
		// combo count stays under 4, but the cumulative span hits the 1 s
		// cap on the 5th event (t = 2.0, group started at t = 1.0).
		const entries: CaptureEventLogEntry[] = [
			{ kind: 'key', combo: 'Ctrl+1', t: 1.0 },
			{ kind: 'key', combo: 'Ctrl+2', t: 1.25 },
			{ kind: 'key', combo: 'Ctrl+3', t: 1.5 },
			{ kind: 'key', combo: 'Ctrl+4', t: 1.75 },
			{ kind: 'key', combo: 'Ctrl+5', t: 2.05 } // 1.05 s from start of group
		];
		const clips = generateKeyOverlayClips(entries, 0);
		expect(clips.length).toBeGreaterThan(1);
		// The first group includes at most the first four combos because
		// either the combo cap or the span cap kicks in first.
		expect(clips[0]!.text.split(' · ').length).toBeLessThanOrEqual(4);
	});
});
