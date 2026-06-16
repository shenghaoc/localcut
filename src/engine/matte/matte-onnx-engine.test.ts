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

	it('injects the renderer device (shared-device, deviceOwner: renderer)', () => {
		expect(engineSource).toContain('device: this.device');
	});

	it('shares the EMA temporal contract + resolve shader with the LiteRT engine', () => {
		expect(engineSource).toContain("from './matte-temporal'");
		expect(engineSource).toContain('shouldResetMatteHistory');
		expect(engineSource).toContain('MATTE_TEMPORAL_SMOOTHING');
		// The resolve pass (EMA smoothing + reset) is shared verbatim, not forked.
		expect(engineSource).toContain('matte-resolve.wgsl');
	});
});
