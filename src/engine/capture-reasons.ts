import type { CapabilityProbeResult } from '../protocol';

export interface CaptureReasonOptions {
	/**
	 * Whether Transferable MediaStreamTrack is required for the feature. Program Mode
	 * still transfers every source track into the worker, so it requires it (default).
	 * Plain recording no longer does — it falls back to the off-main-thread
	 * main-frames path (bugfix B5/T5.5) — so RecordPanel passes `false`.
	 */
	requireTransferableTrack?: boolean;
}

/**
 * Human-readable reasons recording / Program Mode is unavailable. Covers **every**
 * hard gate in `recordingAvailable()` (capability-probe-v2): the tier-level gates
 * that compose `tier === 'core-webgpu'` (isolation, SAB, OffscreenCanvas, WebGPU
 * core, video decode) *and* the capture-pipeline probes. Keeping this exhaustive
 * means a disabled Record/Program panel always has at least one actionable line,
 * even when the blocker is a non-capture capability.
 */
export function captureUnavailableReasons(
	probe: CapabilityProbeResult,
	options: CaptureReasonOptions = {}
): string[] {
	const requireTransferableTrack = options.requireTransferableTrack ?? true;
	const reasons: string[] = [];
	const cap = probe.capture;
	const codecs = probe.codecs;

	// Tier-level gates (recordingAvailable requires tier === 'core-webgpu').
	if (probe.crossOriginIsolated !== true) {
		reasons.push('Cross-origin isolation (COOP/COEP) is unavailable.');
	}
	if (probe.sharedArrayBuffer !== 'supported') {
		reasons.push('SharedArrayBuffer is unavailable.');
	}
	if (probe.offscreenCanvas !== 'supported') {
		reasons.push('OffscreenCanvas is unavailable.');
	}
	if (probe.webGPUCore !== 'supported') {
		reasons.push('WebGPU (core) is unavailable.');
	}
	if (
		codecs.h264Decode !== 'supported' &&
		codecs.vp9Decode !== 'supported' &&
		codecs.av1Decode !== 'supported'
	) {
		reasons.push('Hardware video decode is unavailable.');
	}

	// Capture-pipeline gates.
	if (cap.mediaStreamTrackProcessor !== 'supported') {
		reasons.push('MediaStreamTrackProcessor is unavailable.');
	}
	if (requireTransferableTrack && cap.transferableMediaStreamTrack === 'unsupported') {
		// Program Mode transfers each source track into the pipeline worker, so this is
		// a genuine blocker there. Surface the actionable workaround rather than a dead
		// end. (Plain recording degrades to the main-frames path instead — see B5/T5.5.)
		reasons.push(
			'Transferable MediaStreamTrack is unavailable. Enable chrome://flags/#enable-experimental-web-platform-features to record on this browser.'
		);
	}
	if (cap.displayCapture !== 'supported') {
		reasons.push('Display capture is unavailable.');
	}
	if (cap.videoEncodeRealtime !== 'supported') {
		reasons.push('Realtime video encode is unavailable.');
	}
	if (cap.audioEncodeOpus !== 'supported') {
		reasons.push('Opus audio encode is unavailable.');
	}
	if (cap.opfsSyncAccessHandle !== 'supported') {
		reasons.push('OPFS SyncAccessHandle is unavailable.');
	}
	return reasons;
}
