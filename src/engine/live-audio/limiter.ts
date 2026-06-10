import type { LimiterParams } from '../../protocol';

export interface LimiterState {
	envelope: number;
	delayLine: Float32Array;
	delayWritePos: number;
}

export function createLimiterState(lookaheadSamples?: number): LimiterState {
	const delayLen = lookaheadSamples ?? Math.round(0.005 * 48000); // 5 ms default
	return { envelope: 1, delayLine: new Float32Array(delayLen), delayWritePos: 0 };
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
	const delayLen = state.delayLine.length;

	for (let i = 0; i < input.length; i++) {
		state.delayLine[state.delayWritePos] = input[i];

		let peak = 0;
		for (let j = 0; j < delayLen; j++) {
			const v = Math.abs(state.delayLine[j]);
			if (v > peak) peak = v;
		}

		const targetGain = peak > ceilingLinear ? ceilingLinear / peak : 1;

		if (targetGain < state.envelope) {
			state.envelope = attackCoef * state.envelope + (1 - attackCoef) * targetGain;
		} else {
			state.envelope = releaseCoef * state.envelope + (1 - releaseCoef) * targetGain;
		}

		const readPos = (state.delayWritePos + 1) % delayLen;
		output[i] = state.delayLine[readPos] * state.envelope;

		state.delayWritePos = readPos;
	}

	return output;
}
