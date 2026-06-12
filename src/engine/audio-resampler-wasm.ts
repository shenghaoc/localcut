/**
 * WASM SIMD-accelerated polyphase sinc audio resampler.
 *
 * Wraps a hand-written WAT→WASM module that uses wasm-simd128 intrinsics
 * for the 16-tap FIR convolution hot path. Falls back transparently to the
 * pure-JS AudioResampler when WASM or SIMD is unavailable.
 *
 * Usage:
 *   await WasmAudioResampler.init();  // async, call during startup
 *   const resampler = new WasmAudioResampler({ inputRate, outputRate, channels });
 *   const output = resampler.process(input, inputFrames);
 */

import { AudioResampler, type ResamplerConfig } from './audio-resampler';
import { WASM_SIMD_RESAMPLER_B64 } from './resampler-simd-wasm-b64';

// ---------------------------------------------------------------------------
// SIMD feature detection
// ---------------------------------------------------------------------------

/**
 * Tiny WASM module that uses a simd128 opcode (v128.const).
 * If the browser rejects this, SIMD is not available.
 */
const SIMD_TEST_BYTES = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 22, 1, 20, 0, 253, 12, 0, 0,
	0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 11
]);

let wasmAvailable = false;
let wasmModule: WebAssembly.Module | null = null;
let initCalled = false;
let initPromise: Promise<void> | null = null;

async function detectAndCompile(): Promise<void> {
	// Guard: WebAssembly may be undefined in SSR / older browsers
	if (typeof WebAssembly === 'undefined') {
		return;
	}

	try {
		// SIMD feature detection via WebAssembly.validate
		let simdOk = false;
		try {
			simdOk = WebAssembly.validate(SIMD_TEST_BYTES);
		} catch {
			simdOk = false;
		}
		if (!simdOk) {
			return;
		}

		// Decode base64 WASM binary
		const binaryString = atob(WASM_SIMD_RESAMPLER_B64);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}

		wasmModule = await WebAssembly.compile(bytes);
		wasmAvailable = true;
	} catch {
		wasmAvailable = false;
	}
}

// ---------------------------------------------------------------------------
// Wrapper class
// ---------------------------------------------------------------------------

const DEFAULT_FILTER_SIZE = 16;
const TABLE_POINTS = 512;
const KAISER_BETA = 6.0;
const WASM_PAGE_SIZE = 65536;

// Re-use the filter-table builder from audio-resampler.ts.
// We build a Float32Array version for the WASM module (f32 precision).
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

