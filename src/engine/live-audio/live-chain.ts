import type { LiveAudioChainConfig } from '../../protocol';
import {
	LiveChainMeterIndex,
	DEFAULT_LIVE_AUDIO_CHAIN_CONFIG,
} from '../../protocol';
import { createGateState, processGate, type GateState } from './gate';
import { createCompressorState, processCompressor, type CompressorState } from './compressor';
import { createLimiterState, processLimiter, type LimiterState } from './limiter';

export { LiveChainMeterIndex, DEFAULT_LIVE_AUDIO_CHAIN_CONFIG };

/** Limiter lookahead used by the chain (seconds). */
export const LIMITER_LOOKAHEAD_S = 0.005;

/**
 * Writes chain parameters into the (future) monitor-worklet SAB.
 *
 * Concurrency note: these are plain sequential Float32Array stores into a
 * SharedArrayBuffer with no fence, so a reader may observe a mix of old and
 * new values within one block. Aligned 32-bit stores are individually atomic
 * on the platforms we target, and each parameter is independently valid, so a
 * torn *set* only means one block renders with a partially-applied config.
 * If a future consumer needs a consistent snapshot, switch to a seqlock or
 * double-buffered layout rather than per-field Atomics.
 */
export function writeChainParamsToSab(
	sab: Float32Array,
	config: LiveAudioChainConfig,
): void {
	sab[LiveChainMeterIndex.GATE_BYPASS] = config.gate.bypass ? 1 : 0;
	sab[LiveChainMeterIndex.GATE_THRESHOLD] = config.gate.thresholdDb;
	sab[LiveChainMeterIndex.GATE_RANGE] = config.gate.rangeDb;
	sab[LiveChainMeterIndex.GATE_ATTACK] = config.gate.attackMs;
	sab[LiveChainMeterIndex.GATE_HOLD] = config.gate.holdMs;
	sab[LiveChainMeterIndex.GATE_RELEASE] = config.gate.releaseMs;

	sab[LiveChainMeterIndex.COMP_BYPASS] = config.compressor.bypass ? 1 : 0;
	sab[LiveChainMeterIndex.COMP_THRESHOLD] = config.compressor.thresholdDb;
	sab[LiveChainMeterIndex.COMP_RATIO] = config.compressor.ratio;
	sab[LiveChainMeterIndex.COMP_ATTACK] = config.compressor.attackMs;
	sab[LiveChainMeterIndex.COMP_RELEASE] = config.compressor.releaseMs;
	sab[LiveChainMeterIndex.COMP_KNEE] = config.compressor.kneeDb;
	sab[LiveChainMeterIndex.COMP_MAKEUP] = config.compressor.makeupGainDb;

	sab[LiveChainMeterIndex.LIMITER_BYPASS] = config.limiter.bypass ? 1 : 0;
	sab[LiveChainMeterIndex.LIMITER_CEILING] = config.limiter.ceilingDb;
	sab[LiveChainMeterIndex.LIMITER_ATTACK] = config.limiter.attackUs;
	sab[LiveChainMeterIndex.LIMITER_RELEASE] = config.limiter.releaseMs;

	sab[LiveChainMeterIndex.DENOISER_BYPASS] = config.denoiserBypass ? 1 : 0;
}

export function anyInsertActive(config: LiveAudioChainConfig): boolean {
	return !config.gate.bypass || !config.compressor.bypass || !config.limiter.bypass;
}

/** Chain processing latency in seconds for the given config (limiter lookahead). */
export function chainLatencyS(config: LiveAudioChainConfig): number {
	return config.limiter.bypass ? 0 : LIMITER_LOOKAHEAD_S;
}

interface ChannelStates {
	gate: GateState;
	compressor: CompressorState;
	limiter: LimiterState;
}

/**
 * Per-channel gate → compressor → limiter processor for the print-to-recording
 * path: the pipeline worker runs this on capture PCM before encoding, so the
 * recording chain never depends on the monitor AudioContext being resumed.
 * Channels are processed independently (no stereo gain linking in v1).
 */
export interface LiveChainProcessor {
	process(channels: Float32Array[]): Float32Array[];
	/** Replace the config; envelopes/delay lines reset so stale state can't leak. */
	setConfig(config: LiveAudioChainConfig): void;
	readonly sampleRate: number;
}

export function createLiveChainProcessor(
	initialConfig: LiveAudioChainConfig,
	sampleRate: number,
): LiveChainProcessor {
	let config = initialConfig;
	let states: ChannelStates[] = [];

	function stateFor(channel: number): ChannelStates {
		while (states.length <= channel) {
			states.push({
				gate: createGateState(),
				compressor: createCompressorState(),
				limiter: createLimiterState(LIMITER_LOOKAHEAD_S * sampleRate),
			});
		}
		return states[channel];
	}

	return {
		sampleRate,
		setConfig(next: LiveAudioChainConfig): void {
			config = next;
			states = [];
		},
		process(channels: Float32Array[]): Float32Array[] {
			return channels.map((samples, c) => {
				const s = stateFor(c);
				const gated = processGate(samples, config.gate, s.gate, sampleRate);
				const compressed = processCompressor(gated, config.compressor, s.compressor, sampleRate);
				return processLimiter(compressed, config.limiter, s.limiter, sampleRate);
			});
		},
	};
}
