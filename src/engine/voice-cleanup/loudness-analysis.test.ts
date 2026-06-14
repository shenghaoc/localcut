import { describe, expect, it, vi } from 'vite-plus/test';
import { DEFAULT_GATE_PARAMS, DEFAULT_LIMITER_PARAMS } from '../../protocol';
import type { MediaInputHandle } from '../media-io';
import { defaultNormalizedSourceTiming } from '../media-adapters/source-timing';
import {
	DEFAULT_TRACK_MIX,
	defaultTimelineClip,
	type Timeline,
	type TimelineTrack
} from '../timeline';
import { createVoiceCleanupChainState } from './voice-cleanup-processor';
import { analyseLoudness } from './loudness-analysis';

function audioTrack(
	partial: Partial<Omit<TimelineTrack, 'type' | 'clips'>> & {
		id: string;
		clips: TimelineTrack['clips'];
	}
): TimelineTrack {
	return { type: 'audio', ...DEFAULT_TRACK_MIX, ...partial };
}

function sourceWith(value: number): MediaInputHandle {
	const duration = 0.5;
	return {
		sourceId: 'voice',
		kind: 'audio',
		name: 'voice.wav',
		size: 1024,
		duration,
		timing: defaultNormalizedSourceTiming(duration, 'audio'),
		audioSource: {
			pcmWindowAt: vi.fn(async (_time: number, frames: number, channels: number) =>
				new Float32Array(frames * channels).fill(value)
			)
		} as unknown as MediaInputHandle['audioSource']
	} as unknown as MediaInputHandle;
}

describe('analyseLoudness', () => {
	it('measures the post-cleanup master mix used by export', async () => {
		const timeline: Timeline = [
			audioTrack({
				id: 'voice-track',
				clips: [
					defaultTimelineClip({
						id: 'voice',
						sourceId: 'voice',
						start: 0,
						duration: 0.5,
						inPoint: 0
					})
				]
			})
		];
		const sources = new Map<string, MediaInputHandle>([['voice', sourceWith(0.5)]]);
		const base = {
			timeline,
			sources,
			sampleRate: 48_000,
			channels: 1,
			timelineDurationS: 0.5,
			targetLufs: -23
		};
		const dry = await analyseLoudness(base, () => {}, new AbortController().signal);
		const cleaned = await analyseLoudness(
			{
				...base,
				voiceCleanup: {
					denoiserEnabledTracks: [],
					normaliseGainDb: -6,
					limiterCeilingDbtp: -1,
					gateParams: { ...DEFAULT_GATE_PARAMS, bypass: true },
					limiterParams: { ...DEFAULT_LIMITER_PARAMS, bypass: true }
				},
				cleanupState: createVoiceCleanupChainState()
			},
			() => {},
			new AbortController().signal
		);

		expect(cleaned.measuredLufs).toBeLessThan(dry.measuredLufs - 5.5);
	});
});
