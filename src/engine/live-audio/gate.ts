import type { GateParams } from '../../protocol';

export interface GateState {
	envelope: number;
	// Samples spent in the hold phase. Lives in state (not a process-local)
	// so holds longer than one 128-sample block survive block boundaries.
	holdCounter: number;
}

export function createGateState(): GateState {
	return { envelope: 0, holdCounter: 0 };
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

	// Clamp timing params: zero/negative values would push the one-pole
	// coefficients above 1 and make the envelope diverge to NaN/Infinity.
	const attackMs = Math.max(0.01, params.attackMs);
	const releaseMs = Math.max(0.01, params.releaseMs);
	const holdMs = Math.max(0, params.holdMs);

	const attackCoef = Math.exp(-1 / ((attackMs / 1000) * sampleRate));
	const holdSamples = Math.round((holdMs / 1000) * sampleRate);
	const releaseCoef = Math.exp(-1 / ((releaseMs / 1000) * sampleRate));
	const rangeLinear = Math.pow(10, params.rangeDb / 20);
	const thresholdLinear = Math.pow(10, params.thresholdDb / 20);

	for (let i = 0; i < input.length; i++) {
		const abs = Math.abs(input[i]);
		const target = abs > thresholdLinear ? 1 : rangeLinear;

		if (target > state.envelope) {
			// Attack
			state.envelope = attackCoef * state.envelope + (1 - attackCoef) * target;
			state.holdCounter = 0;
		} else if (state.holdCounter < holdSamples) {
			// Hold
			state.holdCounter++;
		} else {
			// Release
			state.envelope = releaseCoef * state.envelope + (1 - releaseCoef) * target;
		}

		output[i] = input[i] * state.envelope;
	}

	return output;
}
