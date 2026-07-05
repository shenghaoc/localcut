/**
 * Returns true for browser/file-picker cancellation across DOM and test realms.
 * Uses a structural check (`'name' in error`) instead of `instanceof DOMException`
 * for cross-realm and test-environment compatibility.
 */
export function isAbortError(error: unknown): error is DOMException {
	return (
		typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
	);
}
