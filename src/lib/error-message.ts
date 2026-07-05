/**
 * Extract a human-readable string from an unknown thrown value.
 *
 * Returns `error.message` when the value is an `Error` instance;
 * otherwise coerces to `String`. Used by clipboard, capture, and
 * init-error paths to avoid duplicating the same ternary 15+ times.
 */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
