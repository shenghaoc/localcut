/** Shared display formatters.
 *
 *  Dependency-free so any layer can import them. Consolidated from byte- and
 *  duration-formatting copies that had been pasted (and had drifted) across the
 *  diagnostics, storage, media-bin, and limited-preview UI.
 */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Human-readable byte size using 1024-based units; `null` renders as "Unknown". */
export function formatBytes(value: number | null): string {
	if (value === null) return 'Unknown';
	let scaled = value;
	let unit = 0;
	while (scaled >= 1024 && unit < BYTE_UNITS.length - 1) {
		scaled /= 1024;
		unit += 1;
	}
	return `${scaled.toFixed(unit === 0 ? 0 : 1)} ${BYTE_UNITS[unit]}`;
}

/** Clock-style duration: `h:mm:ss` once past an hour, otherwise `m:ss`.
 *  Non-finite or non-positive input renders as `0:00`. */
export function formatClock(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
	const total = Math.floor(seconds);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;
	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
	}
	return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
