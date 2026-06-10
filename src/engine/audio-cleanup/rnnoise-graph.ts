/**
 * RNNoise WebNN graph: a dense input layer feeding three stacked GRUs (VAD /
 * noise / denoise) and a sigmoid output of 22 band gains per frame, built per
 * the reference WebNN sample (webmachinelearning/webnn-samples `rnnoise/`).
 *
 * GRU hidden state is exposed as graph inputs/outputs and carried across
 * batches by this wrapper so long sources stream chunk-by-chunk seamlessly.
 *
 * Runs only inside the Audio Cleanup worker.
 */

import { RNNOISE_FEATURE_SIZE, RNNOISE_GAINS_SIZE, type NpyTensor } from './model-manifest';
import { RNNOISE_TENSOR_NAMES } from './model-manifest';

const VAD_GRU_HIDDEN = 24;
const NOISE_GRU_HIDDEN = 48;
const DENOISE_GRU_HIDDEN = 96;
const BATCH = 1;

export type WebNNDeviceType = 'cpu' | 'gpu' | 'npu';

export class ModelBuildError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ModelBuildError';
	}
}

interface ModelTensors {
	input: MLTensor;
	vadH: MLTensor;
	noiseH: MLTensor;
	denoiseH: MLTensor;
	gains: MLTensor;
	vadHOut: MLTensor;
	noiseHOut: MLTensor;
	denoiseHOut: MLTensor;
}

function operandDescriptor(shape: readonly number[]): MLOperandDescriptor {
	// `dimensions` is the legacy field name; current Chromium reads `shape`.
	return { dataType: 'float32', dimensions: shape, shape };
}

function tensorDescriptor(shape: readonly number[], mode: 'read' | 'write'): MLTensorDescriptor {
	const descriptor: MLTensorDescriptor = operandDescriptor(shape);
	if (mode === 'write') descriptor.writable = true;
	else descriptor.readable = true;
	if (typeof MLTensorUsage !== 'undefined' && MLTensorUsage) {
		descriptor.usage = mode === 'write' ? MLTensorUsage.WRITE : MLTensorUsage.READ;
	}
	return descriptor;
}

export class RnnoiseModel {
	private constructor(
		private readonly context: MLContext,
		private readonly graph: MLGraph,
		private readonly tensors: ModelTensors,
		private readonly frames: number,
		readonly deviceType: WebNNDeviceType
	) {}

	private vadState = new Float32Array(BATCH * VAD_GRU_HIDDEN);
	private noiseState = new Float32Array(BATCH * NOISE_GRU_HIDDEN);
	private denoiseState = new Float32Array(BATCH * DENOISE_GRU_HIDDEN);

	/**
	 * Builds the graph on the first backend in `deviceTypes` that succeeds.
	 * Throws `ModelBuildError` when every backend fails — that result is the
	 * ground truth for the probe's `modelSupport` state.
	 */
	static async create(
		ml: ML,
		weights: Map<string, NpyTensor>,
		frames: number,
		deviceTypes: readonly WebNNDeviceType[]
	): Promise<RnnoiseModel> {
		for (const name of RNNOISE_TENSOR_NAMES) {
			if (!weights.has(name)) throw new ModelBuildError(`missing weight tensor "${name}"`);
		}
		let lastError: unknown = null;
		for (const deviceType of deviceTypes) {
			try {
				const context = await ml.createContext({ deviceType });
				return await RnnoiseModel.buildOnContext(context, weights, frames, deviceType);
			} catch (error) {
				lastError = error;
			}
		}
		const detail = lastError instanceof Error ? lastError.message : String(lastError);
		throw new ModelBuildError(`RNNoise graph build failed on all backends: ${detail}`);
	}

