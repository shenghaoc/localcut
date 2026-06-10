import { describe, expect, it } from 'vitest';
import {
	anyInsertActive,
	chainLatencyS,
	createLiveChainProcessor,
	LIMITER_LOOKAHEAD_S,
	writeChainParamsToSab
} from './live-chain';
import {
	DEFAULT_LIVE_AUDIO_CHAIN_CONFIG,
	LIVE_CHAIN_TOTAL_FIELDS,
	LiveChainMeterIndex,
	type LiveAudioChainConfig
} from '../../protocol';

const SR = 48_000;

function config(overrides: Partial<LiveAudioChainConfig> = {}): LiveAudioChainConfig {
	return {
		gate: { ...DEFAULT_LIVE_AUDIO_CHAIN_CONFIG.gate },
		compressor: { ...DEFAULT_LIVE_AUDIO_CHAIN_CONFIG.compressor },
		limiter: { ...DEFAULT_LIVE_AUDIO_CHAIN_CONFIG.limiter },
		denoiserBypass: true,
		printToRecording: false,
		...overrides
	};
}

describe('live chain helpers', () => {
	it('anyInsertActive reflects per-insert bypass flags', () => {
		expect(anyInsertActive(config())).toBe(false);
		expect(
			anyInsertActive(config({ limiter: { bypass: false, ceilingDb: -1, attackUs: 100, releaseMs: 50 } }))
		).toBe(true);
	});

	it('chainLatencyS reports the limiter lookahead only when the limiter is active', () => {
		expect(chainLatencyS(config())).toBe(0);
		expect(
			chainLatencyS(config({ limiter: { bypass: false, ceilingDb: -1, attackUs: 100, releaseMs: 50 } }))
		).toBe(LIMITER_LOOKAHEAD_S);
	});

	it('writeChainParamsToSab writes every field within the layout bounds', () => {
		const sab = new Float32Array(LIVE_CHAIN_TOTAL_FIELDS);
		writeChainParamsToSab(sab, config());
		expect(sab[LiveChainMeterIndex.GATE_BYPASS]).toBe(1);
		expect(sab[LiveChainMeterIndex.GATE_THRESHOLD]).toBe(
			DEFAULT_LIVE_AUDIO_CHAIN_CONFIG.gate.thresholdDb
		);
		expect(sab[LiveChainMeterIndex.LIMITER_RELEASE]).toBe(
			DEFAULT_LIVE_AUDIO_CHAIN_CONFIG.limiter.releaseMs
		);
		expect(sab[LiveChainMeterIndex.DENOISER_BYPASS]).toBe(1);
		expect(Math.max(...(Object.values(LiveChainMeterIndex) as number[]))).toBeLessThan(
			LIVE_CHAIN_TOTAL_FIELDS
		);
	});
});

describe('live chain processor (print-to-recording path)', () => {
	it('is a clean identity when every insert is bypassed', () => {
		const processor = createLiveChainProcessor(config(), SR);
		const left = new Float32Array([0.5, -0.25, 0.9, 0]);
		const right = new Float32Array([0.1, 0.2, -0.3, 0.4]);
		const [outL, outR] = processor.process([left, right]);
		expect([...outL]).toEqual([...left]);
		expect([...outR]).toEqual([...right]);
	});

	it('limits hot input to the ceiling when the limiter is engaged', () => {
		const processor = createLiveChainProcessor(
			config({ limiter: { bypass: false, ceilingDb: -6, attackUs: 50, releaseMs: 50 } }),
			SR
		);
		const block = new Float32Array(SR).fill(1);
		const [out] = processor.process([block]);
		const ceiling = Math.pow(10, -6 / 20);
		for (let i = 2000; i < out.length; i++) {
			expect(Math.abs(out[i])).toBeLessThanOrEqual(ceiling * 1.02);
		}
	});

	it('keeps independent state per channel', () => {
		const processor = createLiveChainProcessor(
			config({ limiter: { bypass: false, ceilingDb: -6, attackUs: 50, releaseMs: 500 } }),
			SR
		);
		const hot = new Float32Array(4800).fill(1);
		const quiet = new Float32Array(4800).fill(0.1);
		const [outHot, outQuiet] = processor.process([hot, quiet]);
		// The quiet channel must not inherit the hot channel's gain reduction.
		expect(Math.abs(outQuiet[4000])).toBeGreaterThan(0.09);
		expect(Math.abs(outHot[4000])).toBeLessThan(0.6);
	});

	it('setConfig swaps parameters and resets envelopes', () => {
		const processor = createLiveChainProcessor(config(), SR);
		const block = new Float32Array(256).fill(0.8);
		const [bypassed] = processor.process([block]);
		expect([...bypassed]).toEqual([...block]);
		processor.setConfig(
			config({ limiter: { bypass: false, ceilingDb: -12, attackUs: 50, releaseMs: 50 } })
		);
		const [limited] = processor.process([new Float32Array(SR).fill(0.8)]);
		expect(Math.abs(limited[SR - 1])).toBeLessThan(0.3);
	});
});
