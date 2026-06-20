import { describe, expect, it } from 'vite-plus/test';
import {
	DIAGNOSTIC_SNAPSHOT_SCHEMA_VERSION,
	type DiagnosticSnapshot,
	type CapabilityReport,
	type RecentErrorLog
} from './types';
import { createEmptyRecentErrorLog } from './recent-errors';
import { buildCopyableDiagnosticReport } from './redaction';

function acceleratedSnapshot(): DiagnosticSnapshot {
	return {
		schemaVersion: DIAGNOSTIC_SNAPSHOT_SCHEMA_VERSION,
		snapshotId: 'selfcheck-accel',
		createdAt: new Date().toISOString(),
		appVersion: '1.0.0',
		browser: { userAgentFamily: 'Chrome', userAgentVersion: '120', platformFamily: 'macOS' },
		capability: acceleratedCapability(),
		storage: {
			opfsSupported: true,
			indexedDbSupported: true,
			persistentStorage: 'granted',
			usageBytes: 1024,
			quotaBytes: 1_000_000,
			warning: 'ok'
		},
		proxyCache: {
			status: 'available',
			proxyAssets: 0,
			readyProxies: 0,
			failedProxies: 0,
			estimatedBytes: 0,
			message: 'No proxies'
		},
		voiceCleanup: {
			denoiserEnabledTrackCount: 0,
			wasmProvenance: '@jitsi/rnnoise-wasm@0.2.1 prebuilt artifact',
			wasmSha256: null,
			wasmLoadStatus: 'not-loaded',
			wasmLoadTimeMs: null,
			workletLatencyMs: 17.67,
			normalisationTargetLufs: -14,
			normaliseGainDb: 0,
			limiterCeilingDbtp: -1,
			findings: []
		},
		activeExportSettings: {
			codec: 'h264',
			container: 'mp4',
			width: 1920,
			height: 1080,
			fps: 30,
			videoBitrate: 8_000_000,
			sourceMode: 'original',
			range: 'full'
		},
		performanceBudgets: [],
		recentErrors: createEmptyRecentErrorLog(),
		recoveryActions: []
	};
}

function limitedSnapshot(): DiagnosticSnapshot {
	return {
		...acceleratedSnapshot(),
		snapshotId: 'selfcheck-limited',
		capability: {
			...acceleratedCapability(),
			tier: 'limited',
			tierReason: 'crossOriginIsolated is false',
			crossOriginIsolated: false,
			sharedArrayBuffer: { code: 'sab', status: 'unavailable', message: 'SAB not available' }
		}
	};
}

function blockedSnapshot(): DiagnosticSnapshot {
	return {
		...acceleratedSnapshot(),
		snapshotId: 'selfcheck-blocked',
		capability: {
			...acceleratedCapability(),
			tier: 'blocked',
			tierReason: 'No WebGPU, no compatibility fallback',
			webGpu: {
				...acceleratedCapability().webGpu,
				status: 'unavailable',
				features: []
			}
		}
	};
}

function acceleratedCapability(): CapabilityReport {
	return {
		tier: 'accelerated',
		tierReason: 'All capabilities available',
		crossOriginIsolated: true,
		sharedArrayBuffer: { code: 'sab', status: 'supported', message: 'SAB available' },
		webGpu: {
			status: 'ready',
			features: ['shader-f16'],
			optionalFeatures: {
				shaderF16: { code: 'shader-f16', status: 'supported', message: 'Supported' },
				timestampQuery: {
					code: 'timestamp-query',
					status: 'unsupported',
					message: 'Not supported'
				},
				subgroups: { code: 'subgroups', status: 'unsupported', message: 'Not supported' }
			}
		},
		webCodecs: {
			decoders: [{ codec: 'avc1.640028', direction: 'decode', supported: true }],
			encoders: [{ codec: 'avc1.640028', direction: 'encode', supported: true }]
		},
		formatCompatibility: null,
		mediabunny: { code: 'mediabunny', status: 'supported', message: 'Available' },
		audioWorklet: {
			code: 'audio-worklet',
			status: 'unknown',
			message: 'Unknown in worker context'
		},
		fileSystemAccess: { code: 'fsa', status: 'supported', message: 'Available' },
		opfs: { code: 'opfs', status: 'supported', message: 'Available' },
		findings: []
	};
}

describe('Diagnostics self-check', () => {
	it('accelerated snapshot has expected tier and isolation', () => {
		const snap = acceleratedSnapshot();
		expect(snap.capability.tier).toBe('accelerated');
		expect(snap.capability.crossOriginIsolated).toBe(true);
		expect(snap.capability.webGpu.status).toBe('ready');
		expect(snap.schemaVersion).toBe(DIAGNOSTIC_SNAPSHOT_SCHEMA_VERSION);
	});

	it('limited snapshot reports missing isolation', () => {
		const snap = limitedSnapshot();
		expect(snap.capability.tier).toBe('limited');
		expect(snap.capability.crossOriginIsolated).toBe(false);
		expect(snap.capability.tierReason).toContain('crossOriginIsolated');
	});

	it('blocked snapshot reports missing capabilities', () => {
		const snap = blockedSnapshot();
		expect(snap.capability.tier).toBe('blocked');
		expect(snap.capability.webGpu.status).toBe('unavailable');
	});

	it('copyable report from accelerated snapshot preserves tier info', () => {
		const snap = acceleratedSnapshot();
		const report = buildCopyableDiagnosticReport(snap, []);
		expect(report.capability.tier).toBe('accelerated');
		expect(report.capability.crossOriginIsolated).toBe(true);
		expect(report.snapshotId).toBe('selfcheck-accel');
	});

	it('copyable report from limited snapshot preserves degraded info', () => {
		const snap = limitedSnapshot();
		const report = buildCopyableDiagnosticReport(snap, []);
		expect(report.capability.tier).toBe('limited');
		expect(report.capability.crossOriginIsolated).toBe(false);
	});

	it('copyable report from blocked snapshot preserves blocked info', () => {
		const snap = blockedSnapshot();
		const report = buildCopyableDiagnosticReport(snap, []);
		expect(report.capability.tier).toBe('blocked');
	});

	it('all three tiers produce valid non-empty reports', () => {
		for (const snap of [acceleratedSnapshot(), limitedSnapshot(), blockedSnapshot()]) {
			const report = buildCopyableDiagnosticReport(snap, []);
			const json = JSON.stringify(report);
			expect(json.length).toBeGreaterThan(100);
			expect(() => JSON.parse(json)).not.toThrow();
			expect(report.reportSchemaVersion).toBe(1);
			expect(report.generatedAt).toBeTruthy();
		}
	});

	it('recent errors log starts empty and within capacity', () => {
		const log: RecentErrorLog = createEmptyRecentErrorLog();
		expect(log.entries).toHaveLength(0);
		expect(log.droppedCount).toBe(0);
		expect(log.capacity).toBeGreaterThan(0);
	});

	it('recovery actions array is structured-clone safe', () => {
		const snap = acceleratedSnapshot();
		const cloned = structuredClone(snap.recoveryActions);
		expect(cloned).toEqual(snap.recoveryActions);
	});
});
