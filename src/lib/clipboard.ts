/**
 * Shared clipboard utility.
 *
 * Wraps `navigator.clipboard.writeText` with a consistent error-handling
 * pattern. Returns a result object instead of throwing, so callers never
 * need their own try-catch.
 */

import { errorMessage } from './error-message';

const CLIPBOARD_UNAVAILABLE_MESSAGE =
	'Clipboard API is not available (requires a secure context in a browser environment)';

export type ClipboardResult = { ok: true } | { ok: false; error: string };

function getClipboard(): Clipboard | null {
	const nav = typeof navigator === 'undefined' ? null : navigator;
	return nav?.clipboard ?? null;
}

export async function copyToClipboard(text: string): Promise<ClipboardResult> {
	const clipboard = getClipboard();
	if (!clipboard) {
		return { ok: false, error: CLIPBOARD_UNAVAILABLE_MESSAGE };
	}

	try {
		await clipboard.writeText(text);
		return { ok: true };
	} catch (error) {
		return { ok: false, error: errorMessage(error) };
	}
}
