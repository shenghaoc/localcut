/**
 * WASM SIMD-accelerated beat analysis.
 *
 * Wraps a hand-written WAT->WASM module that uses wasm-simd128 intrinsics
 * for the 1024-point FFT butterfly hot path. Falls back transparently to
 * the pure-JS implementation when WASM or SIMD is unavailable.
 *
 * The WASM module handles: Hann windowing, FFT, magnitude computation.
 * Spectral flux and the rest of the DSP pipeline run in JS.
 */

import { BEAT_ANALYSIS_WASM_B64 } from './beat-analysis-simd-wasm-b64';

// ---------------------------------------------------------------------------
// SIMD feature detection
// ---------------------------------------------------------------------------

const SIMD_TEST_BYTES = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 22, 1, 20, 0, 253, 12, 0, 0,
	0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 11
]);

// Memory layout constants (must match beat-analysis-simd.wat)
const HANN_PTR = 0; // 0x0000, 1024 * 4 = 4096 bytes
const COS_PTR = 4096; // 0x1000, 512 * 4 = 2048 bytes
const SIN_PTR = 6144; // 0x1800, 512 * 4 = 2048 bytes
const RE_PTR = 8192; // 0x2000, 1024 * 4 = 4096 bytes (magnitudes output at [0..512])
const IN_BUF = 20480; // 0x5000, 1024 * 4 = 4096 bytes (input samples)
const FFT_N = 1024;
const HALF_N = 512;
const MAG_LEN = 513;

let wasmAvailable = false;
let wasmModule: WebAssembly.Module | null = null;
let initCalled = false;
let initPromise: Promise<void> | null = null;

async function detectAndCompile(): Promise<void> {
	if (typeof WebAssembly === 'undefined') return;

	try {
		let simdOk = false;
		try {
			simdOk = WebAssembly.validate(SIMD_TEST_BYTES);
		} catch {
			simdOk = false;
		}
		if (!simdOk) return;

		const binaryString = atob(BEAT_ANALYSIS_WASM_B64);
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

function buildHannTableF32(): Float32Array {
	const table = new Float32Array(FFT_N);
	for (let n = 0; n < FFT_N; n++) {
		table[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (FFT_N - 1)));
	}
	return table;
}

function buildTwiddleTablesF32(): { cos: Float32Array; sin: Float32Array } {
	const cos = new Float32Array(HALF_N);
	const sin = new Float32Array(HALF_N);
	for (let k = 0; k < HALF_N; k++) {
		const angle = (2 * Math.PI * k) / FFT_N;
		cos[k] = Math.cos(angle);
		sin[k] = -Math.sin(angle); // negative for forward FFT
	}
	return { cos, sin };
}

export class WasmBeatAnalyser {
	private instance: WebAssembly.Instance | null = null;
	private memory: WebAssembly.Memory | null = null;
	readonly usedWasm: boolean;

	static async init(): Promise<void> {
		if (initCalled) return initPromise!;
		initCalled = true;
		initPromise = detectAndCompile();
		return initPromise;
	}

	constructor() {
		if (wasmAvailable && wasmModule) {
			try {
				const instance = new WebAssembly.Instance(wasmModule, {});
				this.instance = instance;
				this.memory = instance.exports.memory as WebAssembly.Memory;

				// Pre-compute and write tables into WASM memory
				const hann = buildHannTableF32();
				const { cos, sin } = buildTwiddleTablesF32();

				const memView = new Float32Array(this.memory.buffer);
				memView.set(hann, HANN_PTR / 4);
				memView.set(cos, COS_PTR / 4);
				memView.set(sin, SIN_PTR / 4);

				this.usedWasm = true;
			} catch {
				this.instance = null;
				this.memory = null;
				this.usedWasm = false;
			}
		} else {
			this.usedWasm = false;
		}
	}

	/**
	 * Process one 1024-sample windowed frame.
	 * Returns 513 magnitude bins (the spectral flux is computed in JS).
	 * Returns null if WASM processing fails.
	 */
	processFrame(samples: Float32Array): Float32Array | null {
		if (!this.instance || !this.memory) return null;

		try {
			const exports = this.instance.exports as {
				hann_fft(ptr: number): void;
				memory: WebAssembly.Memory;
			};
			const memFloat32 = new Float32Array(this.memory.buffer);

			// Copy input samples into the dedicated input buffer
			memFloat32.set(samples, IN_BUF / 4);

			// Call WASM: applies Hann, runs FFT, writes magnitudes to RE_PTR[0..512]
			exports.hann_fft(IN_BUF);

			// Read magnitudes back
			const magnitudes = new Float32Array(MAG_LEN);
			magnitudes.set(memFloat32.subarray(RE_PTR / 4, RE_PTR / 4 + MAG_LEN));
			return magnitudes;
		} catch {
			return null;
		}
	}
}
