import { describe, expect, it } from 'vite-plus/test';

import { sha256Hex } from '../../asr/asset-cache';
import {
	FIXTURE_DEFAULT_DIMS,
	FIXTURE_INPUT_NAME,
	FIXTURE_OUTPUT_NAME,
	makeIdentityOnnxModel
} from './onnx-fixture';

describe('identity ONNX fixture', () => {
	it('encodes a ModelProto whose first field is ir_version', () => {
		const bytes = makeIdentityOnnxModel();
		// ModelProto.ir_version is field 1, wire type 0 → tag byte 0x08; value 7.
		expect(bytes[0]).toBe(0x08);
		expect(bytes[1]).toBe(7);
		expect(bytes.byteLength).toBeGreaterThan(40);
	});

	it('embeds the declared input/output names', () => {
		const text = new TextDecoder().decode(makeIdentityOnnxModel());
		expect(text).toContain(FIXTURE_INPUT_NAME);
		expect(text).toContain(FIXTURE_OUTPUT_NAME);
		expect(text).toContain('Identity');
	});

	it('is deterministic for given dims (stable SHA-256)', async () => {
		const a = makeIdentityOnnxModel(FIXTURE_DEFAULT_DIMS);
		const b = makeIdentityOnnxModel([...FIXTURE_DEFAULT_DIMS]);
		expect(Array.from(a)).toEqual(Array.from(b));
		expect(await sha256Hex(a)).toBe(await sha256Hex(b));
	});

	it('varies with dims', () => {
		const a = makeIdentityOnnxModel([1, 4]);
		const c = makeIdentityOnnxModel([1, 8]);
		expect(Array.from(a)).not.toEqual(Array.from(c));
	});
});
