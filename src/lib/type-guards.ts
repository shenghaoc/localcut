/**
 * Shared type guard utilities.
 *
 * Eliminates the 18+ duplicate definitions of isRecord/isObject scattered
 * across engine deserialisation modules. Every call site should import from
 * here instead of defining its own copy.
 */

/** Returns `true` when `value` is a plain object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns `true` when `value` is a string. */
export function isString(value: unknown): value is string {
	return typeof value === 'string';
}

/** Returns `true` when `value` is a non-empty string. */
export function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

/** Returns `true` when `value` is a positive finite number (> 0). */
export function isPositiveNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
