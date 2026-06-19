import type { CapabilityProbeResult } from '../protocol';

export function captureUnavailableReasons(probe: CapabilityProbeResult): string[] {
	const reasons: string[] = [];
	if (probe.capture.mediaStreamTrackProcessor !== 'supported') {
		reasons.push('MediaStreamTrackProcessor is unavailable.');
	}
	if (
		probe.capture.transferableMediaStreamTrack !== 'supported' &&
		probe.capture.mediaStreamTrackProcessor !== 'supported'
	) {
		reasons.push('Transferable MediaStreamTrack is unavailable.');
	}
	if (probe.capture.displayCapture !== 'supported') {
		reasons.push('Display capture is unavailable.');
	}
	if (probe.capture.videoEncodeRealtime !== 'supported') {
		reasons.push('Realtime video encode is unavailable.');
	}
	if (probe.capture.opfsSyncAccessHandle !== 'supported') {
		reasons.push('OPFS SyncAccessHandle is unavailable.');
	}
	return reasons;
}
