/**
 * Generate a unique ID. `crypto.randomUUID()` requires a secure context
 * (HTTPS or `localhost`); when a non-isolated HTTP deployment loads the
 * editor, the call would throw. `crypto.getRandomValues` is available
 * without secure context, so we fall back to an RFC-4122 v4 UUID built
 * from 16 random bytes.
 */
export function generateId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
		const bytes = new Uint8Array(16);
		crypto.getRandomValues(bytes);
		bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
		bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant RFC 4122
		const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	}
	// Final fallback for environments without Web Crypto. Not cryptographically
	// strong, but IDs are not security material — they just need to be
	// unique inside a single project doc.
	return `${Date.now()}-${Math.random().toString(16).padEnd(10, '0').slice(2, 10)}`;
}
