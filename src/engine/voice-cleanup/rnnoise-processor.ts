/**
 * RNNoise WASM processor and frame-adaptation ring.
 *
 * Loads the RNNoise WASM module from a checked-in public artifact,
 * verifies its SHA-256 checksum, and provides:
 *   - `loadRnnoise()` — lazy module loader with checksum verification
 *   - `RnnoiseInstance` — per-track WASM state wrapper
 *   - `RnnoiseRing` — 480-sample frame-adaptation ring buffer
 *
 * The WASM module processes audio at 48 kHz mono in 480-sample (10 ms) frames.
 */

const FRAME_SIZE = 480;

/** Error thrown when the WASM module fails to load or verify. */
export class RnnoiseLoadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RnnoiseLoadError';
	}
}

/** Wraps a single RNNoise WASM denoiser instance. */
export interface RnnoiseInstance {
	/** Process one 480-sample mono frame. Returns VAD probability (unused). */
	processFrame(input: Float32Array, output: Float32Array): number;
	destroy(): void;
}

interface RnnoiseModule {
	instance: WebAssembly.Instance;
	memory: WebAssembly.Memory;
	create(): number;
	processFrame(state: number, out: number, inp: number): number;
	destroy(state: number): number;
	malloc(size: number): number;
	free(ptr: number): void;
}

let moduleCache: Promise<RnnoiseModule> | null = null;

/**
 * Load the RNNoise WASM module from the public asset copy, verify checksum.
 * The module is loaded lazily (only when first called); a module-level cache
 * prevents re-instantiation.
 */
export async function loadRnnoise(): Promise<{ createInstance(): RnnoiseInstance }> {
	if (!moduleCache) {
		moduleCache = loadRnnoiseModule();
	}
	const mod = await moduleCache;
	return {
		createInstance(): RnnoiseInstance {
			return createRnnoiseInstance(mod);
		}
	};
}

async function loadRnnoiseModule(): Promise<RnnoiseModule> {
	let manifest: { sizeBytes: number; checksum: string };
	let binary: Uint8Array;
	try {
		const baseUrl = publicAssetBaseUrl();
		const [manifestResponse, wasmResponse] = await Promise.all([
			fetch(new URL('manifest.json', baseUrl)),
			fetch(new URL('rnnoise.wasm', baseUrl))
		]);
		if (!manifestResponse.ok) {
			throw new Error(`manifest fetch failed with HTTP ${manifestResponse.status}`);
		}
		if (!wasmResponse.ok) {
			throw new Error(`wasm fetch failed with HTTP ${wasmResponse.status}`);
		}
		manifest = (await manifestResponse.json()) as { sizeBytes: number; checksum: string };
		binary = new Uint8Array(await wasmResponse.arrayBuffer());
	} catch (err) {
		throw new RnnoiseLoadError(
			`Failed to load RNNoise WASM assets: ${err instanceof Error ? err.message : String(err)}`
		);
	}

	if (binary.length === 0 || manifest.sizeBytes <= 0 || manifest.checksum.includes('placeholder')) {
		throw new RnnoiseLoadError(
			'RNNoise WASM artifact is missing. Run scripts/build-rnnoise-wasm.mjs and commit rnnoise.wasm, rnnoise-wasm-b64.ts, and rnnoise-wasm-manifest.json.'
		);
	}

	const binaryBuffer = binary.buffer.slice(
		binary.byteOffset,
		binary.byteOffset + binary.byteLength
	) as ArrayBuffer;

	// Verify byte size
	if (binary.length !== manifest.sizeBytes) {
		throw new RnnoiseLoadError(
			`RNNoise WASM size mismatch: expected ${manifest.sizeBytes} bytes, got ${binary.length}`
		);
	}

	// Verify SHA-256 checksum
	const hashBuffer = await crypto.subtle.digest('SHA-256', binaryBuffer);
	const hashHex = Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	const expected = manifest.checksum.replace('sha256-', '');
	if (hashHex !== expected) {
		throw new RnnoiseLoadError(
			`RNNoise WASM checksum mismatch: expected sha256-${expected}, got sha256-${hashHex}`
		);
	}

	// Instantiate. The vendored @jitsi/rnnoise-wasm binary is Emscripten-built
	// but can be driven without the JS glue: memory is export `c`, constructors
	// are export `d`, and the C API is minified to f/h/j plus malloc/free g/i.
	const wasmModule = await WebAssembly.compile(binaryBuffer);
	let memory: WebAssembly.Memory | null = null;
	let heapU8: Uint8Array | null = null;
	const refreshHeap = (): Uint8Array => {
		if (!memory) throw new RnnoiseLoadError('RNNoise WASM memory was not initialized');
		if (!heapU8 || heapU8.buffer !== memory.buffer) heapU8 = new Uint8Array(memory.buffer);
		return heapU8;
	};
	const imports = {
		a: {
			a(requestedSize: number): number {
				if (!memory) return 0;
				const oldBytes = memory.buffer.byteLength;
				if (requestedSize <= oldBytes) return 1;
				const pages = Math.ceil((requestedSize - oldBytes) / 65_536);
				try {
					memory.grow(pages);
					heapU8 = new Uint8Array(memory.buffer);
					return 1;
				} catch {
					return 0;
				}
			},
			b(dest: number, src: number, num: number): void {
				refreshHeap().copyWithin(dest, src, src + num);
			}
		}
	};
	const instance = await WebAssembly.instantiate(wasmModule, imports);
	const exports = instance.exports as unknown as Record<string, WebAssembly.ExportValue>;

	memory = exports['c'] as WebAssembly.Memory;
	const constructors = exports['d'] as () => void;
	const create = exports['f'] as () => number;
	const malloc = exports['g'] as (size: number) => number;
	const destroy = exports['h'] as (state: number) => number;
	const free = exports['i'] as (ptr: number) => void;
	const processFrame = exports['j'] as (state: number, out: number, inp: number) => number;

	if (!memory || !constructors || !create || !malloc || !destroy || !free || !processFrame) {
		throw new RnnoiseLoadError('RNNoise WASM missing required exports');
	}
	constructors();

	return { instance, memory, create, processFrame, destroy, malloc, free };
}

