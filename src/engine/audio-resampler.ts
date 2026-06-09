/**
 * Polyphase sinc audio resampler — converts between arbitrary sample rates
 * (e.g. 44100 ↔ 48000) with Kaiser-windowed interpolation.
 *
 * Used to fill Mediabunny's missing resampling capability so mixed-rate
 * timelines can export and play without errors.
 */

const DEFAULT_FILTER_SIZE = 16;
const KAISER_BETA = 6.0;

function besselI0(x: number): number {
	let sum = 1.0;
	let term = 1.0;
	const halfX = x * 0.5;
	for (let k = 1; k <= 20; k++) {
		term *= (halfX / k) * (halfX / k);
		sum += term;
		if (term < sum * 1e-16) break;
	}
	return sum;
}

function kaiserWindow(n: number, size: number, beta: number): number {
	const center = (size - 1) * 0.5;
	const ratio = (n - center) / center;
	const arg = 1.0 - ratio * ratio;
	if (arg <= 0) return 0;
	return besselI0(beta * Math.sqrt(arg)) / besselI0(beta);
}

function buildFilterTable(
	filterSize: number,
	tablePoints: number,
	beta: number,
	cutoff: number
): Float64Array {
	const table = new Float64Array(filterSize * tablePoints);
	const winTable = new Float64Array(filterSize);
	for (let tap = 0; tap < filterSize; tap++) {
		winTable[tap] = kaiserWindow(tap, filterSize, beta);
	}
	for (let phase = 0; phase < tablePoints; phase++) {
		const frac = phase / tablePoints;
		const rowStart = phase * filterSize;
		let rowSum = 0;
		for (let tap = 0; tap < filterSize; tap++) {
			const x = tap - (filterSize - 1) * 0.5 + frac;
			const scaled = cutoff * x;
			const sinc =
				Math.abs(scaled) < 1e-9 ? cutoff : (cutoff * Math.sin(Math.PI * scaled)) / (Math.PI * scaled);
			const value = sinc * winTable[tap]!;
			table[rowStart + tap] = value;
			rowSum += value;
		}
		if (rowSum !== 0) {
			for (let tap = 0; tap < filterSize; tap++) {
				table[rowStart + tap] /= rowSum;
			}
		}
	}
	return table;
}

export interface ResamplerConfig {
	inputRate: number;
	outputRate: number;
	channels: number;
	filterSize?: number;
}

export class AudioResampler {
	private readonly ratio: number;
	private readonly filterSize: number;
	private readonly channels: number;
	private readonly tablePoints: number;
	private readonly filterTable: Float64Array;
	private history: Float64Array;
	private historyFilled = 0;
	private inputFraction = 0;

	constructor(config: ResamplerConfig) {
		if (config.inputRate <= 0 || config.outputRate <= 0) {
			throw new Error('Sample rates must be positive.');
		}
		if (config.channels <= 0) {
			throw new Error('Channel count must be positive.');
		}
		this.ratio = config.inputRate / config.outputRate;
		this.channels = config.channels;
		this.filterSize = config.filterSize ?? DEFAULT_FILTER_SIZE;
		this.tablePoints = 512;
		const cutoff = Math.min(1, config.outputRate / config.inputRate);
		this.filterTable = buildFilterTable(this.filterSize, this.tablePoints, KAISER_BETA, cutoff);
		this.history = new Float64Array(this.filterSize * 2 * this.channels);
	}

	reset(): void {
		this.history.fill(0);
		this.historyFilled = 0;
		this.inputFraction = 0;
	}

	process(input: Float32Array, inputFrames: number): Float32Array {
		if (this.ratio === 1) {
			return input.slice(0, inputFrames * this.channels);
		}
		const ch = this.channels;
		const fs = this.filterSize;
		const halfFilter = (fs - 1) * 0.5;
		const halfFilterInt = Math.floor(halfFilter);

		const totalInputFrames = this.historyFilled + inputFrames;
		const combined = new Float64Array(totalInputFrames * ch);
		combined.set(this.history.subarray(0, this.historyFilled * ch));
		const copyLen = Math.min(input.length, inputFrames * ch);
		combined.set(input.subarray(0, copyLen), this.historyFilled * ch);

		const maxOutputFrames = Math.ceil(totalInputFrames / this.ratio) + 2;
		const outputs = new Float32Array(maxOutputFrames * ch);
		let writeIdx = 0;
		let srcPos = this.inputFraction;

		while (true) {
			const center = srcPos + halfFilter;
			const intCenter = Math.floor(center);
			if (intCenter - halfFilterInt + fs > totalInputFrames) break;
			const frac = center - intCenter;
			const phaseIdx = Math.min(
				Math.floor(frac * this.tablePoints),
				this.tablePoints - 1
			);
			const filterOffset = phaseIdx * fs;

			for (let c = 0; c < ch; c++) {
				let sum = 0;
				for (let tap = 0; tap < fs; tap++) {
					const sampleIdx = intCenter - halfFilterInt + tap;
					sum += combined[sampleIdx * ch + c]! * this.filterTable[filterOffset + tap]!;
				}
				outputs[writeIdx++] = sum;
			}
			srcPos += this.ratio;
		}

		const consumed = Math.floor(srcPos);
		this.inputFraction = srcPos - consumed;

		const keepFrames = Math.max(0, totalInputFrames - consumed);
		if (keepFrames > 0) {
			const needed = keepFrames * ch;
			if (this.history.length < needed) {
				this.history = new Float64Array(needed);
			}
			const srcOffset = (totalInputFrames - keepFrames) * ch;
			this.history.set(combined.subarray(srcOffset, srcOffset + needed));
		}
		this.historyFilled = keepFrames;

		return outputs.subarray(0, writeIdx);
	}

	flush(): Float32Array {
		if (this.ratio === 1) return new Float32Array(0);
		const padding = new Float32Array(this.filterSize * this.channels);
		return this.process(padding, this.filterSize);
	}
}

export function resampleBlock(
	input: Float32Array,
	inputFrames: number,
	inputRate: number,
	outputRate: number,
	channels: number
): Float32Array {
	if (inputRate === outputRate) return input.slice(0, inputFrames * channels);
	const resampler = new AudioResampler({ inputRate, outputRate, channels });
	const main = resampler.process(input, inputFrames);
	const tail = resampler.flush();
	const expectedFrames = Math.round((inputFrames * outputRate) / inputRate);
	const totalFrames = Math.min(main.length / channels + tail.length / channels, expectedFrames);
	const out = new Float32Array(totalFrames * channels);
	out.set(main.subarray(0, Math.min(main.length, out.length)));
	if (main.length < out.length) {
		out.set(tail.subarray(0, out.length - main.length), main.length);
	}
	return out;
}
