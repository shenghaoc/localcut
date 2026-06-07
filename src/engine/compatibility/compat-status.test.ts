import { describe, expect, it } from 'vitest';
import {
  COMPAT_EXPORT_IMPLEMENTED,
  COMPAT_NOT_READY_NOTE,
  COMPAT_PREVIEW_IMPLEMENTED,
  LIMITED_EXPORT_IMPLEMENTED,
  LIMITED_PREVIEW_IMPLEMENTED,
  compatibilityReadiness,
} from './compat-status';

describe('compatibilityReadiness', () => {
  it('reports core-webgpu as fully ready', () => {
    expect(compatibilityReadiness('core-webgpu')).toEqual({
      previewReady: true,
      exportReady: true,
      thumbnailImportAvailable: true,
      note: null,
    });
  });

  it('labels unfinished compatibility tiers honestly but keeps the still-thumbnail import', () => {
    // Guard: the full reduced pipelines stay foundation-only until wired...
    expect(COMPAT_PREVIEW_IMPLEMENTED).toBe(false);
    expect(COMPAT_EXPORT_IMPLEMENTED).toBe(false);
    expect(LIMITED_PREVIEW_IMPLEMENTED).toBe(false);
    expect(LIMITED_EXPORT_IMPLEMENTED).toBe(false);

    const compat = compatibilityReadiness('compatibility-webgpu');
    expect(compat.previewReady).toBe(false);
    expect(compat.exportReady).toBe(false);
    // ...while the labeled still-frame thumbnail import IS available (matches the UI).
    expect(compat.thumbnailImportAvailable).toBe(true);
    expect(compat.note).toBe(COMPAT_NOT_READY_NOTE);

    const limited = compatibilityReadiness('limited-webcodecs');
    expect(limited.previewReady).toBe(false);
    expect(limited.exportReady).toBe(false);
    expect(limited.thumbnailImportAvailable).toBe(true);
    expect(limited.note).toBe(COMPAT_NOT_READY_NOTE);
  });

  it('marks shell-only as no-media', () => {
    const shell = compatibilityReadiness('shell-only');
    expect(shell.previewReady).toBe(false);
    expect(shell.exportReady).toBe(false);
    expect(shell.thumbnailImportAvailable).toBe(false);
    expect(shell.note).toMatch(/Shell only/);
  });
});
