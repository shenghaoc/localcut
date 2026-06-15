/**
 * Dev/test-only ONNX fixture generator.
 *
 * Builds a tiny, valid ONNX model (a single `Identity` node, `float32` in →
 * `float32` out) entirely in memory so the device-ownership and WebNN spikes have
 * something real to load without shipping a binary model asset. Encoding the ONNX
 * `ModelProto` protobuf by hand keeps the fixture self-contained, deterministic,
 * and free of any pinned-asset / SHA bookkeeping (it is never fetched).
 *
 * This is NOT a production model path: real ORT features ship a manifest with a
 * pinned size + SHA-256 and load through {@link file://./ort-asset-loader.ts}.
 */

const ONNX_IR_VERSION = 7;
const ONNX_OPSET_VERSION = 13;
const TENSOR_ELEM_TYPE_FLOAT = 1;

const utf8 = new TextEncoder();

/** Appends an unsigned LEB128 varint. */
function varint(value: number): number[] {
	const out: number[] = [];
	let v = value;
	do {
		let byte = v & 0x7f;
		v = Math.floor(v / 128);
		if (v > 0) byte |= 0x80;
		out.push(byte);
	} while (v > 0);
	return out;
}

/** Field tag = (fieldNumber << 3) | wireType. */
function tag(field: number, wireType: number): number[] {
	return varint(field * 8 + wireType);
}

/** Length-delimited field (wire type 2): nested messages, strings, bytes. */
function lenDelim(field: number, payload: readonly number[]): number[] {
	return [...tag(field, 2), ...varint(payload.length), ...payload];
}

/** Varint field (wire type 0): ints. */
function varintField(field: number, value: number): number[] {
	return [...tag(field, 0), ...varint(value)];
}

/** UTF-8 string field. */
function stringField(field: number, value: string): number[] {
	return lenDelim(field, [...utf8.encode(value)]);
}

/** A ValueInfoProto for a float tensor with a fixed shape. */
function valueInfo(name: string, dims: readonly number[]): number[] {
	// TensorShapeProto: repeated Dimension dim = 1; Dimension.dim_value = 1.
	const shape: number[] = [];
	for (const dim of dims) shape.push(...lenDelim(1, varintField(1, dim)));
	// TypeProto.Tensor: elem_type = 1, shape = 2.
	const tensorType = [...varintField(1, TENSOR_ELEM_TYPE_FLOAT), ...lenDelim(2, shape)];
	// TypeProto: tensor_type = 1.
	const typeProto = lenDelim(1, tensorType);
	// ValueInfoProto: name = 1, type = 2.
	return [...stringField(1, name), ...lenDelim(2, typeProto)];
}

export const FIXTURE_INPUT_NAME = 'input';
export const FIXTURE_OUTPUT_NAME = 'output';
export const FIXTURE_DEFAULT_DIMS: readonly number[] = [1, 4];

/**
 * Returns the bytes of a minimal identity ONNX model. The same `dims` produce
 * byte-identical output (deterministic), so a SHA-256 over the result is stable.
 */
export function makeIdentityOnnxModel(dims: readonly number[] = FIXTURE_DEFAULT_DIMS): Uint8Array {
	// NodeProto: input = 1, output = 2, name = 3, op_type = 4.
	const node = [
		...stringField(1, FIXTURE_INPUT_NAME),
		...stringField(2, FIXTURE_OUTPUT_NAME),
		...stringField(3, 'identity_node'),
		...stringField(4, 'Identity')
	];
	// GraphProto: node = 1, name = 2, input = 11, output = 12.
	const graph = [
		...lenDelim(1, node),
		...stringField(2, 'identity-graph'),
		...lenDelim(11, valueInfo(FIXTURE_INPUT_NAME, dims)),
		...lenDelim(12, valueInfo(FIXTURE_OUTPUT_NAME, dims))
	];
	// OperatorSetIdProto: domain = 1 (empty = default ai.onnx), version = 2.
	const opset = [...stringField(1, ''), ...varintField(2, ONNX_OPSET_VERSION)];
	// ModelProto: ir_version = 1, producer_name = 2, graph = 7, opset_import = 8.
	const model = [
		...varintField(1, ONNX_IR_VERSION),
		...stringField(2, 'localcut-ort-spike'),
		...lenDelim(7, graph),
		...lenDelim(8, opset)
	];
	return Uint8Array.from(model);
}
