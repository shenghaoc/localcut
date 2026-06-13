/**
 * ASR capability probe (Phase 29). WebNN and Browser SpeechRecognition remain
 * diagnostic signals only until selected-clip transcription has a real
 * worker-backed ASR engine.
 */
import type { AsrProbeResult, FeatureSupport, WebNNProbeResult } from '../../protocol';

function probeSpeechRecognition(): FeatureSupport {
	try {
		const hasRecognition =
			typeof (globalThis as Record<string, unknown>)['SpeechRecognition'] !== 'undefined' ||
			typeof (globalThis as Record<string, unknown>)['webkitSpeechRecognition'] !== 'undefined';
		if (!hasRecognition) return 'unsupported';
		return 'supported';
	} catch {
		return 'unknown';
	}
}

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
	const speechRecognition = probeSpeechRecognition();
	return { webnn, speechRecognition, recommended: 'none' };
}

export function asrAvailable(result: AsrProbeResult): boolean {
	return result.recommended !== 'none';
}

export const ASR_UNAVAILABLE_MESSAGE =
	'Auto captions need a real selected-audio ASR engine. Browser SpeechRecognition is disabled for clips.';
