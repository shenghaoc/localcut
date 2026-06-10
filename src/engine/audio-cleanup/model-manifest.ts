/**
 * Cleanup-model manifest: declares the RNNoise weights asset (provenance,
 * license, exact size, SHA-256 checksum) and the fixed audio contract the
 * model was trained for. Weights are fetched same-origin only, never at app
 * startup, and must match the manifest byte-for-byte before a graph is built.
 */

export const RNNOISE_SAMPLE_RATE = 48_000;
export const RNNOISE_FRAME_SIZE = 480;
export const RNNOISE_FEATURE_SIZE = 42;
export const RNNOISE_GAINS_SIZE = 22;

/** Byte range of one packed tensor inside the weights asset. */
export interface ManifestTensorEntry {
	name: string;
	byteOffset: number;
	byteLength: number;
}

export interface CleanupModelManifest {
	id: 'rnnoise';
	version: string;
	license: string;
	source: string;
	sizeBytes: number;
	/** `sha256-<hex>` digest of the whole weights asset. */
	checksum: string;
	audio: {
		sampleRate: typeof RNNOISE_SAMPLE_RATE;
		channels: 1;
		frameSize: typeof RNNOISE_FRAME_SIZE;
	};
	tensors: ManifestTensorEntry[];
}

/** Tensor names the RNNoise graph requires, in packed order. */
export const RNNOISE_TENSOR_NAMES = [
	'input_dense_kernel_0',
	'input_dense_bias_0',
	'vad_gru_W',
	'vad_gru_R',
	'vad_gru_B',
	'noise_gru_W',
	'noise_gru_R',
	'noise_gru_B',
	'denoise_gru_W',
	'denoise_gru_R',
	'denoise_gru_B',
	'denoise_output_kernel_0',
	'denoise_output_bias_0'
] as const;

export class ManifestError extends Error {
	constructor(message: string) {
		super(`Invalid cleanup model manifest: ${message}`);
		this.name = 'ManifestError';
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new ManifestError(`"${field}" must be a non-empty string`);
	}
	return value;
}

function requirePositiveInt(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		throw new ManifestError(`"${field}" must be a positive integer`);
	}
	return value;
}

/** Validates an untrusted manifest document. Unknown fields are tolerated. */
export function validateManifest(value: unknown): CleanupModelManifest {
	if (!isRecord(value)) throw new ManifestError('manifest must be an object');
	if (value.id !== 'rnnoise') throw new ManifestError('"id" must be "rnnoise"');
	const version = requireString(value.version, 'version');
	const license = requireString(value.license, 'license');
	const source = requireString(value.source, 'source');
	const sizeBytes = requirePositiveInt(value.sizeBytes, 'sizeBytes');
	const checksum = requireString(value.checksum, 'checksum');
	if (!/^sha256-[0-9a-f]{64}$/.test(checksum)) {
		throw new ManifestError('"checksum" must be "sha256-" followed by 64 hex digits');
	}

	if (!isRecord(value.audio)) throw new ManifestError('"audio" must be an object');
	if (value.audio.sampleRate !== RNNOISE_SAMPLE_RATE) {
		throw new ManifestError(`"audio.sampleRate" must be ${RNNOISE_SAMPLE_RATE}`);
	}
	if (value.audio.channels !== 1) throw new ManifestError('"audio.channels" must be 1');
	if (value.audio.frameSize !== RNNOISE_FRAME_SIZE) {
		throw new ManifestError(`"audio.frameSize" must be ${RNNOISE_FRAME_SIZE}`);
	}

	if (!Array.isArray(value.tensors)) throw new ManifestError('"tensors" must be an array');
	const tensors: ManifestTensorEntry[] = value.tensors.map((entry, index) => {
		if (!isRecord(entry)) throw new ManifestError(`tensors[${index}] must be an object`);
		const name = requireString(entry.name, `tensors[${index}].name`);
		const byteLength = requirePositiveInt(entry.byteLength, `tensors[${index}].byteLength`);
		const byteOffset = entry.byteOffset;
		if (typeof byteOffset !== 'number' || !Number.isInteger(byteOffset) || byteOffset < 0) {
			throw new ManifestError(`tensors[${index}].byteOffset must be a non-negative integer`);
		}
		if (byteOffset + byteLength > sizeBytes) {
			throw new ManifestError(`tensors[${index}] range exceeds sizeBytes`);
		}
		return { name, byteOffset, byteLength };
	});
	const present = new Set(tensors.map((tensor) => tensor.name));
	for (const required of RNNOISE_TENSOR_NAMES) {
		if (!present.has(required)) throw new ManifestError(`missing tensor "${required}"`);
	}

	return {
		id: 'rnnoise',
		version,
		license,
		source,
		sizeBytes,
		checksum,
		audio: { sampleRate: RNNOISE_SAMPLE_RATE, channels: 1, frameSize: RNNOISE_FRAME_SIZE },
		tensors
	};
}