function buildFilterTableF32(
	filterSize: number,
	tablePoints: number,
	beta: number,
	cutoff: number
): Float32Array {
	const table = new Float32Array(filterSize * tablePoints);
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
				Math.abs(scaled) < 1e-9
					? cutoff
					: (cutoff * Math.sin(Math.PI * scaled)) / (Math.PI * scaled);
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

/** Typed view of the hand-written WAT module's exports (resampler-simd.wat). */
interface ResamplerWasmExports {
	memory: WebAssembly.Memory;
	historyFilled: WebAssembly.Global;
	init(
		filterTableOffset: number,
		filterSize: number,
		tablePoints: number,
		inputRate: number,
		outputRate: number,
		channels: number
	): void;
	reset(): void;
	process(inputOffset: number, inputFrames: number, outputOffset: number): number;
	flush(inputOffset: number, outputOffset: number): number;
}

export class WasmAudioResampler {
	// Static async init — call once during startup
	static async init(): Promise<void> {
		if (initCalled) return initPromise!;
		initCalled = true;
		initPromise = detectAndCompile();
		return initPromise;
	}

	static get isAvailable(): boolean {
		return wasmAvailable;
	}

	// Instance state
	private config: ResamplerConfig;
	private jsFallback: AudioResampler;
	private ratio: number;
	private channels: number;
	private filterSize: number;

	// WASM instance (null if using JS fallback)
	private instance: WebAssembly.Instance | null = null;
	private memory: WebAssembly.Memory | null = null;
	private usedFallback = false;

	// JS-side history buffer (samples are stored here, copied to WASM per call)
	private history: Float32Array;
	private historyFilled = 0;

	// WASM memory layout offsets
	private filterTableOffset = 0; // filter table starts at offset 0
	private workingOffset = 0; // working area for process() starts after filter table
	private outputOffset = 0;

	// Reusable combined buffer
	private combined: Float32Array | null = null;

	constructor(config: ResamplerConfig) {
		if (config.inputRate <= 0 || config.outputRate <= 0) {
			throw new Error('Sample rates must be positive.');
		}
		if (config.channels <= 0) {
			throw new Error('Channel count must be positive.');
		}

		this.config = config;
		this.ratio = config.inputRate / config.outputRate;
		this.channels = config.channels;
		this.filterSize = config.filterSize ?? DEFAULT_FILTER_SIZE;
		this.history = new Float32Array(this.filterSize * 2 * this.channels);

		// Always create JS fallback
		this.jsFallback = new AudioResampler(config);

		if (wasmAvailable) {
			this.initWasm(config);
		}
	}

	private initWasm(config: ResamplerConfig): void {
		if (!wasmModule) return;

		try {
			const instance = new WebAssembly.Instance(wasmModule, {});
			const exports = instance.exports as unknown as ResamplerWasmExports;
			this.instance = instance;
			this.memory = exports.memory;

			const filterSize = config.filterSize ?? DEFAULT_FILTER_SIZE;
			const tablePoints = TABLE_POINTS;
			const cutoff = Math.min(1, config.outputRate / config.inputRate);
			const filterTable = buildFilterTableF32(filterSize, tablePoints, KAISER_BETA, cutoff);

			// Ensure enough memory: filter table + working buffers
			const filterTableBytes = filterTable.length * 4;
			const workingBytes = (filterSize * 2 + 4096) * config.channels * 4 * 2;
			const totalNeeded = filterTableBytes + workingBytes;
			const pagesNeeded = Math.ceil(totalNeeded / WASM_PAGE_SIZE);
			if (this.memory!.buffer.byteLength < pagesNeeded * WASM_PAGE_SIZE) {
				this.memory!.grow(
					pagesNeeded - Math.floor(this.memory!.buffer.byteLength / WASM_PAGE_SIZE)
				);
			}

			// Copy filter table to WASM memory at offset 0
			const memView = new Float32Array(this.memory!.buffer);
			memView.set(filterTable, 0);
			this.filterTableOffset = 0;

			// Working area starts after filter table
			this.workingOffset = filterTableBytes;

			// Call WASM init
			exports.init(
				this.filterTableOffset,
				filterSize,
				tablePoints,
				config.inputRate,
				config.outputRate,
				config.channels
			);
		} catch (e) {
			console.warn('Failed to initialize WASM resampler, falling back to JS:', e);
			this.instance = null;
			this.memory = null;
		}
	}

	reset(): void {
		this.history.fill(0);
		this.historyFilled = 0;
		this.usedFallback = false;
		this.jsFallback.reset();
		if (this.instance) {
			const exports = this.instance.exports as unknown as ResamplerWasmExports;
			exports.reset();
		}
	}

	process(input: Float32Array, inputFrames: number): Float32Array {
		if (!this.instance || !this.memory) {
			// Lazy-init guard: handle race where WASM init completes
			// between construction and first process() call.
			if (wasmAvailable && !this.usedFallback) {
				this.initWasm(this.config);
			}
			if (!this.instance || !this.memory) {
				this.usedFallback = true;
				return this.jsFallback.process(input, inputFrames);
			}
			// initWasm succeeded — fall through to WASM path below
		}
		if (this.ratio === 1) {
			return input.slice(0, inputFrames * this.channels);
		}

		const ch = this.channels;

		// Build combined buffer: history + input
		const totalInputFrames = this.historyFilled + inputFrames;
		const combinedLen = totalInputFrames * ch;
		if (!this.combined || this.combined.length < combinedLen) {
			this.combined = new Float32Array(combinedLen);
		}
		const combined = this.combined;
		combined.set(this.history.subarray(0, this.historyFilled * ch));
		const copyLen = Math.min(input.length, inputFrames * ch);
		combined.set(input.subarray(0, copyLen), this.historyFilled * ch);
		if (this.historyFilled * ch + copyLen < combinedLen) {
			combined.fill(0, this.historyFilled * ch + copyLen, combinedLen);
		}

		try {
			// Grow WASM memory if needed. Place output after input (16-byte aligned).
			this.outputOffset = this.workingOffset + ((combinedLen * 4 + 15) & ~15);
			const maxOutputFrames = Math.ceil(totalInputFrames / this.ratio) + 2;
			const neededBytes = this.outputOffset + maxOutputFrames * ch * 4;
			const currentBytes = this.memory!.buffer.byteLength;
			if (neededBytes > currentBytes) {
				const extraPages = Math.ceil((neededBytes - currentBytes) / WASM_PAGE_SIZE);
				this.memory!.grow(extraPages);
			}

			// Copy combined buffer to WASM memory
			const memF32 = new Float32Array(this.memory!.buffer);
			memF32.set(combined.subarray(0, combinedLen), this.workingOffset / 4);

			// Call WASM process.
			// Contract: the combined buffer at workingOffset holds
			// (historyFilled + inputFrames) frames. The WASM side computes the
			// total from its own $historyFilled global, which must stay in sync
			// with JS this.historyFilled — JS reads the global back after every
			// call. A mismatch would silently corrupt the convolution window.
			const exports = this.instance.exports as unknown as ResamplerWasmExports;
			const outputFrames = exports.process(this.workingOffset, inputFrames, this.outputOffset);

			// Read output from WASM memory
			const outputSamples = outputFrames * ch;
			const output = new Float32Array(outputSamples);
			const outputStart = this.outputOffset / 4;
			output.set(memF32.subarray(outputStart, outputStart + outputSamples));

			// Read updated state from WASM globals
			this.historyFilled = exports.historyFilled.value as number;

			// Copy leftover history from the combined buffer.
			// totalInputFrames was calculated before historyFilled was overwritten
			// by the WASM call, so it still represents the correct combined size.
			const keepFrames = this.historyFilled;
			if (keepFrames > 0) {
				const needed = keepFrames * ch;
				if (this.history.length < needed) {
					this.history = new Float32Array(needed);
				}
				const srcOffset = (totalInputFrames - keepFrames) * ch;
				this.history.set(combined.subarray(srcOffset, srcOffset + needed));
			}

			return output;
		} catch (e) {
			console.warn('WASM process failed, falling back to JS:', e);
			this.instance = null;
			this.memory = null;
			// Stick to the JS path until reset() — re-initializing WASM
			// mid-stream would discard accumulated history and pop.
			this.usedFallback = true;
			return this.jsFallback.process(input, inputFrames);
		}
	}

	flush(): Float32Array {
		if (!this.instance || !this.memory) {
			// Lazy-init guard: handle race where WASM init completes
			// between construction and first flush() call.
			if (wasmAvailable && !this.usedFallback) {
				this.initWasm(this.config);
			}
			if (!this.instance || !this.memory) {
				this.usedFallback = true;
				return this.jsFallback.flush();
			}
			// initWasm succeeded — fall through to WASM path below
		}
		if (this.ratio === 1) return new Float32Array(0);

		const ch = this.channels;
		if (this.historyFilled === 0) return new Float32Array(0);

		try {
			// Build a combined buffer with just history + zero padding.
			// Dynamically position output after input to avoid overlap.
			const totalFrames = this.historyFilled + this.filterSize;
			const combinedLen = totalFrames * ch;
			this.outputOffset = this.workingOffset + ((combinedLen * 4 + 15) & ~15);
			const maxOutputFrames = Math.ceil(totalFrames / this.ratio) + 2;
			const neededBytes = this.outputOffset + maxOutputFrames * ch * 4;
			const currentBytes = this.memory!.buffer.byteLength;
			if (neededBytes > currentBytes) {
				const extraPages = Math.ceil((neededBytes - currentBytes) / WASM_PAGE_SIZE);
				this.memory!.grow(extraPages);
			}

			const memF32 = new Float32Array(this.memory!.buffer);
			// Copy history — WASM flush zeros the padding via memory.fill,
			// so no JS-side zeroing is needed.
			memF32.set(this.history.subarray(0, this.historyFilled * ch), this.workingOffset / 4);

			// Call WASM flush
			const exports = this.instance.exports as unknown as ResamplerWasmExports;
			const outputFrames = exports.flush(this.workingOffset, this.outputOffset);

			// Read output
			const outputSamples = outputFrames * ch;
			const output = new Float32Array(outputSamples);
			const outputStart = this.outputOffset / 4;
			output.set(memF32.subarray(outputStart, outputStart + outputSamples));

			// Read updated state from WASM globals
			const keepFrames = exports.historyFilled.value as number;
			this.historyFilled = keepFrames;

			// Copy leftover history from WASM memory back to JS history
			if (keepFrames > 0) {
				const needed = keepFrames * ch;
				if (this.history.length < needed) {
					this.history = new Float32Array(needed);
				}
				const srcOffset = this.workingOffset / 4 + (totalFrames - keepFrames) * ch;
				this.history.set(memF32.subarray(srcOffset, srcOffset + needed));
			}

			return output;
		} catch (e) {
			console.warn('WASM flush failed, falling back to JS:', e);
			this.instance = null;
			this.memory = null;
			// Stick to the JS path until reset() — re-initializing WASM
			// mid-stream would discard accumulated history and pop.
			this.usedFallback = true;
			return this.jsFallback.flush();
		}
	}
}

/**
 * Resample a single block using the WASM-accelerated path when available,
 * falling back to the JS AudioResampler otherwise.
 *
 * NOTE: This is a one-shot block resample that constructs a fresh resampler
 * per call — NOT for streaming use. For streaming, use `WasmAudioResampler`
 * directly: create one instance and call `process()` / `flush()` across
 * consecutive chunks so that history is preserved between calls.
 */
export function resampleBlockWasm(
	input: Float32Array,
	inputFrames: number,
	inputRate: number,
	outputRate: number,
	channels: number
): Float32Array {
	if (inputRate === outputRate) return input.slice(0, inputFrames * channels);
	const resampler = WasmAudioResampler.isAvailable
		? new WasmAudioResampler({ inputRate, outputRate, channels })
		: new AudioResampler({ inputRate, outputRate, channels });
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
