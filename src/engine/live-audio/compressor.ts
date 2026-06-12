import type { CompressorParams } from '../../protocol';

export interface CompressorState {
	envelope: number;
}

export function createCompressorState(): CompressorState {
	// The envelope is a smoothed linear *gain*, so it starts at unity; starting
	// at 0 would mute the first release-time worth of audio.
	return { envelope: 1 };
}

export function processCompressor(
	input: Float32Array,
	params: CompressorParams,
	state: CompressorState,
	sampleRate: number
): Float32Array {
	const output = new Float32Array(input.length);
	if (params.bypass) {
		output.set(input);
		return output;
	}

	// Clamp params to safe ranges: zero/negative attack/release would push the
	// one-pole coefficients above 1 (envelope divergence to NaN/Infinity),
	// ratio < 1 would amplify instead of compress, and a negative knee would
	// flip the knee-branch sign.
	const attackMs = Math.max(0.01, params.attackMs);
	const releaseMs = Math.max(0.01, params.releaseMs);
	const ratio = Math.max(1, params.ratio);
	const kneeDb = Math.max(0, params.kneeDb);

	const attackCoef = Math.exp(-1 / ((attackMs / 1000) * sampleRate));
	const releaseCoef = Math.exp(-1 / ((releaseMs / 1000) * sampleRate));
	const kneeHalf = kneeDb / 2;
	const makeupGainLinear = Math.pow(10, params.makeupGainDb / 20);

	for (let i = 0; i < input.length; i++) {
		const abs = Math.abs(input[i]);
		const db = abs > 0 ? 20 * Math.log10(abs) : -120;

		let gainReductionDb = 0;
		if (db > params.thresholdDb + kneeHalf) {
			gainReductionDb = (params.thresholdDb - db) * (1 - 1 / ratio);
		} else if (kneeDb > 0 && db > params.thresholdDb - kneeHalf) {
			const above = db - (params.thresholdDb - kneeHalf);
			gainReductionDb = -((above * above) / (2 * kneeDb)) * (1 - 1 / ratio);
		}

		const targetGain = Math.pow(10, gainReductionDb / 20);

		if (targetGain < state.envelope) {
			state.envelope = attackCoef * state.envelope + (1 - attackCoef) * targetGain;
		} else {
			state.envelope = releaseCoef * state.envelope + (1 - releaseCoef) * targetGain;
		}

		output[i] = input[i] * state.envelope * makeupGainLinear;
	}

	return output;
}
