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
import { RnnoiseRing, loadRnnoise } from './rnnoise-processor';

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

export async function ensureDenoiserRings(
	state: VoiceCleanupChainState,
	enabledTrackIds: readonly string[]
): Promise<void> {
	for (const [trackId, ring] of state.denoiserRings) {
		if (!enabledTrackIds.includes(trackId)) {
			ring.destroy();
			state.denoiserRings.delete(trackId);
		}
	}
	if (enabledTrackIds.length === 0) return;

	let rnnoise: Awaited<ReturnType<typeof loadRnnoise>>;
	try {
		rnnoise = await loadRnnoise();
	} catch (error) {
		console.warn('RNNoise unavailable; falling back to dry voice-cleanup export path:', error);
		for (const ring of state.denoiserRings.values()) {
			ring.destroy();
		}
		state.denoiserRings.clear();
		return;
	}
	for (const trackId of enabledTrackIds) {
		if (!state.denoiserRings.has(trackId)) {
			state.denoiserRings.set(trackId, new RnnoiseRing(rnnoise.createInstance()));
		}
	}
}

export function destroyVoiceCleanupChainState(state: VoiceCleanupChainState): void {
	for (const ring of state.denoiserRings.values()) {
		ring.destroy();
	}
	state.denoiserRings.clear();
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

export function denoiseInterleavedTrackPcm(
	trackId: string,
	pcm: Float32Array,
	channels: number,
	state: VoiceCleanupChainState
): void {
	const ring = state.denoiserRings.get(trackId);
	if (!ring || channels <= 0) return;

	const frames = Math.floor(pcm.length / channels);
	const mono = new Float32Array(frames);
	for (let frame = 0; frame < frames; frame += 1) {
		let sum = 0;
		const base = frame * channels;
		for (let channel = 0; channel < channels; channel += 1) {
			sum += pcm[base + channel] ?? 0;
		}
		mono[frame] = sum / channels;
	}

	const denoised = ring.push(mono);
	for (let frame = 0; frame < frames; frame += 1) {
		const denoisedMono = denoised[frame] ?? 0;
		const dryMono = mono[frame] ?? 0;
		const base = frame * channels;
		let absSum = 0;
		for (let channel = 0; channel < channels; channel += 1) {
			absSum += Math.abs(pcm[base + channel] ?? 0);
		}
		if (Math.abs(dryMono) <= 1e-9 && absSum > 1e-9) {
			// A mid-only RNNoise pass has no speech signal for side-only/anti-phase frames.
			// Preserve the dry channels instead of collapsing valid stereo content to silence.
			continue;
		}
		for (let channel = 0; channel < channels; channel += 1) {
			const drySample = pcm[base + channel] ?? 0;
			const ratio =
				Math.abs(dryMono) > 1e-9 ? drySample / dryMono : absSum > 1e-9 ? drySample / absSum : 0;
			pcm[base + channel] = denoisedMono * ratio;
		}
	}
}

export interface MasterCleanupChainParams {
	denoiserEnabledTracks: string[];
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
