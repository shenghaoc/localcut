/**
 * ASR capability probe (Phase 29). Reuses the Phase 28 WebNN probe for
 * WebNN availability and separately checks Chrome 139+ SpeechRecognition.
 * Side-effect free: no model load, no graph build, no AudioContext created.
 */
import type { AsrProbeResult, FeatureSupport, WebNNProbeResult } from '../../protocol';

function probeSpeechRecognition(): FeatureSupport {
	try {
		const hasRecognition =
			typeof SpeechRecognition !== 'undefined' || typeof webkitSpeechRecognition !== 'undefined';
		if (!hasRecognition) return 'unsupported';
		// Chrome 139+ has on-device speech. We can't runtime-probe whether
		// it's truly on-device (the API surface is the same), but the
		// presence in a Chromium browser is a strong signal.
		return 'supported';
	} catch {
		return 'unknown';
	}
}

function defaultWebNNProbe(): WebNNProbeResult {
	return {
		mlPresent: false,
		backends: { cpu: 'unknown' as FeatureSupport, gpu: 'unknown' as FeatureSupport, npu: 'unknown' as FeatureSupport },
		modelSupport: 'unknown' as FeatureSupport
	};
}

function chooseRecommended(
	webnn: WebNNProbeResult,
	speechRecognition: FeatureSupport
): AsrProbeResult['recommended'] {
	if (webnn.modelSupport === 'supported' || (webnn.mlPresent && webnn.modelSupport === 'unknown')) {
		return 'webnn-whisper';
	}
	if (speechRecognition === 'supported') {
		return 'chrome-speech';
	}
	return 'none';
}

export function probeAsr(webnnProbe?: WebNNProbeResult | null): AsrProbeResult {
	const webnn = webnnProbe ?? defaultWebNNProbe();
	const speechRecognition = probeSpeechRecognition();
	const recommended = chooseRecommended(webnn, speechRecognition);
	return { webnn, speechRecognition, recommended };
}

export function asrAvailable(result: AsrProbeResult): boolean {
	return result.recommended !== 'none';
}

export const ASR_UNAVAILABLE_MESSAGE = 'Auto captions unavailable in this browser.';
export const ASR_CHROME_SPEECH_TOOLTIP =
	'Chrome on-device speech recognition — caption timings are approximate. Install a Chromium browser with WebNN for word-level accuracy.';
