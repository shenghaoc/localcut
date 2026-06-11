/**
 * Voice cleanup export chain processor.
 *
 * Decoupled architecture (review fix):
 *   - Per-track denoising runs BEFORE track summation (on each track's mono PCM)
 *   - Master-bus inserts (gate, normalisation gain, limiter) run AFTER summation
 *
 * The denoiser MUST NOT run on the summed master — RNNoise treats non-speech
 * audio (music, SFX) as noise and would aggressively suppress it.
 */

import type { GateParams, LimiterParams } from '../../protocol';
import { processGate, type GateState, createGateState } from '../live-audio/gate';
import { processLimiter, type LimiterState, createLimiterState } from '../live-audio/limiter';
import { applyMasterAndClamp } from '../audio-mix';
import type { RnnoiseRing } from './rnnoise-processor';

export interface VoiceCleanupChainState {
	denoiserRings: Map<string, RnnoiseRing>; // keyed by trackId
	gateState: GateState;
	limiterState: LimiterState;
}

export function createVoiceCleanupChainState(): VoiceCleanupChainState {
	return {
		denoiserRings: new Map(),
		gateState: createGateState(),
		limiterState: createLimiterState()
	};
}

/**
 * Denoise a single track's mono PCM in place. Called per-track BEFORE
 * track summation in mixAudioWindow. Uses the per-track RnnoiseRing.
 * No-op if the track is not in denoiserEnabledTracks or if no ring exists.
 */
export function denoiseTrackPcm(
	trackId: string,
	monoPcm: Float32Array,
	state: VoiceCleanupChainState
): void {
	const ring = state.denoiserRings.get(trackId);
	if (!ring) return; // denoiser not enabled for this track

	// push() now returns exactly monoPcm.length samples (rate-matched I/O)
	const denoised = ring.push(monoPcm);
	monoPcm.set(denoised);
}

export interface MasterCleanupChainParams {
	normaliseGainDb: number;
	limiterCeilingDbtp: number;
	gateParams: GateParams;
	limiterParams: LimiterParams;
}

/**
 * Apply master-bus inserts to the summed stereo interleaved buffer:
 * gate → normalisation gain → limiter.
 * Called AFTER all tracks have been summed. Returns the processed buffer
 * (may be a new allocation from processGate/processLimiter).
 */
export function applyMasterCleanupChain(
	pcm: Float32Array,
	_channels: number,
	params: MasterCleanupChainParams,
	state: VoiceCleanupChainState,
	sampleRate: number
): Float32Array {
	// Gate insert (handles bypass internally via params.bypass)
	let buf = processGate(pcm, params.gateParams, state.gateState, sampleRate);

	// Normalisation gain
	if (params.normaliseGainDb !== 0) {
		const gainFactor = Math.pow(10, params.normaliseGainDb / 20);
		buf = applyMasterAndClamp(buf, gainFactor);
	}

	// Limiter insert (handles bypass internally via params.bypass)
	const limiterParams = { ...params.limiterParams, ceilingDb: params.limiterCeilingDbtp };
	buf = processLimiter(buf, limiterParams, state.limiterState, sampleRate);

	return buf;
}
