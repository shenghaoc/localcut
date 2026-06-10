import type { LimiterParams } from '../../protocol';

export interface LimiterState {
	envelope: number;
	delayLine: Float32Array;
	delayWritePos: number;
	// Monotonic deque over the delay-line window (sliding-window maximum).
	// Values decrease from head to tail; positions are absolute sample indices.
	// Gives O(1) amortized peak lookup per sample instead of an O(delayLen)
	// scan, which matters inside the 128-sample AudioWorklet/encode budget.
	dequePos: Float64Array;
	dequeVal: Float32Array;
	dequeHead: number;
	dequeTail: number;
	sampleIndex: number;
}

export function createLimiterState(lookaheadSamples?: number): LimiterState {
	const delayLen = Math.max(1, Math.round(lookaheadSamples ?? 0.005 * 48000)); // 5 ms at 48 kHz default
	return {
		envelope: 1,
		delayLine: new Float32Array(delayLen),
		delayWritePos: 0,
		dequePos: new Float64Array(delayLen + 1),
		dequeVal: new Float32Array(delayLen + 1),
		dequeHead: 0,
		dequeTail: 0,
		sampleIndex: 0
	};
}

export function processLimiter(
	input: Float32Array,
	params: LimiterParams,
	state: LimiterState,
	sampleRate: number
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
	const dequeCap = state.dequePos.length;

	for (let i = 0; i < input.length; i++) {
		const n = state.sampleIndex++;
		state.delayLine[state.delayWritePos] = input[i];

		// Sliding-window maximum over the last delayLen samples (the delayed
		// sample plus everything "ahead" of it in the lookahead window).
		const v = Math.abs(input[i]);
		while (state.dequeHead !== state.dequeTail) {
			const backIdx = (state.dequeTail - 1 + dequeCap) % dequeCap;
			if (state.dequeVal[backIdx] <= v) state.dequeTail = backIdx;
			else break;
		}
		state.dequePos[state.dequeTail] = n;
		state.dequeVal[state.dequeTail] = v;
		state.dequeTail = (state.dequeTail + 1) % dequeCap;
		while (state.dequePos[state.dequeHead] <= n - delayLen) {
			state.dequeHead = (state.dequeHead + 1) % dequeCap;
		}
		const peak = state.dequeVal[state.dequeHead];

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
