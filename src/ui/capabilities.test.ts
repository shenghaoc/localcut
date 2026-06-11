import { describe, expect, it } from 'vite-plus/test';
import {
	deriveCapabilityTier,
	importUnavailableReason,
	missingAcceleratedFeatures,
	probeCapabilities
} from './capabilities';

describe('probeCapabilities', () => {
	it('does not throw when probing browser APIs', () => {
		expect(() => probeCapabilities()).not.toThrow();
	});

	it('detects each API independently from overrides', () => {
		const snapshot = probeCapabilities({
			fileApi: true,
			crossOriginIsolated: false,
			sharedArrayBuffer: false,
			webgpu: true,
			webCodecs: true,
			offscreenCanvas: true,
			fileSystemAccess: false,
			audioWorklet: true
		});
		expect(snapshot.webgpu).toBe(true);
		expect(snapshot.crossOriginIsolated).toBe(false);
		expect(snapshot.fileSystemAccess).toBe(false);
	});
});

describe('deriveCapabilityTier', () => {
	const isolated = probeCapabilities({
		fileApi: true,
		crossOriginIsolated: true,
		sharedArrayBuffer: true,
		webgpu: true,
		webCodecs: true,
		offscreenCanvas: true,
		fileSystemAccess: true,
		audioWorklet: true
	});

	it('returns accelerated only when worker, WebGPU, and required APIs are ready', () => {
		expect(
			deriveCapabilityTier(isolated, {
				workerReady: true,
				webgpuReady: true,
				runtimeIssue: null
			})
		).toBe('accelerated');
	});

	it('returns limited when worker is ready without WebCodecs', () => {
		const snapshot = probeCapabilities({
			...isolated,
			webCodecs: false
		});
		expect(
			deriveCapabilityTier(snapshot, {
				workerReady: true,
				webgpuReady: true,
				runtimeIssue: null
			})
		).toBe('limited');
	});

	it('returns limited when worker is ready without WebGPU', () => {
		expect(
			deriveCapabilityTier(isolated, {
				workerReady: true,
				webgpuReady: false,
				runtimeIssue: 'WebGPU unavailable'
			})
		).toBe('limited');
	});

	it('returns limited when a runtime issue is present during startup', () => {
		expect(
			deriveCapabilityTier(isolated, {
				workerReady: false,
				webgpuReady: false,
				runtimeIssue: 'Worker failed to initialize'
			})
		).toBe('limited');
	});

	it('returns starting while the worker is booting on an isolated origin', () => {
		expect(
			deriveCapabilityTier(isolated, {
				workerReady: false,
				webgpuReady: false,
				runtimeIssue: null
			})
		).toBe('starting');
	});

	it('returns limited when COOP/COEP is missing', () => {
		const snapshot = probeCapabilities({
			...isolated,
			crossOriginIsolated: false,
			sharedArrayBuffer: false
		});
		expect(
			deriveCapabilityTier(snapshot, {
				workerReady: false,
				webgpuReady: false,
				runtimeIssue: null
			})
		).toBe('limited');
	});

	it('returns limited (not starting) when isolated but a required accelerated feature is missing', () => {
		const snapshot = probeCapabilities({ ...isolated, offscreenCanvas: false });
		expect(
			deriveCapabilityTier(snapshot, {
				workerReady: false,
				webgpuReady: false,
				runtimeIssue: null
			})
		).toBe('limited');
	});

	it('returns blocked when File API is missing', () => {
		const snapshot = probeCapabilities({ ...isolated, fileApi: false });
		expect(
			deriveCapabilityTier(snapshot, {
				workerReady: false,
				webgpuReady: false,
				runtimeIssue: null
			})
		).toBe('blocked');
	});
});

describe('missingAcceleratedFeatures', () => {
	it('lists only unavailable premium features', () => {
		const snapshot = probeCapabilities({
			fileApi: true,
			crossOriginIsolated: true,
			sharedArrayBuffer: true,
			webgpu: false,
			webCodecs: true,
			offscreenCanvas: true,
			fileSystemAccess: true,
			audioWorklet: true
		});
		expect(missingAcceleratedFeatures(snapshot)).toEqual(['webgpu']);
	});
});

describe('importUnavailableReason', () => {
	it('explains compatibility import in limited mode', () => {
		const snapshot = probeCapabilities({
			fileApi: true,
			crossOriginIsolated: false,
			sharedArrayBuffer: false,
			webgpu: false,
			webCodecs: true,
			offscreenCanvas: true,
			fileSystemAccess: true,
			audioWorklet: true
		});
		expect(
			importUnavailableReason('limited', snapshot, {
				workerReady: false,
				webgpuReady: false,
				runtimeIssue: null
			})
		).toContain('Compatibility import');
	});
});
