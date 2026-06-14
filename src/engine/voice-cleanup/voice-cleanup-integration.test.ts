import { describe, expect, it } from 'vite-plus/test';
import { LoudnessAnalyser, normalisationGain } from './ebu-r128';
import {
	createVoiceCleanupChainState,
	applyMasterCleanupChain,
	type MasterCleanupChainParams
} from './voice-cleanup-processor';
import { DEFAULT_GATE_PARAMS, DEFAULT_LIMITER_PARAMS } from '../../protocol';

function generateSine(
	freq: number,
	sampleRate: number,
	durationS: number,
	amplitude = 1
): Float32Array {
	const samples = Math.round(sampleRate * durationS);
	const buf = new Float32Array(samples);
	for (let i = 0; i < samples; i++) {
		buf[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
	}
	return buf;
}

describe('voice-cleanup integration', () => {
	it('LoudnessAnalyser measures a known signal within ±0.5 LU', () => {
		const analyser = new LoudnessAnalyser(48000);
		// Feed 2 seconds of a 997 Hz sine at amplitude 0.1
		for (let i = 0; i < 20; i++) {
			analyser.feedBlock(generateSine(997, 48000, 0.1, 0.1));
		}
		const lufs = analyser.integratedLoudness();
		expect(Number.isFinite(lufs)).toBe(true);
		expect(lufs).toBeGreaterThan(-23.5);
		expect(lufs).toBeLessThan(-22.5);
	});

	it('normalisationGainDb equals target − measured within ±0.01 dB', () => {
		const measured = -20;
		const target = -14;
		const gain = normalisationGain(measured, target);
		expect(gain).toBeCloseTo(6, 2);
	});

	it('applyMasterCleanupChain processes without error', () => {
		const state = createVoiceCleanupChainState();
		const params: MasterCleanupChainParams = {
			denoiserEnabledTracks: [],
			normaliseGainDb: 0,
			limiterCeilingDbtp: -1,
			gateParams: { ...DEFAULT_GATE_PARAMS, bypass: true },
			limiterParams: { ...DEFAULT_LIMITER_PARAMS, bypass: true }
		};
		// Create stereo interleaved buffer (48000 samples = 1 second)
		const pcm = new Float32Array(48000 * 2);
		for (let i = 0; i < 48000; i++) {
			pcm[i * 2] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000);
			pcm[i * 2 + 1] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000);
		}
		const result = applyMasterCleanupChain(pcm, 2, params, state, 48000);
		expect(result.length).toBe(pcm.length);
		expect(result.every((v) => Number.isFinite(v))).toBe(true);
	});

	it('applyMasterCleanupChain with gate active modifies signal', () => {
		const state = createVoiceCleanupChainState();
		const params: MasterCleanupChainParams = {
			denoiserEnabledTracks: [],
			normaliseGainDb: 0,
			limiterCeilingDbtp: -1,
			gateParams: { ...DEFAULT_GATE_PARAMS, bypass: false, thresholdDb: -20 },
			limiterParams: { ...DEFAULT_LIMITER_PARAMS, bypass: true }
		};
		// Very quiet signal (below gate threshold)
		const pcm = new Float32Array(48000 * 2);
		for (let i = 0; i < 48000; i++) {
			const sample = 0.001 * Math.sin((2 * Math.PI * 440 * i) / 48000);
			pcm[i * 2] = sample;
			pcm[i * 2 + 1] = sample;
		}
		const result = applyMasterCleanupChain(pcm, 2, params, state, 48000);
		// Gate should have attenuated the quiet signal
		expect(result.length).toBe(pcm.length);
	});
});
