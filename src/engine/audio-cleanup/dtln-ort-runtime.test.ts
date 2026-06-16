import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { DtlnDsp, DTLN_BLOCK_LEN, DTLN_BLOCK_SHIFT, DTLN_FREQ_BINS } from './dtln-dsp';
import { CleanupJobProcessor } from './cleanup-jobs';
import type { OnnxCleanupIo } from './onnx-model-manifest';

// The ORT runtime reaches `onnxruntime-web` only through the foundation loader,
// so mocking that boundary lets us drive deterministic fake sessions in node.
vi.mock('../ml/ort/ort-loader', () => ({
	ortWasmBasePath: vi.fn(() => '/_ort/'),
	loadOrtWasm: vi.fn(),
	loadOrtWebGpu: vi.fn(),
	loadOrtWebNN: vi.fn()
}));

const STATE_SHAPE = [1, 2, 128, 2];
const STATE_SIZE = 512;

const IO: OnnxCleanupIo = {
	model1: {
		magnitudeInput: 'input_2',
		stateInput: 'input_3',
		maskOutput: 'activation_2',
		stateOutput: 'tf_op_layer_stack_2'
	},
	model2: {
		frameInput: 'input_4',
		stateInput: 'input_5',
		frameOutput: 'conv1d_3',
		stateOutput: 'tf_op_layer_stack_5'
	}
};

class FakeTensor {
	constructor(
		readonly type: string,
		readonly data: Float32Array,
		readonly dims: number[]
	) {}
}

type Feeds = Record<string, FakeTensor>;
type RunFn = (feeds: Feeds) => Promise<Record<string, FakeTensor>>;

interface FakeSession {
	inputNames: string[];
	outputNames: string[];
	run: ReturnType<typeof vi.fn>;
	release: ReturnType<typeof vi.fn>;
}

function fakeSession(inputNames: string[], outputNames: string[], run: RunFn): FakeSession {
	return { inputNames, outputNames, run: vi.fn(run), release: vi.fn() };
}

function fakeOrt(sessions: FakeSession[]) {
	let next = 0;
	return {
		env: { wasm: { wasmPaths: '' }, webgpu: {} },
		Tensor: FakeTensor,
		InferenceSession: {
			create: vi.fn(async () => sessions[next++])
		}
	};
}

/** A model-2 session that simply echoes the estimated frame and zeroes state. */
function echoModel2(): FakeSession {
	return fakeSession(
		['input_4', 'input_5'],
		['conv1d_3', 'tf_op_layer_stack_5'],
		async (feeds) => ({
			conv1d_3: new FakeTensor('float32', new Float32Array(feeds.input_4!.data), [
				1,
				1,
				DTLN_BLOCK_LEN
			]),
			tf_op_layer_stack_5: new FakeTensor('float32', new Float32Array(STATE_SIZE), STATE_SHAPE)
		})
	);
}

