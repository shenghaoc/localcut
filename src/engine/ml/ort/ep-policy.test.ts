import { describe, expect, it } from 'vite-plus/test';

import {
	OrtEpPolicyError,
	isFrameCoupledSafeEp,
	isGpuClassEp,
	resolveExecutionProviders
} from './ep-policy';

describe('ORT execution-provider policy', () => {
	it('classifies GPU-class providers', () => {
		expect(isGpuClassEp('webgpu')).toBe(true);
		expect(isGpuClassEp('webnn')).toBe(true);
		expect(isGpuClassEp('wasm')).toBe(false);
	});

	it('marks wasm as unsafe for frame-coupled features', () => {
		expect(isFrameCoupledSafeEp('webgpu')).toBe(true);
		expect(isFrameCoupledSafeEp('webnn')).toBe(true);
		expect(isFrameCoupledSafeEp('wasm')).toBe(false);
	});

	it('returns the pinned list verbatim, never appending an implicit wasm fallback', () => {
		const eps = resolveExecutionProviders({
			frameCoupled: true,
			executionProviders: ['webgpu', 'webnn']
		});
		expect(eps).toEqual(['webgpu', 'webnn']);
		expect(eps).not.toContain('wasm');
	});

	it('preserves EP order', () => {
		expect(
			resolveExecutionProviders({ frameCoupled: true, executionProviders: ['webnn', 'webgpu'] })
		).toEqual(['webnn', 'webgpu']);
	});

	it('allows wasm for non-frame-coupled models', () => {
		expect(
			resolveExecutionProviders({ frameCoupled: false, executionProviders: ['wasm'] })
		).toEqual(['wasm']);
	});

	it('throws when a frame-coupled feature pins wasm', () => {
		expect(() =>
			resolveExecutionProviders({ frameCoupled: true, executionProviders: ['webgpu', 'wasm'] })
		).toThrow(OrtEpPolicyError);
	});

	it('throws when a frame-coupled feature pins only wasm', () => {
		expect(() =>
			resolveExecutionProviders({ frameCoupled: true, executionProviders: ['wasm'] })
		).toThrow(OrtEpPolicyError);
	});

	it('throws when a frame-coupled feature has no GPU-class provider', () => {
		// A hypothetical non-GPU, non-wasm EP would still be rejected; here the empty
		// GPU set is the failure mode the guard protects against.
		expect(() => resolveExecutionProviders({ frameCoupled: true, executionProviders: [] })).toThrow(
			OrtEpPolicyError
		);
	});

	it('throws on an empty EP list regardless of coupling', () => {
		expect(() =>
			resolveExecutionProviders({ frameCoupled: false, executionProviders: [] })
		).toThrow(OrtEpPolicyError);
	});
});