	private static async buildOnContext(
		context: MLContext,
		weights: Map<string, NpyTensor>,
		frames: number,
		deviceType: WebNNDeviceType
	): Promise<RnnoiseModel> {
		const builder = new MLGraphBuilder(context);
		const constant = (name: string): MLOperand => {
			const tensor = weights.get(name)!;
			return builder.constant(operandDescriptor(tensor.shape), tensor.data);
		};

		const input = builder.input('input', operandDescriptor([BATCH, frames, RNNOISE_FEATURE_SIZE]));
		const vadGruInitialH = builder.input(
			'vadGruInitialH',
			operandDescriptor([1, BATCH, VAD_GRU_HIDDEN])
		);
		const noiseGruInitialH = builder.input(
			'noiseGruInitialH',
			operandDescriptor([1, BATCH, NOISE_GRU_HIDDEN])
		);
		const denoiseGruInitialH = builder.input(
			'denoiseGruInitialH',
			operandDescriptor([1, BATCH, DENOISE_GRU_HIDDEN])
		);

		// Dense input layer with tanh.
		const inputDense = builder.tanh(
			builder.add(
				builder.matmul(input, constant('input_dense_kernel_0')),
				constant('input_dense_bias_0')
			)
		);

		const gruPass = (
			x: MLOperand,
			prefix: 'vad_gru' | 'noise_gru' | 'denoise_gru',
			hiddenSize: number,
			initialHiddenState: MLOperand
		): { hidden: MLOperand; sequence: MLOperand } => {
			const biasData = constant(`${prefix}_B`);
			const bias = builder.slice(biasData, [0, 0], [1, 3 * hiddenSize]);
			const recurrentBias = builder.slice(biasData, [0, 3 * hiddenSize], [1, 3 * hiddenSize]);
			const outputs = builder.gru(
				builder.transpose(x, { permutation: [1, 0, 2] }),
				constant(`${prefix}_W`),
				constant(`${prefix}_R`),
				frames,
				hiddenSize,
				{
					bias,
					recurrentBias,
					initialHiddenState,
					returnSequence: true,
					resetAfter: false,
					activations: ['sigmoid', 'relu']
				}
			);
			const hidden = outputs[0]!;
			const sequence = builder.reshape(
				builder.transpose(outputs[1]!, { permutation: [2, 0, 1, 3] }),
				[BATCH, frames, hiddenSize]
			);
			return { hidden, sequence };
		};

		const vad = gruPass(inputDense, 'vad_gru', VAD_GRU_HIDDEN, vadGruInitialH);
		const noiseInput = builder.concat([inputDense, vad.sequence, input], 2);
		const noise = gruPass(noiseInput, 'noise_gru', NOISE_GRU_HIDDEN, noiseGruInitialH);
		const denoiseInput = builder.concat([vad.sequence, noise.sequence, input], 2);
		const denoise = gruPass(denoiseInput, 'denoise_gru', DENOISE_GRU_HIDDEN, denoiseGruInitialH);

		const denoiseOutput = builder.sigmoid(
			builder.add(
				builder.matmul(denoise.sequence, constant('denoise_output_kernel_0')),
				constant('denoise_output_bias_0')
			)
		);

		const graph = await builder.build({
			denoiseOutput,
			vadGruYH: vad.hidden,
			noiseGruYH: noise.hidden,
			denoiseGruYH: denoise.hidden
		});

		const tensors: ModelTensors = {
			input: await context.createTensor(
				tensorDescriptor([BATCH, frames, RNNOISE_FEATURE_SIZE], 'write')
			),
			vadH: await context.createTensor(tensorDescriptor([1, BATCH, VAD_GRU_HIDDEN], 'write')),
			noiseH: await context.createTensor(tensorDescriptor([1, BATCH, NOISE_GRU_HIDDEN], 'write')),
			denoiseH: await context.createTensor(
				tensorDescriptor([1, BATCH, DENOISE_GRU_HIDDEN], 'write')
			),
			gains: await context.createTensor(
				tensorDescriptor([BATCH, frames, RNNOISE_GAINS_SIZE], 'read')
			),
			vadHOut: await context.createTensor(tensorDescriptor([1, BATCH, VAD_GRU_HIDDEN], 'read')),
			noiseHOut: await context.createTensor(tensorDescriptor([1, BATCH, NOISE_GRU_HIDDEN], 'read')),
			denoiseHOut: await context.createTensor(
				tensorDescriptor([1, BATCH, DENOISE_GRU_HIDDEN], 'read')
			)
		};
		return new RnnoiseModel(context, graph, tensors, frames, deviceType);
	}

	resetState(): void {
		this.vadState.fill(0);
		this.noiseState.fill(0);
		this.denoiseState.fill(0);
	}

	get batchFrames(): number {
		return this.frames;
	}

	/**
	 * Runs one batch. `features` must hold `frames × 42` values (zero-padded
	 * past `frameCount`); returns `frames × 22` gains (use the first
	 * `frameCount` rows). GRU state is carried into the next call.
	 */
	async infer(features: Float32Array): Promise<Float32Array> {
		const { context, tensors } = this;
		context.writeTensor(tensors.input, features);
		context.writeTensor(tensors.vadH, this.vadState);
		context.writeTensor(tensors.noiseH, this.noiseState);
		context.writeTensor(tensors.denoiseH, this.denoiseState);
		context.dispatch(
			this.graph,
			{
				input: tensors.input,
				vadGruInitialH: tensors.vadH,
				noiseGruInitialH: tensors.noiseH,
				denoiseGruInitialH: tensors.denoiseH
			},
			{
				denoiseOutput: tensors.gains,
				vadGruYH: tensors.vadHOut,
				noiseGruYH: tensors.noiseHOut,
				denoiseGruYH: tensors.denoiseHOut
			}
		);
		const [gains, vadH, noiseH, denoiseH] = await Promise.all([
			context.readTensor(tensors.gains),
			context.readTensor(tensors.vadHOut),
			context.readTensor(tensors.noiseHOut),
			context.readTensor(tensors.denoiseHOut)
		]);
		this.vadState = new Float32Array(vadH);
		this.noiseState = new Float32Array(noiseH);
		this.denoiseState = new Float32Array(denoiseH);
		return new Float32Array(gains);
	}

	destroy(): void {
		for (const tensor of Object.values(this.tensors)) {
			tensor.destroy?.();
		}
		this.context.destroy?.();
	}
}
