/**
 * Matte-model manifest: declares the LiteRT model asset (provenance, license,
 * exact size, SHA-256 checksum, input dimensions). Weights are fetched
 * same-origin only, never at app startup, and must match the manifest
 * byte-for-byte before an inference session is created.
 */

import type {
	MatteModelFormat,
	MatteModelManifestSnapshot,
	MatteTensorLayout
} from '../../protocol';

export class ManifestError extends Error {
	constructor(message: string) {
		super(`Invalid matte model manifest: ${message}`);
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

function optionalFormat(value: unknown): MatteModelFormat {
	if (value === undefined) return 'tflite';
	if (value !== 'tflite') {
		throw new ManifestError('"format" must be "tflite"');
	}
	return value;
}

function optionalLayout(value: unknown): MatteTensorLayout {
	if (value === undefined) return 'nhwc';
	if (value !== 'nchw' && value !== 'nhwc') {
		throw new ManifestError('"inputLayout" must be "nchw" or "nhwc"');
	}
	return value;
}

/** Validates an untrusted manifest document. Unknown fields are tolerated. */
export function validateManifest(value: unknown): MatteModelManifestSnapshot {
	if (!isRecord(value)) throw new ManifestError('manifest must be an object');
	const id = requireString(value.id, 'id');
	const version = requireString(value.version, 'version');
	const format = optionalFormat(value.format);
	const license = requireString(value.license, 'license');
	const source = requireString(value.source, 'source');
	const sizeBytes = requirePositiveInt(value.sizeBytes, 'sizeBytes');
	const checksum = requireString(value.checksum, 'checksum').toLowerCase();
	if (!/^sha256-[0-9a-f]{64}$/.test(checksum)) {
		throw new ManifestError('"checksum" must be "sha256-" followed by 64 hex digits');
	}
	const inputWidth = requirePositiveInt(value.inputWidth, 'inputWidth');
	const inputHeight = requirePositiveInt(value.inputHeight, 'inputHeight');
	const inputLayout = optionalLayout(value.inputLayout);

	return {
		id,
		version,
		format,
		license,
		source,
		sizeBytes,
		checksum,
		inputWidth,
		inputHeight,
		inputLayout
	};
}

/**
 * Verifies fetched model bytes against the manifest. Both size and SHA-256
 * digest must match exactly; a mismatch is a hard error and must never trigger
 * a silent retry against another source.
 */
export async function verifyWeights(
	manifest: MatteModelManifestSnapshot,
	bytes: ArrayBuffer
): Promise<void> {
	if (bytes.byteLength !== manifest.sizeBytes) {
		throw new ManifestError(
			`model size mismatch: expected ${manifest.sizeBytes} bytes, got ${bytes.byteLength}`
		);
	}
	const digestBuffer = await crypto.subtle.digest('SHA-256', bytes);
	const digest = Array.from(new Uint8Array(digestBuffer))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
	if (`sha256-${digest}` !== manifest.checksum) {
		throw new ManifestError(`model checksum mismatch: sha256-${digest}`);
	}
}
