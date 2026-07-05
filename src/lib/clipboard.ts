/**
 * Shared clipboard utility.
 *
 * Wraps `navigator.clipboard.writeText` with a consistent error-handling
 * pattern. Returns a result object instead of throwing, so callers never
 * need their own try-catch.
 */

const CLIPBOARD_UNAVAILABLE_MESSAGE =
	'Clipboard API is not available (requires a secure HTTPS context)';

type ClipboardResult = { ok: boolean; error?: string };

function getClipboard(): Clipboard | null {
	const nav = typeof navigator === 'undefined' ? null : navigator;
	return nav?.clipboard ?? null;
}

function clipboardErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
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
		return { ok: false, error: clipboardErrorMessage(error) };
	}
}
