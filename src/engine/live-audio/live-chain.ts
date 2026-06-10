import type { LiveAudioChainConfig } from '../../protocol';
import {
	LiveChainMeterIndex,
	DEFAULT_LIVE_AUDIO_CHAIN_CONFIG,
} from '../../protocol';

export { LiveChainMeterIndex, DEFAULT_LIVE_AUDIO_CHAIN_CONFIG };

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
