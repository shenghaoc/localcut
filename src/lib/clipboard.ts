/**
 * Shared clipboard utility.
 *
 * Wraps `navigator.clipboard.writeText` with a consistent error-handling
 * pattern. Returns a result object instead of throwing, so callers never
 * need their own try-catch.
 */

export async function copyToClipboard(text: string): Promise<{ ok: boolean; error?: string }> {
	try {
		await navigator.clipboard.writeText(text);
		return { ok: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: message };
	}
}
