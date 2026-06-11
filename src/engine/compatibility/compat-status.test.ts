import { describe, expect, it } from 'vite-plus/test';
import {
	COMPAT_EXPORT_IMPLEMENTED,
	COMPAT_PREVIEW_IMPLEMENTED,
	LIMITED_EXPORT_IMPLEMENTED,
	LIMITED_PREVIEW_IMPLEMENTED,
	compatibilityReadiness
} from './compat-status';

describe('compatibilityReadiness', () => {
	it('reports core-webgpu as fully ready', () => {
		expect(compatibilityReadiness('core-webgpu')).toEqual({
			previewReady: true,
			exportReady: true,
			thumbnailImportAvailable: true,
			note: null
		});
	});

	it('reports reduced compatibility tiers as real preview/export paths', () => {
		expect(COMPAT_PREVIEW_IMPLEMENTED).toBe(true);
		expect(COMPAT_EXPORT_IMPLEMENTED).toBe(true);
		expect(LIMITED_PREVIEW_IMPLEMENTED).toBe(true);
		expect(LIMITED_EXPORT_IMPLEMENTED).toBe(true);

		const compat = compatibilityReadiness('compatibility-webgpu');
		expect(compat.previewReady).toBe(true);
		expect(compat.exportReady).toBe(true);
		expect(compat.thumbnailImportAvailable).toBe(true);
		expect(compat.note).toBeNull();

		const limited = compatibilityReadiness('limited-webcodecs');
		expect(limited.previewReady).toBe(true);
		expect(limited.exportReady).toBe(true);
		expect(limited.thumbnailImportAvailable).toBe(true);
		expect(limited.note).toBeNull();
	});

	it('marks shell-only as no-media', () => {
		const shell = compatibilityReadiness('shell-only');
		expect(shell.previewReady).toBe(false);
		expect(shell.exportReady).toBe(false);
		expect(shell.thumbnailImportAvailable).toBe(false);
		expect(shell.note).toMatch(/Shell only/);
	});
});
