import { describe, it, expect } from 'vite-plus/test';
import { captureUnavailableReasons } from './capture-reasons';
import type { CapabilityProbeResult } from '../protocol';

function probe(
	captureOverrides: Partial<CapabilityProbeResult['capture']> = {},
	probeOverrides: Partial<CapabilityProbeResult> = {}
): CapabilityProbeResult {
	const allDecode = {
		h264Decode: 'supported',
		vp9Decode: 'supported',
		av1Decode: 'supported',
		h264Encode: 'supported',
		vp9Encode: 'supported',
		av1Encode: 'supported',
		aacDecode: 'supported',
		opusDecode: 'supported',
		aacEncode: 'supported',
		opusEncode: 'supported'
	};
	return {
		crossOriginIsolated: true,
		sharedArrayBuffer: 'supported',
		offscreenCanvas: 'supported',
		webGPUCore: 'supported',
		codecs: allDecode,
		capture: {
			mediaStreamTrackProcessor: 'supported',
			transferableMediaStreamTrack: 'supported',
			displayCapture: 'supported',
			displayAudioCapture: 'supported',
			videoEncodeRealtime: 'supported',
			audioEncodeOpus: 'supported',
			audioEncodeAac: 'supported',
			opfsSyncAccessHandle: 'supported',
			...captureOverrides
		},
		...probeOverrides
	} as unknown as CapabilityProbeResult;
}

describe('captureUnavailableReasons', () => {
	it('returns empty array when all gates pass', () => {
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
	it('names Opus audio encode when missing (a hard recordingAvailable gate)', () => {
		const reasons = captureUnavailableReasons(probe({ audioEncodeOpus: 'unsupported' }));
		expect(reasons).toContain('Opus audio encode is unavailable.');
	});
	it('names tier-level gates (COOP/COEP, SAB, OffscreenCanvas, WebGPU) when missing', () => {
		expect(
			captureUnavailableReasons(probe({}, { crossOriginIsolated: false })).some((r) =>
				r.includes('COOP/COEP')
			)
		).toBe(true);
		expect(captureUnavailableReasons(probe({}, { sharedArrayBuffer: 'unsupported' }))).toContain(
			'SharedArrayBuffer is unavailable.'
		);
		expect(captureUnavailableReasons(probe({}, { offscreenCanvas: 'unsupported' }))).toContain(
			'OffscreenCanvas is unavailable.'
		);
		expect(captureUnavailableReasons(probe({}, { webGPUCore: 'unsupported' }))).toContain(
			'WebGPU (core) is unavailable.'
		);
	});
	it('does not blame WebGPU or WebCodecs when those are present', () => {
		const reasons = captureUnavailableReasons(probe({ videoEncodeRealtime: 'unsupported' }));
		expect(reasons.some((r) => r.includes('WebGPU'))).toBe(false);
		expect(reasons.some((r) => r.includes('WebCodecs'))).toBe(false);
	});
	it('shows an actionable transferable-track reason (with flag hint) when it is unsupported', () => {
		const reasons = captureUnavailableReasons(
			probe({ transferableMediaStreamTrack: 'unsupported' })
		);
		expect(reasons.some((r) => r.startsWith('Transferable MediaStreamTrack is unavailable.'))).toBe(
			true
		);
		expect(reasons.some((r) => r.includes('chrome://flags'))).toBe(true);
	});
	it("omits the transferable-track reason when it is supported or 'unknown' (not a hard block)", () => {
		expect(
			captureUnavailableReasons(probe({ transferableMediaStreamTrack: 'unknown' })).some((r) =>
				r.includes('Transferable MediaStreamTrack')
			)
		).toBe(false);
		expect(
			captureUnavailableReasons(probe({ transferableMediaStreamTrack: 'supported' })).some((r) =>
				r.includes('Transferable MediaStreamTrack')
			)
		).toBe(false);
	});
	it('omits the transferable-track reason when requireTransferableTrack is false (recording main-frames path, B5/T5.5)', () => {
		// Recording no longer hard-requires transfer — the main-frames fallback covers
		// it — so RecordPanel suppresses the reason even when transfer is unsupported.
		const reasons = captureUnavailableReasons(
			probe({ transferableMediaStreamTrack: 'unsupported' }),
			{
				requireTransferableTrack: false
			}
		);
		expect(reasons.some((r) => r.includes('Transferable MediaStreamTrack'))).toBe(false);
		// Other genuine blockers still surface under the option.
		expect(
			captureUnavailableReasons(
				probe({ transferableMediaStreamTrack: 'unsupported', videoEncodeRealtime: 'unsupported' }),
				{ requireTransferableTrack: false }
			)
		).toContain('Realtime video encode is unavailable.');
	});
});