function publicAssetBaseUrl(): URL {
	const base = (
		import.meta as ImportMeta & {
			env?: { BASE_URL?: string };
		}
	).env?.BASE_URL;
	const pathname = `${base ?? '/'}rnnoise/`.replace(/\/{2,}/g, '/');
	const origin =
		typeof globalThis.location !== 'undefined' ? globalThis.location.origin : 'http://localhost';
	return new URL(pathname, origin);
}

function createRnnoiseInstance(mod: RnnoiseModule): RnnoiseInstance {
	const statePtr = mod.create();
	if (!statePtr) {
		throw new RnnoiseLoadError('rnnoise_create returned null');
	}

	// Allocate two 480-float regions in the WASM heap (input + output)
	const allocSize = FRAME_SIZE * 4 * 2; // both input and output frames
	const inPtr = mod.malloc(allocSize);
	if (!inPtr) {
		throw new RnnoiseLoadError('Failed to allocate memory in WASM heap');
	}
	const outPtr = inPtr + FRAME_SIZE * 4;

	let destroyed = false;

	return {
		processFrame(input: Float32Array, output: Float32Array): number {
			if (destroyed) throw new Error('RnnoiseInstance already destroyed');
			// RNNoise's C API expects float samples in 16-bit PCM range, not
			// normalized Web Audio [-1, 1] samples.
			const heapF32 = new Float32Array(mod.memory.buffer, inPtr, FRAME_SIZE);
			for (let i = 0; i < FRAME_SIZE; i += 1) {
				heapF32[i] = (input[i] ?? 0) * 32_768;
			}
			// Process
			const vad = mod.processFrame(statePtr, outPtr, inPtr);
			const outHeap = new Float32Array(mod.memory.buffer, outPtr, FRAME_SIZE);
			for (let i = 0; i < FRAME_SIZE; i += 1) {
				output[i] = (outHeap[i] ?? 0) / 32_768;
			}
			return vad;
		},
		destroy(): void {
			if (!destroyed) {
				destroyed = true;
				mod.destroy(statePtr);
				mod.free(inPtr);
			}
		}
	};
}

/**
 * Frame-adaptation ring with fixed-size I/O guarantee.
 *
 * push(N) always returns exactly N denoised samples by maintaining both an
 * input accumulator (feeds 480-sample frames to the denoiser) and an output
 * ring buffer (pre-primed with 480 silence samples to compensate for the
 * denoiser's one-frame latency). This guarantees rate-matched I/O for any
 * block size (128-sample worklet quanta, 1024-sample export blocks, etc.).
 */
export class RnnoiseRing {
	private readonly instance: RnnoiseInstance;
	private inputBuffer: Float32Array;
	private inputWritePos = 0;
	private inputReadPos = 0;
	private inputCount = 0;

	private outputBuffer: Float32Array;
	private outputReadPos = 0;
	private outputWritePos = 0;
	private outputCount = 0;

	constructor(instance: RnnoiseInstance) {
		this.instance = instance;
		this.inputBuffer = new Float32Array(FRAME_SIZE * 4);
		this.outputBuffer = new Float32Array(FRAME_SIZE * 4);
		// Pre-prime output with one frame of silence to compensate denoiser latency.
		// The first real output appears after the first 480 input samples are processed.
		this.outputWritePos = FRAME_SIZE;
		this.outputCount = FRAME_SIZE;
	}

