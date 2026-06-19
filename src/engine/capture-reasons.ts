import type { CapabilityProbeResult } from '../protocol';

export function captureUnavailableReasons(probe: CapabilityProbeResult): string[] {
	const reasons: string[] = [];
	if (probe.capture.mediaStreamTrackProcessor !== 'supported') {
		reasons.push('MediaStreamTrackProcessor is unavailable.');
	}
	if (probe.capture.transferableMediaStreamTrack === 'unsupported') {
		// Recording transfers the source track into the pipeline worker, so this is
		// a genuine blocker. Surface the actionable workaround rather than a dead end.
		reasons.push(
			'Transferable MediaStreamTrack is unavailable. Enable chrome://flags/#enable-experimental-web-platform-features to record on this browser.'
		);
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
