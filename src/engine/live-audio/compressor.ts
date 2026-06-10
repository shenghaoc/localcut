import type { CompressorParams } from '../../protocol';

export interface CompressorState {
	envelope: number;
}

export function createCompressorState(): CompressorState {
	return { envelope: 0 };
}

export function processCompressor(
	input: Float32Array,
	params: CompressorParams,
	state: CompressorState,
	sampleRate: number,
): Float32Array {
	const output = new Float32Array(input.length);
	if (params.bypass) {
		output.set(input);
		return output;
	}

	const attackCoef = Math.exp(-1 / ((params.attackMs / 1000) * sampleRate));
	const releaseCoef = Math.exp(-1 / ((params.releaseMs / 1000) * sampleRate));
	const thresholdLinear = Math.pow(10, params.thresholdDb / 20);
	const kneeHalf = params.kneeDb / 2;
	const makeupGainLinear = Math.pow(10, params.makeupGainDb / 20);

	for (let i = 0; i < input.length; i++) {
		const abs = Math.abs(input[i]);
		const db = abs > 0 ? 20 * Math.log10(abs) : -120;

		let gainReductionDb = 0;
		if (db > thresholdLinear + kneeHalf) {
			// Above knee — full compression
			gainReductionDb = (thresholdLinear - db) * (1 - 1 / params.ratio);
		} else if (db > thresholdLinear - kneeHalf) {
			// In knee — soft transition
			const above = db - (thresholdLinear - kneeHalf);
			gainReductionDb = ((above * above) / (2 * params.kneeDb)) * (1 - 1 / params.ratio);
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
