import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
	buildWorkerDiagnosticSnapshot,
	invalidateDiagnosticProbeCache,
	type WorkerDiagnosticInput
} from './diagnostics';
import { createEmptyRecentErrorLog } from '../diagnostics/recent-errors';

function workerInput(): WorkerDiagnosticInput {
	return {
		appVersion: '0.0.0',
		webgpuReady: true,
		webgpuStatus: 'ready',
		webgpuFeatures: [],
		webgpuLimits: {},
		gpuUnavailableReason: null,
		lastDeviceLost: undefined,
		rendererSubmissionCount: 1,
		activeExportSettings: null,
		recentErrors: createEmptyRecentErrorLog(),
		sources: []
	};
}

describe('diagnostics probe caching', () => {
	let decoderProbe: ReturnType<typeof vi.fn>;
	let encoderProbe: ReturnType<typeof vi.fn>;
	let estimate: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		invalidateDiagnosticProbeCache();
		decoderProbe = vi.fn(async () => ({ supported: true }));
		encoderProbe = vi.fn(async () => ({ supported: true }));
		estimate = vi.fn(async () => ({ usage: 1, quota: 100 }));
		(globalThis as Record<string, unknown>).VideoDecoder = { isConfigSupported: decoderProbe };
		(globalThis as Record<string, unknown>).VideoEncoder = { isConfigSupported: encoderProbe };
		vi.stubGlobal('navigator', {
			userAgent: 'test',
			platform: 'test',
			storage: { estimate, getDirectory: () => undefined }
		});
	});

	afterEach(() => {
		delete (globalThis as Record<string, unknown>).VideoDecoder;
		delete (globalThis as Record<string, unknown>).VideoEncoder;
		vi.unstubAllGlobals();
		invalidateDiagnosticProbeCache();
	});

	it('probes codecs once across repeated snapshot builds', async () => {
		await buildWorkerDiagnosticSnapshot(workerInput());
		const decoderCallsAfterFirst = decoderProbe.mock.calls.length;
		const encoderCallsAfterFirst = encoderProbe.mock.calls.length;
		expect(decoderCallsAfterFirst).toBeGreaterThan(0);
		expect(encoderCallsAfterFirst).toBeGreaterThan(0);

		await buildWorkerDiagnosticSnapshot(workerInput());
		await buildWorkerDiagnosticSnapshot(workerInput());

		// No additional codec probes for the repeated refreshes.
		expect(decoderProbe.mock.calls.length).toBe(decoderCallsAfterFirst);
		expect(encoderProbe.mock.calls.length).toBe(encoderCallsAfterFirst);
	});

	it('re-probes codecs after explicit invalidation', async () => {
		await buildWorkerDiagnosticSnapshot(workerInput());
		const before = decoderProbe.mock.calls.length;
		invalidateDiagnosticProbeCache();
		await buildWorkerDiagnosticSnapshot(workerInput());
		expect(decoderProbe.mock.calls.length).toBeGreaterThan(before);
	});

	it('does not call storage.estimate on every snapshot within the TTL window', async () => {
		await buildWorkerDiagnosticSnapshot(workerInput());
		await buildWorkerDiagnosticSnapshot(workerInput());
		expect(estimate.mock.calls.length).toBe(1);
	});

	it('includes live-publish capability findings when the probe is provided', async () => {
		const snapshot = await buildWorkerDiagnosticSnapshot({
			...workerInput(),
			livePublish: {
				rtcPeerConnection: 'supported',
				trackGeneratorWorker: 'supported',
				trackTransfer: 'unsupported',
				generateKeyFrame: 'unknown',
				hardwareH264Encode: 'supported'
			}
		});
		const byCode = new Map(snapshot.capability.findings.map((f) => [f.code, f]));
		expect(byCode.get('publish.rtc')?.status).toBe('supported');
		expect(byCode.get('publish.track-generator')?.status).toBe('supported');
		expect(byCode.get('publish.track-transfer')?.status).toBe('unsupported');
		expect(byCode.get('publish.generateKeyFrame')?.status).toBe('unknown');
		expect(byCode.get('publish.hw-encode')?.status).toBe('supported');
	});

	it('omits live-publish findings when no probe reached the worker', async () => {
		const snapshot = await buildWorkerDiagnosticSnapshot(workerInput());
		expect(snapshot.capability.findings.some((f) => f.code.startsWith('publish.'))).toBe(false);
	});

	it('enables GPU retry when WebGPU is unavailable', async () => {
		const snapshot = await buildWorkerDiagnosticSnapshot({
			...workerInput(),
			webgpuReady: false,
			webgpuStatus: 'failed',
			gpuUnavailableReason: 'No adapter'
		});
		const action = snapshot.recoveryActions.find((item) => item.actionId === 'retry-gpu-device');
		expect(action?.enabled).toBe(true);
		expect(action?.reasonDisabled).toBeUndefined();
	});

	it('enables device-lost recovery when a GPU device was lost', async () => {
		const snapshot = await buildWorkerDiagnosticSnapshot({
			...workerInput(),
			webgpuReady: false,
			webgpuStatus: 'lost',
			lastDeviceLost: {
				reason: 'unknown',
				message: 'device reset',
				occurredAt: new Date().toISOString(),
				recoveryAttempts: 0,
				fallbackMode: 'limited-preview'
			}
		});
		const action = snapshot.recoveryActions.find(
			(item) => item.actionId === 'device-lost-recovery'
		);
		expect(action?.enabled).toBe(true);
		expect(action?.reasonDisabled).toBeUndefined();
	});
});
