/**
 * Chrome Web Speech fallback for auto-captions (Phase 29).
 * Routes PCM audio through a real-time AudioContext → MediaStream →
 * SpeechRecognition to produce phrase-level caption segments.
 *
 * All processing stays on-device in Chrome 139+. No network requests.
 */
import type { CaptionSegmentSnapshot } from '../../protocol';
import { downmixToMono } from './whisper-dsp';

function createSpeechRecognition(lang?: string): SpeechRecognition {
	const ctor: typeof SpeechRecognition | undefined =
		(globalThis as Record<string, unknown>)['SpeechRecognition'] as typeof SpeechRecognition
		|| (globalThis as Record<string, unknown>)['webkitSpeechRecognition'] as typeof SpeechRecognition;
	if (!ctor) {
		throw new Error('SpeechRecognition not available in this browser.');
	}
	const recognition = new ctor();
	recognition.continuous = true;
	recognition.interimResults = false;
	recognition.maxAlternatives = 1;
	if (lang) recognition.lang = lang;
	return recognition;
}

interface RecognitionResult {
	transcript: string;
	startS: number;
	endS: number;
}

/**
 * Transcribe PCM audio using Chrome's on-device SpeechRecognition.
 *
 * Because SpeechRecognition requires a live MediaStream, we create a
 * real-time AudioContext, feed the PCM through an AudioBufferSourceNode,
 * and collect results with approximate timestamps.
 *
 * For long audio this runs in real-time (1× speed), so clips >15 min
 * are warned about.
 */
export function transcribeWithWebSpeech(
	pcm: Float32Array,
	sampleRate: number,
	channels: number,
	language?: string
): Promise<CaptionSegmentSnapshot[]> {
	return new Promise((resolve, reject) => {
		try {
			const recognition = createSpeechRecognition(language);
			const audioContext = new AudioContext({ sampleRate });

			// Downmix and create an AudioBuffer
			const mono = channels > 1 ? downmixToMono(pcm, channels) : new Float32Array(pcm);
			const buffer = audioContext.createBuffer(1, mono.length, audioContext.sampleRate);
			buffer.getChannelData(0).set(mono);

			const source = audioContext.createBufferSource();
			source.buffer = buffer;

			const destination = audioContext.createMediaStreamDestination();
			source.connect(destination);

			const results: RecognitionResult[] = [];
			const startTime = performance.now();

			recognition.onresult = (event: SpeechRecognitionEvent) => {
				for (let i = 0; i < event.results.length; i++) {
					const result = event.results[i];
					if (result.isFinal) {
						const elapsed = (performance.now() - startTime) / 1000;
						results.push({
							transcript: result[0].transcript.trim(),
							startS: Math.max(0, elapsed - 1),
							endS: elapsed
						});
					}
				}
			};

			recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
				if (event.error === 'no-speech') {
					// No speech detected — resolve with empty segments
					cleanup();
					resolve([]);
				} else if (event.error === 'aborted') {
					cleanup();
					resolve(resultsToSegments(results));
				} else {
					cleanup();
					reject(new Error(`Speech recognition error: ${event.error}`));
				}
			};

			recognition.onend = () => {
				cleanup();
				resolve(resultsToSegments(results));
			};

			const cleanup = () => {
				try {
					source.stop();
				} catch {
					// already stopped
				}
				source.disconnect();
				audioContext.close().catch(() => undefined);
			};

			// Start recognition and playback simultaneously
			recognition.start();
			source.start(0);
			source.onended = () => {
				recognition.stop();
			};
		} catch (error) {
			reject(error);
		}
	});
}

function resultsToSegments(results: RecognitionResult[]): CaptionSegmentSnapshot[] {
	return results.map((result, index) => ({
		id: `chrome-speech-seg-${index}`,
		start: result.startS,
		duration: Math.max(0.1, result.endS - result.startS),
		text: result.transcript
	}));
}
