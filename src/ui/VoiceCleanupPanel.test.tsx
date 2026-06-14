import { describe, expect, it } from 'vite-plus/test';
import {
	isCustomLufsTarget,
	voiceCleanupAnalysisDisabledReason,
	voiceCleanupLatencyBudget,
	voiceCleanupLatencyMs
} from './VoiceCleanupPanel';

describe('VoiceCleanupPanel helpers', () => {
	it('computes the documented worklet latency budget from AudioContext sample rate', () => {
		expect(voiceCleanupLatencyMs(48_000)).toBeCloseTo(17.67, 2);
		expect(voiceCleanupLatencyMs(44_100)).toBeCloseTo(((128 + 480 + 240) / 44_100) * 1000, 6);
		expect(voiceCleanupLatencyMs(0)).toBeCloseTo(17.67, 2);
		expect(voiceCleanupLatencyBudget(48_000).map((row) => row.samples)).toEqual([128, 480, 240, 0]);
	});

	it('disables loudness analysis while running or when the timeline is empty', () => {
		expect(voiceCleanupAnalysisDisabledReason('idle', false)).toBeNull();
		expect(voiceCleanupAnalysisDisabledReason('running', false)).toBe(
			'Analysis is already running.'
		);
		expect(voiceCleanupAnalysisDisabledReason('idle', true)).toBe('Timeline is empty.');
	});

	it('detects custom loudness targets from restored project settings', () => {
		expect(isCustomLufsTarget(-14)).toBe(false);
		expect(isCustomLufsTarget(-16)).toBe(false);
		expect(isCustomLufsTarget(-23)).toBe(false);
		expect(isCustomLufsTarget(-15)).toBe(true);
		expect(isCustomLufsTarget(-18.5)).toBe(true);
	});
});
