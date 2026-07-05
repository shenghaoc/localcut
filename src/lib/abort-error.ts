/** Returns true for browser/file-picker cancellation across DOM and test realms. */
export function isAbortError(error: unknown): boolean {
	return (
		typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
	);
}
