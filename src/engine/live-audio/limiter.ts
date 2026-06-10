import type { LimiterParams } from '../../protocol';

export interface LimiterState {
	envelope: number;
}

export function createLimiterState(): LimiterState {
	return { envelope: 1 };
}

export function processLimiter(
	input: Float32Array,
	params: LimiterParams,
	state: LimiterState,
	sampleRate: number,
): Float32Array {
	const output = new Float32Array(input.length);
	if (params.bypass) {
		output.set(input);
		return output;
	}

	const ceilingLinear = Math.pow(10, params.ceilingDb / 20);
	const attackCoef = Math.exp(-1 / ((params.attackUs / 1_000_000) * sampleRate));
	const releaseCoef = Math.exp(-1 / ((params.releaseMs / 1000) * sampleRate));

	// Short lookahead: 5 ms
	const lookaheadSamples = Math.round(0.005 * sampleRate);

	for (let i = 0; i < input.length; i++) {
		// Lookahead: find peak in lookahead window
		let peak = Math.abs(input[i]);
		for (let j = 1; j <= lookaheadSamples && i + j < input.length; j++) {
			const v = Math.abs(input[i + j]);
			if (v > peak) peak = v;
		}

		const targetGain = peak > ceilingLinear ? ceilingLinear / peak : 1;

		if (targetGain < state.envelope) {
			state.envelope = attackCoef * state.envelope + (1 - attackCoef) * targetGain;
		} else {
			state.envelope = releaseCoef * state.envelope + (1 - releaseCoef) * targetGain;
		}

		output[i] = input[i] * state.envelope;
	}

	return output;
}
