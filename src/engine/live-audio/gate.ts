import type { GateParams } from '../../protocol';

export interface GateState {
	envelope: number;
}

export function createGateState(): GateState {
	return { envelope: 0 };
}

export function processGate(
	input: Float32Array,
	params: GateParams,
	state: GateState,
	sampleRate: number,
): Float32Array {
	const output = new Float32Array(input.length);
	if (params.bypass) {
		output.set(input);
		return output;
	}

	const attackCoef = Math.exp(-1 / ((params.attackMs / 1000) * sampleRate));
	const holdSamples = Math.round((params.holdMs / 1000) * sampleRate);
	const releaseCoef = Math.exp(-1 / ((params.releaseMs / 1000) * sampleRate));
	const rangeLinear = Math.pow(10, params.rangeDb / 20);
	const thresholdLinear = Math.pow(10, params.thresholdDb / 20);

	let holdCounter = 0;

	for (let i = 0; i < input.length; i++) {
		const abs = Math.abs(input[i]);
		const target = abs > thresholdLinear ? 1 : rangeLinear;

		if (target > state.envelope) {
			// Attack
			state.envelope = attackCoef * state.envelope + (1 - attackCoef) * target;
			holdCounter = 0;
		} else if (holdCounter < holdSamples) {
			// Hold
			holdCounter++;
		} else {
			// Release
			state.envelope = releaseCoef * state.envelope + (1 - releaseCoef) * target;
		}

		output[i] = input[i] * state.envelope;
	}

	return output;
}
