/**
 * Loudness analysis pass for the pipeline worker.
 *
 * Streams the master mix via mixAudioWindow in non-overlapping 100 ms blocks,
 * K-weights continuously, buffers in a 400 ms sliding window, applies
 * EBU R128 gating, and returns the integrated loudness.
 *
 * Each audio sample is rendered and K-weighted exactly once (no 4× overhead).
 */

import type { Timeline } from '../timeline';
import type { MediaInputHandle } from '../media-io';
import { mixAudioWindow } from '../export';
import { LoudnessAnalyser, normalisationGain } from './ebu-r128';

export interface LoudnessAnalysisOptions {
	timeline: Timeline;
	sources: ReadonlyMap<string, MediaInputHandle>;
	sampleRate: number;
	channels: number;
	timelineDurationS: number;
	targetLufs: number;
}

/**
 * Runs the full EBU R128 analysis pass on the current project mix.
 * Reports progress via onProgress callback.
 * Returns measured integrated loudness and computed normalisation gain.
 */
export async function analyseLoudness(
	options: LoudnessAnalysisOptions,
	onProgress: (fraction: number) => void,
	signal: AbortSignal,
): Promise<{ measuredLufs: number; normalisationGainDb: number }> {
	const { timeline, sources, sampleRate, channels, timelineDurationS, targetLufs } = options;
	const analyser = new LoudnessAnalyser(sampleRate);
	const blockDurationS = 0.1; // 100 ms non-overlapping blocks
	const blockSamples = Math.round(sampleRate * blockDurationS);
	const totalBlocks = Math.ceil(timelineDurationS / blockDurationS);

	for (let i = 0; i < totalBlocks; i++) {
		if (signal.aborted) {
			throw new DOMException('Analysis aborted', 'AbortError');
		}

		const startS = i * blockDurationS;
		const pcm = await mixAudioWindow(
			timeline,
			sources,
			startS,
			blockSamples,
			sampleRate,
			channels,
		);

		// De-interleave if stereo
		if (channels >= 2) {
			const left = new Float32Array(blockSamples);
			const right = new Float32Array(blockSamples);
			for (let s = 0; s < blockSamples; s++) {
				left[s] = pcm[s * 2];
				right[s] = pcm[s * 2 + 1];
			}
			analyser.feedBlock(left, right);
		} else {
			analyser.feedBlock(pcm);
		}

		onProgress((i + 1) / totalBlocks);
	}

	const measuredLufs = analyser.integratedLoudness();
	const normalisationGainDb = normalisationGain(measuredLufs, targetLufs);

	return { measuredLufs, normalisationGainDb };
}
