/**
 * ASR capability probe (Phase 29). Reports WebNN as a diagnostic signal only.
 *
 * There is no practical fallback for selected-clip transcription: Browser
 * SpeechRecognition listens to live mic/page audio and cannot consume the PCM
 * extracted from a timeline clip, so the Chrome Speech service was removed
 * rather than kept as a fake fallback. Auto Captions stay `recommended: 'none'`
 * until the on-device LiteRT-over-WebNN Whisper engine (PR94) lands.
 */
import type { AsrProbeResult, FeatureSupport, WebNNProbeResult } from '../../protocol';

function defaultWebNNProbe(): WebNNProbeResult {
	return {
		mlPresent: false,
		backends: {
			cpu: 'unknown' as FeatureSupport,
			gpu: 'unknown' as FeatureSupport,
			npu: 'unknown' as FeatureSupport
		},
		modelSupport: 'unknown' as FeatureSupport
	};
}

export function probeAsr(webnnProbe?: WebNNProbeResult | null): AsrProbeResult {
	const webnn = webnnProbe ?? defaultWebNNProbe();
	return { webnn, recommended: 'none' };
}

export function asrAvailable(result: AsrProbeResult): boolean {
	return result.recommended !== 'none';
}

export const ASR_UNAVAILABLE_MESSAGE =
	'Auto Captions are unavailable until the on-device WebNN speech engine (LiteRT Whisper) lands. Browser speech recognition is not a usable fallback for timeline clips.';
