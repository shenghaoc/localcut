/**
 * EBU R128 / ITU-R BS.1770-4 integrated loudness analyser.
 *
 * Implements the gated loudness algorithm:
 *   1. Stream audio in non-overlapping 100 ms blocks.
 *   2. Apply K-weighting continuously (biquad state carries forward).
 *   3. Buffer K-weighted samples in a 400 ms ring per channel.
 *   4. After every 100 ms block, compute mean square over the full ring.
 *   5. Form window loudness l_i, apply absolute gate (−70 LUFS),
 *      relative gate (ungated − 10 LU), return integrated loudness.
 */

import { type KWeightState, createKWeightState, kWeightBlock } from './kweighting';

/** Stateful EBU R128 integrated loudness analyser. */
export class LoudnessAnalyser {
	private readonly windowSize: number; // samples per 400 ms window
	private kWeightStates: KWeightState[] = [];
	private ringBuffers: Float32Array[] = [];
	private ringWritePos = 0;
	private readonly windowLoudnesses: number[] = [];

	constructor(sampleRate: number) {
		this.windowSize = Math.round(sampleRate * 0.4); // 400 ms
	}

	/**
	 * Feed one non-overlapping block of audio (mono or stereo).
	 * The block should be 100 ms at the analyser's sampleRate.
	 * After feeding, one measurement window is ready for gating.
	 */
	feedBlock(leftOrMono: Float32Array, right?: Float32Array): void {
		const channels = right ? 2 : 1;
		const samples = leftOrMono.length;

		// Lazy-init per-channel state
		while (this.kWeightStates.length < channels) {
			this.kWeightStates.push(createKWeightState());
			this.ringBuffers.push(new Float32Array(this.windowSize));
		}

		// K-weight each channel in place (state carries across blocks)
		const leftWeighted = kWeightBlock(new Float32Array(leftOrMono), this.kWeightStates[0]);
		const rightWeighted = right
			? kWeightBlock(new Float32Array(right), this.kWeightStates[1])
			: undefined;

		// Write into ring buffer (overwrites oldest 100 ms)
		for (let i = 0; i < samples; i++) {
			const pos = (this.ringWritePos + i) % this.windowSize;
			this.ringBuffers[0][pos] = leftWeighted[i];
			if (rightWeighted) {
				this.ringBuffers[1][pos] = rightWeighted[i];
			}
		}
		this.ringWritePos = (this.ringWritePos + samples) % this.windowSize;

		// Compute mean square over the full 400 ms ring
		const ms0 = meanSquare(this.ringBuffers[0]);
		const ms1 = rightWeighted ? meanSquare(this.ringBuffers[1]) : 0;

		// Channel weights: 1.0 for L/R (stereo), 1.0 for mono
		const G_L = 1.0;
		const G_R = rightWeighted ? 1.0 : 0;
		const sumGms = G_L * ms0 + G_R * ms1;

		if (sumGms > 0) {
			const l_i = -0.691 + 10 * Math.log10(sumGms);
			this.windowLoudnesses.push(l_i);
		}
	}

	/**
	 * @deprecated Use feedBlock() with non-overlapping 100 ms blocks instead.
	 * Kept for backward compatibility with callers that pass full windows.
	 */
	feedWindow(leftOrMono: Float32Array, right?: Float32Array): void {
		this.feedBlock(leftOrMono, right);
	}

	/** Compute gated integrated loudness (LUFS) from all fed blocks. */
	integratedLoudness(): number {
		if (this.windowLoudnesses.length === 0) return -Infinity;

		// Absolute gate: discard windows below −70 LUFS
		const absSurvivors = this.windowLoudnesses.filter((l) => l >= -70);
		if (absSurvivors.length === 0) return -Infinity;

		// Compute ungated loudness from absolute-gate survivors
		let sum = 0;
		for (const l of absSurvivors) {
			sum += Math.pow(10, l / 10);
		}
		const L_KG = -0.691 + 10 * Math.log10(sum / absSurvivors.length);

		// Relative gate: discard windows below (ungated − 10 LU)
		const relSurvivors = absSurvivors.filter((l) => l >= L_KG - 10);
		if (relSurvivors.length === 0) return -Infinity;

		// Integrated loudness from doubly-gated windows
		let relSum = 0;
		for (const l of relSurvivors) {
			relSum += Math.pow(10, l / 10);
		}
		return -0.691 + 10 * Math.log10(relSum / relSurvivors.length);
	}

	/** Reset all accumulated state. */
	reset(): void {
		for (const s of this.kWeightStates) {
			Object.assign(s, createKWeightState());
		}
		for (const buf of this.ringBuffers) {
			buf.fill(0);
		}
		this.ringWritePos = 0;
		this.windowLoudnesses.length = 0;
	}
}

/** Compute mean square of a buffer. */
function meanSquare(buf: Float32Array): number {
	let sum = 0;
	for (let i = 0; i < buf.length; i++) {
		sum += buf[i] * buf[i];
	}
	return sum / buf.length;
}

/**
 * Compute makeup gain in dB to reach targetLufs from measuredLufs.
 * Clamped to +30 dB to prevent pathological corrections on near-silent signals.
 * Returns 0 when measuredLufs is −Infinity or non-finite.
 */
export function normalisationGain(measuredLufs: number, targetLufs: number): number {
	if (!Number.isFinite(measuredLufs) || measuredLufs === -Infinity) return 0;
	const gain = targetLufs - measuredLufs;
	return Math.min(gain, 30);
}
