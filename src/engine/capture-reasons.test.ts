import { describe, it, expect } from 'vite-plus/test';
import { captureUnavailableReasons } from './capture-reasons';
import type { CapabilityProbeResult } from '../protocol';

function probe(overrides: Partial<CapabilityProbeResult['capture']> = {}): CapabilityProbeResult {
	return {
		capture: {
			mediaStreamTrackProcessor: 'supported',
			transferableMediaStreamTrack: 'supported',
			displayCapture: 'supported',
			displayAudioCapture: 'supported',
			videoEncodeRealtime: 'supported',
			audioEncodeOpus: 'supported',
			audioEncodeAac: 'supported',
			opfsSyncAccessHandle: 'supported',
			...overrides
		}
	} as unknown as CapabilityProbeResult;
}

describe('captureUnavailableReasons', () => {
	it('returns empty array when all capture probes pass', () => {
		expect(captureUnavailableReasons(probe())).toEqual([]);
	});
	it('names realtime video encode when missing', () => {
		const reasons = captureUnavailableReasons(probe({ videoEncodeRealtime: 'unsupported' }));
		expect(reasons).toContain('Realtime video encode is unavailable.');
	});
	it('names OPFS SyncAccessHandle when missing', () => {
		const reasons = captureUnavailableReasons(probe({ opfsSyncAccessHandle: 'unknown' }));
		expect(reasons).toContain('OPFS SyncAccessHandle is unavailable.');
	});
	it('never mentions WebGPU or WebCodecs', () => {
		const reasons = captureUnavailableReasons(probe({ videoEncodeRealtime: 'unsupported' }));
		expect(reasons.some((r) => r.includes('WebGPU'))).toBe(false);
		expect(reasons.some((r) => r.includes('WebCodecs'))).toBe(false);
	});
	it('suppresses transferable-track reason when MSTP is available', () => {
		const reasons = captureUnavailableReasons(
			probe({
				transferableMediaStreamTrack: 'unsupported',
				mediaStreamTrackProcessor: 'supported'
			})
		);
		expect(reasons).not.toContain('Transferable MediaStreamTrack is unavailable.');
	});
	it('shows transferable-track reason when MSTP is also unavailable', () => {
		const reasons = captureUnavailableReasons(
			probe({
				transferableMediaStreamTrack: 'unsupported',
				mediaStreamTrackProcessor: 'unsupported'
			})
		);
		expect(reasons).toContain('Transferable MediaStreamTrack is unavailable.');
	});
});
