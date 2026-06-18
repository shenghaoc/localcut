import { describe, expect, it } from 'vite-plus/test';

import engineSource from './matte-onnx-engine.ts?raw';

/**
 * The ORT matte engine's per-frame path runs only on hardware WebGPU with a real
 * pinned ONNX model, so it can't be exercised in the node/CI test env. These
 * source-contract assertions guard the architectural invariants at the
 * module-graph/source level instead — the same approach as
 * `src/engine/ml/ort/no-startup-load.test.ts`.
 */

/** Matches a static, top-level `import ... from 'onnxruntime-web[...]'` (not `import type`). */
const STATIC_ORT_IMPORT = /^import\s+(?!type\b)[^;]*from\s+['"]onnxruntime-web/m;

describe('MatteOnnxEngine — zero-copy hot path (source contract)', () => {
	it('never reads tensors back to the CPU on the per-frame path', () => {
		// No GPU→CPU readback APIs anywhere in the engine: ORT `getData()`/`toArray()`
		// on a tensor, or a buffer `mapAsync`, would defeat the zero-copy contract.
		expect(engineSource).not.toMatch(/\.getData\s*\(/);
		expect(engineSource).not.toMatch(/\.toArray\s*\(/);
		expect(engineSource).not.toMatch(/\.mapAsync\s*\(/);
	});

	it('wires ORT GPU-buffer tensor IO (fromGpuBuffer in, gpu-buffer out)', () => {
		expect(engineSource).toContain('fromGpuBuffer');
		expect(engineSource).toContain('gpuBuffer');
		expect(engineSource).toContain("tensorLocation: 'gpu-buffer'");
	});

	it('reaches onnxruntime-web only lazily (type-only import; runtime via the loader)', () => {
		// The runtime is loaded through ort-loader's dynamic import, never a static
		// top-level `import ... from 'onnxruntime-web'` (which would bloat the bundle).
		expect(engineSource).not.toMatch(STATIC_ORT_IMPORT);
		expect(engineSource).toMatch(/^import type\s+\{[^}]*\}\s+from\s+'onnxruntime-web';/m);
		expect(engineSource).toContain('loadOrtWebGpu');
	});

	it("lets ORT own the device and adopts it for the engine's own WGSL passes (never injects a device — onnxruntime#26107)", () => {
		// ORT ignores an injected `env.webgpu.device`, so the engine must NOT pass a
		// device into the session; it adopts the ORT-created device for its own passes.
		expect(engineSource).not.toContain('device: this.device');
		expect(engineSource).toContain('this.device = handle.device');
	});

	it('shares the EMA temporal contract + resolve shader with the LiteRT engine', () => {
		expect(engineSource).toContain("from './matte-temporal'");
		expect(engineSource).toContain('shouldResetMatteHistory');
		expect(engineSource).toContain('MATTE_TEMPORAL_SMOOTHING');
		// The resolve pass (EMA smoothing + reset) is shared verbatim, not forked.
		expect(engineSource).toContain('matte-resolve.wgsl');
	});

	it('frees GPU resources on a resolve-pass failure / device loss', () => {
		// A pre-submit WebGPU throw destroys the alpha texture (the catch), and the
		// output tensors are disposed via `.finally` so an onSubmittedWorkDone
		// rejection (device loss) still frees them — never the leak-prone `.then`.
		expect(engineSource).toContain('alphaTexture.destroy()');
		expect(engineSource).toMatch(/onSubmittedWorkDone\(\)\.finally\(/);
		expect(engineSource).not.toMatch(/onSubmittedWorkDone\(\)\.then\(/);
	});

	it('validates the ONNX output element count before binding the alpha buffer', () => {
		// A model whose output isn't the declared single-channel W×H must fail with a
		// clear contract error, not silently corrupt the matte / read past the buffer.
		expect(engineSource).toContain('produced !== expected');
	});
});
