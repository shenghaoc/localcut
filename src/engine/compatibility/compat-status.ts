import type { CapabilityTierV2 } from '../../protocol';

/**
 * Honest readiness of the compatibility paths (B3).
 *
 * The Phase 26 reduced pipelines (compat WebGPU preview T3, Canvas2D compositor
 * T4, compatibility/limited export T5) are foundation-only — probing, tiering,
 * diagnostics, and export *constraints* exist, but the reduced preview/export
 * pipelines are not wired. These flags are the single source of truth so the UI
 * can label those tiers honestly instead of implying full editing/export works.
 *
 * Flip a flag to `true` only when the corresponding pipeline is implemented and
 * tested; the UI keys its preview/export controls off these values.
 */
export const COMPAT_PREVIEW_IMPLEMENTED = false; // Phase 26 T3 — compat-webgpu preview
export const COMPAT_EXPORT_IMPLEMENTED = false; // Phase 26 T5 — compat-webgpu export
export const LIMITED_PREVIEW_IMPLEMENTED = false; // Phase 26 T4 — Canvas2D compositor
export const LIMITED_EXPORT_IMPLEMENTED = false; // Phase 26 T5 — limited-webcodecs export

export const COMPAT_NOT_READY_NOTE =
  'Compatibility foundation detected — reduced preview/export not available yet';

export interface CompatibilityReadiness {
  /** Whether a reduced preview pipeline is wired for this tier. */
  readonly previewReady: boolean;
  /** Whether a reduced export pipeline is wired for this tier. */
  readonly exportReady: boolean;
  /** Honest human-readable note, or null when nothing extra needs saying. */
  readonly note: string | null;
}

/**
 * Report what is actually wired for a tier. `core-webgpu` is fully implemented;
 * `shell-only` has no media path at all; the two compatibility tiers are
 * foundation-only until their pipelines land.
 */
export function compatibilityReadiness(tier: CapabilityTierV2): CompatibilityReadiness {
  switch (tier) {
    case 'core-webgpu':
      return { previewReady: true, exportReady: true, note: null };
    case 'compatibility-webgpu':
      return {
        previewReady: COMPAT_PREVIEW_IMPLEMENTED,
        exportReady: COMPAT_EXPORT_IMPLEMENTED,
        note: COMPAT_PREVIEW_IMPLEMENTED && COMPAT_EXPORT_IMPLEMENTED ? null : COMPAT_NOT_READY_NOTE,
      };
    case 'limited-webcodecs':
      return {
        previewReady: LIMITED_PREVIEW_IMPLEMENTED,
        exportReady: LIMITED_EXPORT_IMPLEMENTED,
        note: LIMITED_PREVIEW_IMPLEMENTED && LIMITED_EXPORT_IMPLEMENTED ? null : COMPAT_NOT_READY_NOTE,
      };
    case 'shell-only':
      return {
        previewReady: false,
        exportReady: false,
        note: 'Shell only — preview and export are unavailable in this browser.',
      };
  }
}
