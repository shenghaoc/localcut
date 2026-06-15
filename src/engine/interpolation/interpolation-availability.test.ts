import { describe, it, expect } from 'vite-plus/test';
import {
	deriveInterpolationAvailability,
	isInterpolationVisible,
	canPreviewInterpolation,
	canExportInterpolation,
	interpolationReason
} from './interpolation-availability';

describe('deriveInterpolationAvailability', () => {
	it('returns preview-and-export for core-webgpu', () => {
		const result = deriveInterpolationAvailability('core-webgpu');
		expect(result.state).toBe('preview-and-export');
		if (result.state === 'preview-and-export') {
			expect(result.accelerator).toBe('webgpu');
		}
	});

	it('returns export-only for compatibility-webgpu', () => {
		const result = deriveInterpolationAvailability('compatibility-webgpu');
		expect(result.state).toBe('export-only');
		if (result.state === 'export-only') {
			expect(result.accelerator).toBe('webgpu');
			expect(result.reason).toContain('slow');
		}
	});

	it('returns unavailable for limited-webcodecs', () => {
		const result = deriveInterpolationAvailability('limited-webcodecs');
		expect(result.state).toBe('unavailable');
		if (result.state === 'unavailable') {
			expect(result.reason).toContain('WebGPU');
		}
	});

	it('returns unavailable for shell-only', () => {
		const result = deriveInterpolationAvailability('shell-only');
		expect(result.state).toBe('unavailable');
	});

	it('returns unavailable when no WebGPU device', () => {
		const result = deriveInterpolationAvailability('core-webgpu', false, true);
		expect(result.state).toBe('unavailable');
		if (result.state === 'unavailable') {
			expect(result.reason).toContain('No WebGPU device');
		}
	});

	it('returns unavailable when LiteRT webgpu not available', () => {
		const result = deriveInterpolationAvailability('core-webgpu', true, false);
		expect(result.state).toBe('unavailable');
		if (result.state === 'unavailable') {
			expect(result.reason).toContain('LiteRT');
		}
	});
});

describe('isInterpolationVisible', () => {
	it('returns true for preview-and-export', () => {
		expect(isInterpolationVisible({ state: 'preview-and-export', accelerator: 'webgpu' })).toBe(
			true
		);
	});

	it('returns true for export-only', () => {
		expect(
			isInterpolationVisible({
				state: 'export-only',
				accelerator: 'webgpu',
				reason: 'slow'
			})
		).toBe(true);
	});

	it('returns false for unavailable', () => {
		expect(isInterpolationVisible({ state: 'unavailable', reason: 'no webgpu' })).toBe(false);
	});
});

describe('canPreviewInterpolation', () => {
	it('returns true only for preview-and-export', () => {
		expect(canPreviewInterpolation({ state: 'preview-and-export', accelerator: 'webgpu' })).toBe(
			true
		);
		expect(
			canPreviewInterpolation({
				state: 'export-only',
				accelerator: 'webgpu',
				reason: 'slow'
			})
		).toBe(false);
		expect(canPreviewInterpolation({ state: 'unavailable', reason: 'no' })).toBe(false);
	});
});

describe('canExportInterpolation', () => {
	it('returns true for preview-and-export and export-only', () => {
		expect(canExportInterpolation({ state: 'preview-and-export', accelerator: 'webgpu' })).toBe(
			true
		);
		expect(
			canExportInterpolation({
				state: 'export-only',
				accelerator: 'webgpu',
				reason: 'slow'
			})
		).toBe(true);
		expect(canExportInterpolation({ state: 'unavailable', reason: 'no' })).toBe(false);
	});
});

describe('interpolationReason', () => {
	it('returns null when no reason field', () => {
		expect(interpolationReason({ state: 'preview-and-export', accelerator: 'webgpu' })).toBe(null);
	});

	it('returns reason string when present', () => {
		expect(
			interpolationReason({
				state: 'export-only',
				accelerator: 'webgpu',
				reason: 'slow tier'
			})
		).toBe('slow tier');
		expect(interpolationReason({ state: 'unavailable', reason: 'no webgpu' })).toBe('no webgpu');
	});
});
