/**
 * Minimal ambient WebNN API declarations (https://www.w3.org/TR/webnn/).
 *
 * TypeScript does not ship WebNN types yet; these cover exactly the surface the
 * audio-cleanup feature uses (context probing, graph building for the RNNoise
 * GRU network, and tensor dispatch). All members are optional-feature-detected
 * at runtime — nothing here may be assumed present.
 */

type MLDeviceType = 'cpu' | 'gpu' | 'npu';

interface MLContextOptions {
	deviceType?: MLDeviceType;
	powerPreference?: 'default' | 'high-performance' | 'low-power';
}

interface MLOperandDescriptor {
	dataType: 'float32' | 'float16' | 'int32' | 'uint32' | 'int8' | 'uint8';
	/** Older Chromium builds read `dimensions`; the current spec reads `shape`. */
	dimensions?: readonly number[];
	shape?: readonly number[];
}

interface MLTensorDescriptor extends MLOperandDescriptor {
	readable?: boolean;
	writable?: boolean;
	/** Legacy pre-spec usage flags (kept for older Chromium builds). */
	usage?: number;
}

interface MLOperand {
	readonly __mlOperandBrand?: never;
}

interface MLTensor {
	destroy?(): void;
}

interface MLGraph {
	readonly __mlGraphBrand?: never;
}

interface MLGruOptions {
	bias?: MLOperand;
	recurrentBias?: MLOperand;
	initialHiddenState?: MLOperand;
	returnSequence?: boolean;
	resetAfter?: boolean;
	activations?: readonly string[];
}

interface MLGraphBuilder {
	input(name: string, descriptor: MLOperandDescriptor): MLOperand;
	constant(descriptor: MLOperandDescriptor, buffer: Float32Array): MLOperand;
	matmul(a: MLOperand, b: MLOperand): MLOperand;
	add(a: MLOperand, b: MLOperand): MLOperand;
	tanh(input: MLOperand): MLOperand;
	sigmoid(input: MLOperand): MLOperand;
	transpose(input: MLOperand, options?: { permutation?: readonly number[] }): MLOperand;
	reshape(input: MLOperand, newShape: readonly number[]): MLOperand;
	slice(input: MLOperand, starts: readonly number[], sizes: readonly number[]): MLOperand;
	concat(inputs: readonly MLOperand[], axis: number): MLOperand;
	gru(
		input: MLOperand,
		weight: MLOperand,
		recurrentWeight: MLOperand,
		steps: number,
		hiddenSize: number,
		options?: MLGruOptions
	): MLOperand[];
	build(outputs: Record<string, MLOperand>): Promise<MLGraph>;
}

declare const MLGraphBuilder: {
	prototype: MLGraphBuilder;
	new (context: MLContext): MLGraphBuilder;
};

interface MLContext {
	createTensor(descriptor: MLTensorDescriptor): Promise<MLTensor>;
	writeTensor(tensor: MLTensor, data: Float32Array): void;
	readTensor(tensor: MLTensor): Promise<ArrayBuffer>;
	dispatch(
		graph: MLGraph,
		inputs: Record<string, MLTensor>,
		outputs: Record<string, MLTensor>
	): void;
	destroy?(): void;
}

interface ML {
	createContext(options?: MLContextOptions): Promise<MLContext>;
}

/** Legacy tensor-usage bitflags shipped by earlier Chromium WebNN builds. */
declare const MLTensorUsage:
	| {
			WRITE: number;
			READ: number;
	  }
	| undefined;

interface Navigator {
	readonly ml?: ML;
}

interface WorkerNavigator {
	readonly ml?: ML;
}
