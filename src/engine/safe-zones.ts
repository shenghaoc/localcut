/** Phase 39: Platform safe-zone overlay data types and validator. */

import type { ProjectAspect } from '../protocol';

export interface SafeZoneRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface SafeZoneEntry {
	id: string;
	label: string;
	rect: SafeZoneRect;
	kind: 'occluded' | 'caution';
}

export interface SafeZonePlatform {
	id: string;
	label: string;
	aspect: ProjectAspect;
	zones: SafeZoneEntry[];
}

export interface SafeZoneFile {
	safeZoneSchemaVersion: 1;
	platforms: SafeZonePlatform[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SUPPORTED_ASPECTS = new Set<ProjectAspect>(['16:9', '9:16', '1:1', '4:5']);

function isProjectAspect(value: unknown): value is ProjectAspect {
	return typeof value === 'string' && SUPPORTED_ASPECTS.has(value as ProjectAspect);
}

/**
 * Validate a raw JSON value as a `SafeZoneFile`. Returns `null` on any
 * structural or bounds violation, logging the first error encountered.
 */
export function validateSafeZoneFile(json: unknown): SafeZoneFile | null {
	if (!isRecord(json)) {
		console.error('[safe-zones] Root value is not an object.');
		return null;
	}
	if (json.safeZoneSchemaVersion !== 1) {
		console.error('[safe-zones] Expected safeZoneSchemaVersion === 1.');
		return null;
	}
	if (!Array.isArray(json.platforms) || json.platforms.length === 0) {
		console.error('[safe-zones] platforms must be a non-empty array.');
		return null;
	}

	const platforms: SafeZonePlatform[] = [];
	for (const raw of json.platforms as unknown[]) {
		if (!isRecord(raw)) {
			console.error('[safe-zones] Platform entry is not an object.');
			return null;
		}
		const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null;
		const label = typeof raw.label === 'string' && raw.label.length > 0 ? raw.label : null;
		const aspect = isProjectAspect(raw.aspect) ? raw.aspect : null;
		if (!id || !label || !aspect) {
			console.error('[safe-zones] Platform missing required fields.');
			return null;
		}
		if (!Array.isArray(raw.zones) || raw.zones.length === 0) {
			console.error(`[safe-zones] Platform "${id}" zones must be non-empty.`);
			return null;
		}

		const zones: SafeZoneEntry[] = [];
		for (const z of raw.zones as unknown[]) {
			if (!isRecord(z)) {
				console.error(`[safe-zones] Zone in "${id}" not an object.`);
				return null;
			}
			const zId = typeof z.id === 'string' && z.id.length > 0 ? z.id : null;
			const zLabel = typeof z.label === 'string' && z.label.length > 0 ? z.label : null;
			const kind = z.kind === 'occluded' || z.kind === 'caution' ? z.kind : null;
			if (!zId || !zLabel || !kind) {
				console.error(`[safe-zones] Zone in "${id}" missing fields.`);
				return null;
			}
			const r = z.rect;
			if (
				!isRecord(r) ||
				typeof r.x !== 'number' ||
				typeof r.y !== 'number' ||
				typeof r.w !== 'number' ||
				typeof r.h !== 'number'
			) {
				console.error(`[safe-zones] Zone "${zId}" invalid rect.`);
				return null;
			}
			if (
				r.x < 0 ||
				r.y < 0 ||
				r.w < 0 ||
				r.h < 0 ||
				r.x > 1 ||
				r.y > 1 ||
				r.w > 1 ||
				r.h > 1 ||
				r.x + r.w > 1.0001 ||
				r.y + r.h > 1.0001
			) {
				console.error(`[safe-zones] Zone "${zId}" rect out of bounds.`);
				return null;
			}
			zones.push({ id: zId, label: zLabel, rect: { x: r.x, y: r.y, w: r.w, h: r.h }, kind });
		}
		platforms.push({ id, label, aspect, zones });
	}
	return { safeZoneSchemaVersion: 1, platforms };
}