	/**
	 * Push a mono block of any size. Returns exactly `input.length` denoised
	 * samples, rate-matched via the internal output ring buffer.
	 * Caller must not modify the returned buffer.
	 */
	push(input: Float32Array): Float32Array {
		this.ensureInputCapacity(input.length);

		// Append input to ring buffer
		for (let i = 0; i < input.length; i++) {
			this.inputBuffer[this.inputWritePos] = input[i];
			this.inputWritePos = (this.inputWritePos + 1) % this.inputBuffer.length;
		}
		this.inputCount += input.length;

		// Process all complete 480-sample frames
		while (this.inputCount >= FRAME_SIZE) {
			this.ensureOutputCapacity(FRAME_SIZE);
			const frameIn = new Float32Array(FRAME_SIZE);
			for (let i = 0; i < FRAME_SIZE; i++) {
				frameIn[i] = this.inputBuffer[this.inputReadPos];
				this.inputReadPos = (this.inputReadPos + 1) % this.inputBuffer.length;
			}
			this.inputCount -= FRAME_SIZE;

			const frameOut = new Float32Array(FRAME_SIZE);
			this.instance.processFrame(frameIn, frameOut);

			for (let i = 0; i < FRAME_SIZE; i++) {
				this.outputBuffer[this.outputWritePos] = frameOut[i];
				this.outputWritePos = (this.outputWritePos + 1) % this.outputBuffer.length;
			}
			this.outputCount += FRAME_SIZE;
		}

		// Read exactly input.length samples from output ring
		const result = new Float32Array(input.length);
		const readLen = Math.min(input.length, this.outputCount);
		for (let i = 0; i < readLen; i++) {
			result[i] = this.outputBuffer[this.outputReadPos];
			this.outputReadPos = (this.outputReadPos + 1) % this.outputBuffer.length;
		}
		this.outputCount -= readLen;
		// Any remainder in result stays 0 (latency — output not yet available)

		return result;
	}

	/** Drain remaining buffered samples (call at end of stream). */
	drain(): Float32Array {
		// Process any remaining input as a final zero-padded frame
		if (this.inputCount > 0) {
			const frameIn = new Float32Array(FRAME_SIZE);
			for (let i = 0; i < this.inputCount; i++) {
				frameIn[i] = this.inputBuffer[this.inputReadPos];
				this.inputReadPos = (this.inputReadPos + 1) % this.inputBuffer.length;
			}
			this.inputCount = 0;

			this.ensureOutputCapacity(FRAME_SIZE);
			const frameOut = new Float32Array(FRAME_SIZE);
			this.instance.processFrame(frameIn, frameOut);
			for (let i = 0; i < FRAME_SIZE; i++) {
				this.outputBuffer[this.outputWritePos] = frameOut[i];
				this.outputWritePos = (this.outputWritePos + 1) % this.outputBuffer.length;
			}
			this.outputCount += FRAME_SIZE;
		}

		// Return all remaining output
		const result = new Float32Array(this.outputCount);
		for (let i = 0; i < result.length; i++) {
			result[i] = this.outputBuffer[this.outputReadPos];
			this.outputReadPos = (this.outputReadPos + 1) % this.outputBuffer.length;
		}
		this.outputCount = 0;
		return result;
	}

	destroy(): void {
		this.instance.destroy();
	}

	private ensureInputCapacity(additionalSamples: number): void {
		const needed = this.inputCount + additionalSamples;
		if (needed <= this.inputBuffer.length) return;
		const newSize = Math.max(this.inputBuffer.length * 2, needed + FRAME_SIZE);
		const newBuf = new Float32Array(newSize);
		for (let i = 0; i < this.inputCount; i++) {
			newBuf[i] = this.inputBuffer[(this.inputReadPos + i) % this.inputBuffer.length];
		}
		this.inputBuffer = newBuf;
		this.inputReadPos = 0;
		this.inputWritePos = this.inputCount;
	}

	private ensureOutputCapacity(additionalSamples: number): void {
		const needed = this.outputCount + additionalSamples;
		if (needed <= this.outputBuffer.length) return;
		const newSize = Math.max(this.outputBuffer.length * 2, needed + FRAME_SIZE);
		const newBuf = new Float32Array(newSize);
		for (let i = 0; i < this.outputCount; i++) {
			newBuf[i] = this.outputBuffer[(this.outputReadPos + i) % this.outputBuffer.length];
		}
		this.outputBuffer = newBuf;
		this.outputReadPos = 0;
		this.outputWritePos = this.outputCount;
	}
}
