import { describe, expect, it } from 'vite-plus/test';
import {
	buildCopyableDiagnosticReport,
	buildSafeSourceSummaries,
	formatCopyableDiagnosticReport,
	redactDiagnosticText
} from './redaction';
import { createEmptyRecentErrorLog, logRecentError } from './recent-errors';
import { buildDefaultPerformanceBudgets } from './performance-budgets';
import type { DiagnosticSnapshot, DiagnosticSourceInput } from './types';

function baseSnapshot(): DiagnosticSnapshot {
	const recentErrors = logRecentError(createEmptyRecentErrorLog(), {
		code: 'import.failed',
		subsystem: 'import',
		severity: 'error',
		message: 'Failed to open /Users/alice/Videos/private-cut.mp4',
		detail: 'DOMException for "secret-title.mov" with fingerprint abcdef1234567890abcdef1234567890',
		occurredAt: '2026-06-07T00:00:00.000Z'
	});
	return {
		schemaVersion: 1,
		snapshotId: 'diag-test',
		createdAt: '2026-06-07T00:00:00.000Z',
		appVersion: '1.0.0',
		browser: { userAgentFamily: 'Chromium', userAgentVersion: '126', platformFamily: 'macOS' },
		capability: {
			tier: 'limited',
			tierReason: 'test',
			crossOriginIsolated: false,
			sharedArrayBuffer: { code: 'sab', status: 'unsupported', message: 'missing' },
			webGpu: {
				status: 'unavailable',
				features: [],
				optionalFeatures: {
					shaderF16: { code: 'f16', status: 'unknown', message: 'unknown' },
					timestampQuery: { code: 'timestamp', status: 'unknown', message: 'unknown' },
					subgroups: { code: 'subgroups', status: 'unknown', message: 'unknown' }
				}
			},
			webCodecs: { decoders: [], encoders: [] },
			formatCompatibility: null,
			mediabunny: { code: 'mediabunny', status: 'supported', message: 'bundled' },
			audioWorklet: { code: 'audio', status: 'supported', message: 'ok' },
			fileSystemAccess: { code: 'fsa', status: 'supported', message: 'ok' },
			opfs: { code: 'opfs', status: 'supported', message: 'ok' },
			findings: []
		},
		storage: {
			opfsSupported: true,
			indexedDbSupported: true,
			persistentStorage: 'unknown',
			usageBytes: 100,
			quotaBytes: 200,
			warning: 'ok'
		},
		proxyCache: {
			status: 'unknown',
			proxyAssets: 0,
			readyProxies: 0,
			failedProxies: 0,
			estimatedBytes: 0,
			message: 'none'
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
		activeExportSettings: null,
		performanceBudgets: buildDefaultPerformanceBudgets(),
		recentErrors,
		recoveryActions: []
	};
}

describe('diagnostic redaction', () => {
	it('redacts paths, file names, and long fingerprint-like hex strings', () => {
		const redacted = redactDiagnosticText(
			'Read /Users/alice/Movies/client.mp4 and C:\\Users\\Alice\\secret.mov abcdef1234567890abcdef1234567890'
		);
		expect(redacted).not.toContain('/Users/alice');
		expect(redacted).not.toContain('client.mp4');
		expect(redacted).not.toContain('secret.mov');
		expect(redacted).not.toContain('abcdef1234567890abcdef1234567890');
		expect(redacted).toContain('[redacted-path]');
	});

	it('builds safe source summaries without file names or raw fingerprints', () => {
		const sources: DiagnosticSourceInput[] = [
			{
				sourceId: 'source-b',
				fileName: 'private-family-video.mp4',
				kind: 'video',
				durationS: 123,
				mimeType: 'video/mp4',
				fingerprint: { algorithm: 'sha-256', digest: 'f'.repeat(64) },
				video: { width: 1920, height: 1080, codec: 'avc1', canDecode: true },
				audio: { codec: 'mp4a', canDecode: true }
			},
			{
				sourceId: 'source-a',
				fileName: 'secret-audio.wav',
				kind: 'audio',
				durationS: 5,
				mimeType: 'audio/wav',
				audio: { codec: 'pcm', canDecode: false }
			}
		];
		const summaries = buildSafeSourceSummaries(sources);
		const json = JSON.stringify(summaries);
		expect(json).not.toContain('private-family-video');
		expect(json).not.toContain('secret-audio');
		expect(json).not.toContain('f'.repeat(64));
		expect(summaries[0]?.sourceAlias).toBe('source-2');
		expect(summaries[1]?.sourceAlias).toBe('source-1');
		expect(summaries[0]?.durationBucket).toBe('1m-10m');
		expect(summaries[1]?.statusCodes).toContain('audio-decode-unsupported');
	});

	it('formats a copyable report without private source fields or raw error detail', () => {
		const report = buildCopyableDiagnosticReport(
			baseSnapshot(),
			[
				{
					sourceId: 'source-1',
					fileName: 'wedding-title-card.png',
					kind: 'image',
					durationS: 4,
					mimeType: 'image/png',
					fingerprint: { algorithm: 'sha-256', digest: 'a'.repeat(64) }
				}
			],
			'2026-06-07T00:00:01.000Z'
		);
		const text = formatCopyableDiagnosticReport(report);
		expect(text).not.toContain('wedding-title-card');
		expect(text).not.toContain('private-cut.mp4');
		expect(text).not.toContain('secret-title.mov');
		expect(text).not.toContain('a'.repeat(64));
		expect(text).toContain('import.failed');
		expect(text).toContain('source-1');
	});
});
