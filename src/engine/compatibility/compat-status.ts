import type { CapabilityTierV2 } from '../../protocol';

/**
 * Honest readiness of the compatibility paths.
 *
 * The Phase 26 reduced pipelines (compat WebGPU preview T3, Canvas2D compositor
 * T4, compatibility/limited export T5) are real reduced paths. These flags are
 * the single source of truth so the UI can label those tiers honestly.
 */
export const COMPAT_PREVIEW_IMPLEMENTED = true; // Phase 26 T3 — compat-webgpu preview
export const COMPAT_EXPORT_IMPLEMENTED = true; // Phase 26 T5 — compat-webgpu export
export const LIMITED_PREVIEW_IMPLEMENTED = true; // Phase 26 T4 — Canvas2D compositor
export const LIMITED_EXPORT_IMPLEMENTED = true; // Phase 26 T5 — limited-webcodecs export

/**
 * Still-frame thumbnail import remains available as a fast inspect path, but it
 * is no longer the only reduced surface.
 */
export const STILL_THUMBNAIL_IMPORT_IMPLEMENTED = true;

export const COMPAT_NOT_READY_NOTE =
	'Compatibility foundation detected — reduced preview/export not available yet';

export interface CompatibilityReadiness {
	/** Whether a reduced (editing) preview pipeline is wired for this tier. */
	readonly previewReady: boolean;
	/** Whether a reduced export pipeline is wired for this tier. */
	readonly exportReady: boolean;
	/** Whether the labeled still-frame thumbnail import is available for this tier. */
	readonly thumbnailImportAvailable: boolean;
	/** Honest human-readable note, or null when nothing extra needs saying. */
	readonly note: string | null;
}

/**
 * Report what is actually wired for a tier. `core-webgpu` is fully implemented;
 * `shell-only` has no media path at all.
 */
export function compatibilityReadiness(tier: CapabilityTierV2): CompatibilityReadiness {
	switch (tier) {
		case 'core-webgpu':
			return { previewReady: true, exportReady: true, thumbnailImportAvailable: true, note: null };
		case 'compatibility-webgpu':
			return {
				previewReady: COMPAT_PREVIEW_IMPLEMENTED,
				exportReady: COMPAT_EXPORT_IMPLEMENTED,
				thumbnailImportAvailable: STILL_THUMBNAIL_IMPORT_IMPLEMENTED,
				note: COMPAT_PREVIEW_IMPLEMENTED && COMPAT_EXPORT_IMPLEMENTED ? null : COMPAT_NOT_READY_NOTE
			};
		case 'limited-webcodecs':
			return {
				previewReady: LIMITED_PREVIEW_IMPLEMENTED,
				exportReady: LIMITED_EXPORT_IMPLEMENTED,
				thumbnailImportAvailable: STILL_THUMBNAIL_IMPORT_IMPLEMENTED,
				note:
					LIMITED_PREVIEW_IMPLEMENTED && LIMITED_EXPORT_IMPLEMENTED ? null : COMPAT_NOT_READY_NOTE
			};
		case 'shell-only':
			return {
				previewReady: false,
				exportReady: false,
				thumbnailImportAvailable: false,
				note: 'Shell only — preview and export are unavailable in this browser.'
			};
	}
}
