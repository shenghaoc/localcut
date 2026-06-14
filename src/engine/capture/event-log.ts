/** Capture event log — Phase 44 T5.
 *
 *  Defines the discriminated union for capture session event log entries and
 *  helpers for keystroke recording. Phase 43 reserves additional variants
 *  (mouse, clipboard, etc.); Phase 44 adds the `key` variant.
 */

/** A single entry in the capture session event log. */
export type CaptureEventLogEntry =
	| { kind: 'key'; combo: string; t: number }
	// Phase 43 reserves additional variants here (mouse, clipboard, etc.).
	| { kind: string; [k: string]: unknown };

/**
 * Returns true when the KeyboardEvent should be recorded per the Phase 44
 * recording gate (R3.1):
 * - Reject events from <input>, <textarea>, <select>, [contenteditable], or
 *   elements with type="password".
 * - Reject bare printable characters without modifier keys.
 * - Accept everything else (modifier combos, function keys, Escape, etc.).
 */
export function shouldRecordKey(event: KeyboardEvent): boolean {
	const target = event.target;
	// Guard: HTMLElement may not exist in non-browser test environments.
	if (typeof HTMLElement !== 'undefined' && target instanceof HTMLElement) {
		const tag = target.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
		if (target.getAttribute('contenteditable') !== 'false' && target.isContentEditable)
			return false;
		if (target.getAttribute('type') === 'password') return false;
	} else if (target && typeof target === 'object') {
		// Duck-type check for mock objects in tests.
		const t = target as {
			tagName?: string;
			getAttribute?: (k: string) => string | null;
			isContentEditable?: boolean;
		};
		const tag = t.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
		if (typeof t.getAttribute === 'function' && t.getAttribute('type') === 'password') return false;
		if (t.isContentEditable) return false;
	}
	// No modifiers held AND key is a single printable character → reject.
	if (
		!event.ctrlKey &&
		!event.metaKey &&
		!event.altKey &&
		!event.shiftKey &&
		event.key.length === 1
	) {
		return false;
	}
	return true;
}

/**
 * Formats a KeyboardEvent into a canonical combo string (R3.2).
 * Modifiers sorted alphabetically: Alt, Ctrl, Meta, Shift.
 * Space character normalised to 'Space'.
 */
export function formatKeyCombo(event: KeyboardEvent): string {
	const parts: string[] = [];
	if (event.altKey) parts.push('Alt');
	if (event.ctrlKey) parts.push('Ctrl');
	if (event.metaKey) parts.push('Meta');
	if (event.shiftKey) parts.push('Shift');
	const key = event.key === ' ' ? 'Space' : event.key;
	parts.push(key);
	return parts.join('+');
}