/**
 * Verifies fetched weights bytes against the manifest. Both size and SHA-256
 * digest must match exactly; a mismatch is a hard error (R3.2) and must never
 * trigger a silent retry against another source.
 */
export async function verifyWeights(
	manifest: CleanupModelManifest,
	bytes: ArrayBuffer
): Promise<void> {
	if (bytes.byteLength !== manifest.sizeBytes) {
		throw new ManifestError(
			`weights size mismatch: expected ${manifest.sizeBytes} bytes, got ${bytes.byteLength}`
		);
	}
	const digestBuffer = await crypto.subtle.digest('SHA-256', bytes);
	const digest = Array.from(new Uint8Array(digestBuffer))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
	if (`sha256-${digest}` !== manifest.checksum) {
		throw new ManifestError(`weights checksum mismatch: sha256-${digest}`);
	}
}

export interface NpyTensor {
	shape: number[];
	data: Float32Array;
}

/**
 * Parses a single little-endian float32 .npy (NumPy v1.0) tensor. The packed
 * weights asset is a byte-exact concatenation of the upstream .npy files, so
 * provenance can be re-verified against the published weights.
 */
export function parseNpy(bytes: ArrayBuffer, byteOffset: number, byteLength: number): NpyTensor {
	const view = new DataView(bytes, byteOffset, byteLength);
	const magic = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]; // \x93NUMPY
	for (let i = 0; i < magic.length; i++) {
		if (view.getUint8(i) !== magic[i]) throw new ManifestError('bad .npy magic');
	}
	if (view.getUint8(6) !== 1) throw new ManifestError('unsupported .npy version');
	const headerLength = view.getUint16(8, true);
	const headerBytes = new Uint8Array(bytes, byteOffset + 10, headerLength);
	let header = '';
	for (const byte of headerBytes) header += String.fromCharCode(byte);
	if (!header.includes("'descr': '<f4'")) {
		throw new ManifestError('only little-endian float32 .npy tensors are supported');
	}
	if (!header.includes("'fortran_order': False")) {
		throw new ManifestError('fortran-order .npy tensors are not supported');
	}
	const shapeMatch = header.match(/'shape':\s*\(([0-9,\s]*)\)/);
	if (!shapeMatch?.[1]) throw new ManifestError('missing .npy shape');
	const shape = shapeMatch[1]
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.map((part) => Number.parseInt(part, 10));
	const count = shape.reduce((total, dim) => total * dim, 1);
	const dataOffset = byteOffset + 10 + headerLength;
	if (dataOffset + count * 4 > byteOffset + byteLength) {
		throw new ManifestError('.npy data truncated');
	}
	// Slice (copy) so the tensor is usable even if `bytes` is detached later.
	const data = new Float32Array(bytes.slice(dataOffset, dataOffset + count * 4));
	return { shape, data };
}

/** Extracts all required tensors from verified packed weights bytes. */
export function unpackWeights(
	manifest: CleanupModelManifest,
	bytes: ArrayBuffer
): Map<string, NpyTensor> {
	const tensors = new Map<string, NpyTensor>();
	for (const entry of manifest.tensors) {
		tensors.set(entry.name, parseNpy(bytes, entry.byteOffset, entry.byteLength));
	}
	return tensors;
}
