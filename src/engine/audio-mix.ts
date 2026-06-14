/** Shared per-sample audio mix stage — preview and export consume the same math. */

import { clamp01 } from '../lib/math';

export interface MixStageParams {
	gain: number;
	pan: number;
	fadeInS: number;
	fadeOutS: number;
	clipOffsetS: number;
	clipDurationS: number;
	sampleRate: number;
}

export interface AudioTransitionCut {
	trackId: string;
	fromClipId: string;
	toClipId: string;
	durationS: number;
}

export interface ResolvedAudioTransition {
	outgoingClipId: string;
	incomingClipId: string;
	mixT: number;
}

const MIN_CLIP_DURATION_S = 1e-6;

function clampPan(pan: number): number {
	return Math.max(-1, Math.min(1, pan));
}

/** Equal-power pan law: pan −1 (full left) … 0 (center) … +1 (full right). */
export function equalPowerPanLaw(pan: number): { left: number; right: number } {
	const x = (clampPan(pan) + 1) * 0.5;
	return {
		left: Math.cos(x * (Math.PI / 2)),
		right: Math.sin(x * (Math.PI / 2))
	};
}

/** Stereo balance pan: unity at center; hard-pans by attenuating the opposite channel. */
export function stereoBalancePanLaw(pan: number): { left: number; right: number } {
	const p = clampPan(pan);
	if (p <= 0) {
		return { left: 1, right: 1 + p };
	}
	return { left: 1 - p, right: 1 };
}

/** Mono output ignores pan; stereo tracks use balance panning. */
export function panCoefficients(pan: number, channels: number): { left: number; right: number } {
	if (channels <= 1) {
		return { left: 1, right: 1 };
	}
	return stereoBalancePanLaw(pan);
}

/** Equal-power crossfade gains for transition mixT ∈ [0, 1]. */
export function equalPowerCrossfadeGains(mixT: number): { outgoing: number; incoming: number } {
	const t = clamp01(mixT);
	return {
		outgoing: Math.cos(t * (Math.PI / 2)),
		incoming: Math.sin(t * (Math.PI / 2))
	};
}

/** Sample-accurate fade envelope from clip-relative position. */
export function computeClipFadeGain(
	clipOffsetS: number,
	clipDurationS: number,
	fadeInS: number,
	fadeOutS: number
): number {
	if (clipDurationS <= MIN_CLIP_DURATION_S) return 0;
	const inGain = fadeInS > 0 ? clamp01(clipOffsetS / fadeInS) : 1;
	const remaining = clipDurationS - clipOffsetS;
	const outGain = fadeOutS > 0 ? clamp01(remaining / fadeOutS) : 1;
	return inGain * outGain;
}

function frameFadeGain(params: MixStageParams, frameIndex: number): number {
	const clipOffsetS = params.clipOffsetS + frameIndex / params.sampleRate;
	return computeClipFadeGain(clipOffsetS, params.clipDurationS, params.fadeInS, params.fadeOutS);
}

/**
 * Applies gain, equal-power pan, and per-frame fade envelope to interleaved PCM.
 * Mono sources spread into the stereo field; stereo tracks use balance panning.
 */
export function applyMixStage(
	pcm: Float32Array,
	channels: number,
	params: MixStageParams
): Float32Array {
	const out = pcm.slice();
	applyMixStageInPlace(out, channels, params);
	return out;
}

export function applyMixStageInPlace(
	pcm: Float32Array,
	channels: number,
	params: MixStageParams
): void {
	const ch = Math.max(1, channels);
	const frames = Math.floor(pcm.length / ch);
	if (frames <= 0) return;

	const { left, right } = panCoefficients(params.pan, ch);
	const gain = params.gain;

	for (let frame = 0; frame < frames; frame += 1) {
		const fade = frameFadeGain(params, frame);
		const scale = gain * fade;
		const src = frame * ch;

		if (ch === 1) {
			pcm[src] = (pcm[src] ?? 0) * scale;
			continue;
		}

		const inL = pcm[src] ?? 0;
		const inR = pcm[src + 1] ?? inL;
		pcm[src] = inL * left * scale;
		pcm[src + 1] = inR * right * scale;
	}
}

/** Accumulates mixed track PCM into an output buffer (same channel layout). */
export function accumulateMix(out: Float32Array, mixed: Float32Array, offsetSamples = 0): void {
	const limit = Math.min(out.length - offsetSamples, mixed.length);
	for (let i = 0; i < limit; i += 1) {
		out[offsetSamples + i] = (out[offsetSamples + i] ?? 0) + (mixed[i] ?? 0);
	}
}

/** Applies master gain and clamps every sample to ±1. */
export function applyMasterAndClamp(pcm: Float32Array, masterGain: number): Float32Array {
	const gain = Number.isFinite(masterGain) ? Math.max(0, masterGain) : 1;
	for (let i = 0; i < pcm.length; i += 1) {
		const scaled = (pcm[i] ?? 0) * gain;
		pcm[i] = Math.max(-1, Math.min(1, scaled));
	}
	return pcm;
}

export function resolveAudioTransitionAt(
	trackId: string,
	clips: ReadonlyArray<{ id: string; start: number; duration: number }>,
	transitions: readonly AudioTransitionCut[],
	timelineTime: number
): ResolvedAudioTransition | null {
	for (const transition of transitions) {
		if (transition.trackId !== trackId || transition.durationS <= 0) continue;
		const outgoing = clips.find((clip) => clip.id === transition.fromClipId);
		const incoming = clips.find((clip) => clip.id === transition.toClipId);
		if (!outgoing || !incoming) continue;

		const cutTime = outgoing.start + outgoing.duration;
		if (Math.abs(cutTime - incoming.start) > 1e-3) continue;

		const half = transition.durationS * 0.5;
		const windowStart = cutTime - half;
		const windowEnd = cutTime + half;
		if (timelineTime < windowStart || timelineTime >= windowEnd) continue;

		const mixT = (timelineTime - windowStart) / transition.durationS;
		return {
			outgoingClipId: outgoing.id,
			incomingClipId: incoming.id,
			mixT: clamp01(mixT)
		};
	}
	return null;
}