async function loadRuntimeWith(sessions: FakeSession[], io: OnnxCleanupIo = IO) {
	const ort = fakeOrt(sessions);
	const { loadOrtWasm } = await import('../ml/ort/ort-loader');
	vi.mocked(loadOrtWasm).mockResolvedValue(ort as never);
	const { DtlnOrtRuntime } = await import('./dtln-ort-runtime');
	const runtime = await DtlnOrtRuntime.create({
		model1Bytes: new Uint8Array([1]),
		model2Bytes: new Uint8Array([2]),
		stateShape: STATE_SHAPE,
		io,
		executionProviders: ['wasm']
	});
	return { runtime, ort };
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

describe('DtlnOrtRuntime', () => {
	it('carries recurrent state across frames and resets it on demand', async () => {
		const seenStates: Float32Array[] = [];
		const model1 = fakeSession(
			['input_2', 'input_3'],
			['activation_2', 'tf_op_layer_stack_2'],
			async (feeds) => {
				seenStates.push(new Float32Array(feeds.input_3!.data));
				return {
					activation_2: new FakeTensor('float32', new Float32Array(feeds.input_2!.data), [
						1,
						1,
						DTLN_FREQ_BINS
					]),
					// Each step increments the state so the next input is observable.
					tf_op_layer_stack_2: new FakeTensor(
						'float32',
						feeds.input_3!.data.map((v) => v + 1),
						STATE_SHAPE
					)
				};
			}
		);
		const { runtime } = await loadRuntimeWith([model1, echoModel2()]);

		await runtime.runModel1(new Float32Array(DTLN_FREQ_BINS).fill(0.5));
		await runtime.runModel1(new Float32Array(DTLN_FREQ_BINS).fill(0.25));
		runtime.resetState();
		await runtime.runModel1(new Float32Array(DTLN_FREQ_BINS));

		expect(seenStates[0]!.every((v) => v === 0)).toBe(true); // initial zeros
		expect(seenStates[1]!.every((v) => v === 1)).toBe(true); // output fed back in
		expect(seenStates[2]!.every((v) => v === 0)).toBe(true); // reset
		expect(runtime.accelerator).toBe('wasm');
	});

	it('feeds the manifest IO names and returns the declared outputs', async () => {
		const customIo: OnnxCleanupIo = {
			model1: {
				magnitudeInput: 'M_IN',
				stateInput: 'S_IN',
				maskOutput: 'M_OUT',
				stateOutput: 'S_OUT'
			},
			model2: { frameInput: 'F_IN', stateInput: 'T_IN', frameOutput: 'F_OUT', stateOutput: 'T_OUT' }
		};
		const model1 = fakeSession(['M_IN', 'S_IN'], ['M_OUT', 'S_OUT'], async (feeds) => {
			expect(Object.keys(feeds).sort()).toEqual(['M_IN', 'S_IN']);
			return {
				M_OUT: new FakeTensor('float32', new Float32Array(DTLN_FREQ_BINS).fill(7), [
					1,
					1,
					DTLN_FREQ_BINS
				]),
				S_OUT: new FakeTensor('float32', new Float32Array(STATE_SIZE), STATE_SHAPE)
			};
		});
		const model2 = fakeSession(['F_IN', 'T_IN'], ['F_OUT', 'T_OUT'], echoModel2().run as RunFn);
		const { runtime } = await loadRuntimeWith([model1, model2], customIo);

		const mask = await runtime.runModel1(new Float32Array(DTLN_FREQ_BINS));
		expect(mask.length).toBe(DTLN_FREQ_BINS);
		expect(mask[0]).toBe(7);
	});

	it('matches a golden small vector through model1 and model2', async () => {
		const model1 = fakeSession(
			['input_2', 'input_3'],
			['activation_2', 'tf_op_layer_stack_2'],
			async (feeds) => ({
				activation_2: new FakeTensor(
					'float32',
					feeds.input_2!.data.map((v) => v * 0.5),
					[1, 1, DTLN_FREQ_BINS]
				),
				tf_op_layer_stack_2: new FakeTensor('float32', new Float32Array(STATE_SIZE), STATE_SHAPE)
			})
		);
		const model2 = fakeSession(
			['input_4', 'input_5'],
			['conv1d_3', 'tf_op_layer_stack_5'],
			async (feeds) => ({
				conv1d_3: new FakeTensor(
					'float32',
					feeds.input_4!.data.map((v) => v * 2),
					[1, 1, DTLN_BLOCK_LEN]
				),
				tf_op_layer_stack_5: new FakeTensor('float32', new Float32Array(STATE_SIZE), STATE_SHAPE)
			})
		);
		const { runtime } = await loadRuntimeWith([model1, model2]);

		const magnitude = Float32Array.from({ length: DTLN_FREQ_BINS }, (_, i) => i);
		const mask = await runtime.runModel1(magnitude);
		expect(mask[0]).toBe(0);
		expect(mask[4]).toBe(2);
		expect(mask[10]).toBe(5);

		const estimated = Float32Array.from({ length: DTLN_BLOCK_LEN }, (_, i) => i + 1);
		const enhanced = await runtime.runModel2(estimated);
		expect(enhanced[0]).toBe(2);
		expect(enhanced[5]).toBe(12);
	});

	it('pins the same-origin WASM runtime and the manifest execution providers', async () => {
		const { ort } = await loadRuntimeWith([
			fakeSession(
				['input_2', 'input_3'],
				['activation_2', 'tf_op_layer_stack_2'],
				async () => ({})
			),
			echoModel2()
		]);
		expect(ort.env.wasm.wasmPaths).toBe('/_ort/');
		expect(ort.InferenceSession.create).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ executionProviders: ['wasm'] })
		);
	});

	it('throws and releases both sessions when a declared IO tensor is missing', async () => {
		const model1 = fakeSession(
			['input_2'],
			['activation_2', 'tf_op_layer_stack_2'],
			async () => ({})
		);
		const model2 = echoModel2();
		const ort = fakeOrt([model1, model2]);
		const { loadOrtWasm } = await import('../ml/ort/ort-loader');
		vi.mocked(loadOrtWasm).mockResolvedValue(ort as never);
		const { DtlnOrtRuntime } = await import('./dtln-ort-runtime');

		await expect(
			DtlnOrtRuntime.create({
				model1Bytes: new Uint8Array([1]),
				model2Bytes: new Uint8Array([2]),
				stateShape: STATE_SHAPE,
				io: IO,
				executionProviders: ['wasm']
			})
		).rejects.toThrow(/input_3/);
		expect(model1.release).toHaveBeenCalledTimes(1);
		expect(model2.release).toHaveBeenCalledTimes(1);
	});

	it('schedules one interleaved model1/model2 call per 128-sample frame', async () => {
		const order: string[] = [];
		const model1 = fakeSession(
			['input_2', 'input_3'],
			['activation_2', 'tf_op_layer_stack_2'],
			async () => {
				order.push('m1');
				return {
					activation_2: new FakeTensor('float32', new Float32Array(DTLN_FREQ_BINS).fill(1), [
						1,
						1,
						DTLN_FREQ_BINS
					]),
					tf_op_layer_stack_2: new FakeTensor('float32', new Float32Array(STATE_SIZE), STATE_SHAPE)
				};
			}
		);
		const model2 = fakeSession(
			['input_4', 'input_5'],
			['conv1d_3', 'tf_op_layer_stack_5'],
			async (feeds) => {
				order.push('m2');
				return {
					conv1d_3: new FakeTensor('float32', new Float32Array(feeds.input_4!.data), [
						1,
						1,
						DTLN_BLOCK_LEN
					]),
					tf_op_layer_stack_5: new FakeTensor('float32', new Float32Array(STATE_SIZE), STATE_SHAPE)
				};
			}
		);
		const { runtime } = await loadRuntimeWith([model1, model2]);

		const dsp = new DtlnDsp();
		const processor = new CleanupJobProcessor(dsp, runtime, { batchFrames: 1000 });
		const frames = 5;
		await processor.push(new Float32Array(frames * DTLN_BLOCK_SHIFT));
		await processor.finalize();

		expect(model1.run).toHaveBeenCalledTimes(frames);
		expect(model2.run).toHaveBeenCalledTimes(frames);
		expect(order).toEqual(['m1', 'm2', 'm1', 'm2', 'm1', 'm2', 'm1', 'm2', 'm1', 'm2']);
	});
});
