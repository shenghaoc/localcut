/** Phase 32b: Beauty ORT runtime wrapper.
 *
 *  Wraps ORT sessions for the face detector and landmark ONNX models.
 *  Execution-provider ladder: webgpu -> webnn (only after per-model proof)
 *  -> wasm (explicit reduced/export-only path).
 *  Deterministic disposal and explicit compile errors.
 */

import type { BeautyExecutionProvider } from '../../protocol';
import type { BeautyModelManifest } from './model-manifest';

// ─── Types ──────────────────────────────────────────────────────────────

export interface BeautyRuntimeOptions {
	/** Digest-verified ONNX model bytes keyed by manifest asset role. */
	assetBytes: {
		detector: ArrayBuffer;
		landmarks: ArrayBuffer;
		blendshape?: ArrayBuffer;
	};
	/** Preferred execution provider (fallback ladder applied automatically). */
	executionProvider: BeautyExecutionProvider;
	/** Model manifest for metadata and tensor contracts. */
	manifest: BeautyModelManifest;
	/** ORT-WebGPU availability from the Phase 8/26 probe. */
	webgpuAvailable?: boolean;
	/** Per-model ORT-WebNN support proof. False by default. */
	webnnModelSupported?: boolean;
	/** Allow ORT-WASM as an explicit reduced/export-only path. */
	allowWasmReducedPath?: boolean;
}

export type BeautyRuntimeStatus = 'initializing' | 'ready' | 'failed' | 'disposed';

export interface BeautyInferenceResult {
	/** Primary face landmarks [topology landmark count × 3] in normalized clip-local coords. */
	landmarks: Float32Array;
	/** Detection confidence [0, 1]. */
	confidence: number;
	/** Face bounding box [x, y, w, h] normalized. */
	box: [number, number, number, number];
	/** Face ID for temporal continuity. */
	faceId: string;
}

/**
 * Opaque handle to an ORT session pair (detector + landmarks).
 * The implementation must lazy-load onnxruntime-web through a worker-only
 * boundary after explicit user action; importing this module must not pull ORT
 * chunks into startup.
 */
export interface BeautySession {
	/** Selected execution provider after fallback. */
	readonly executionProvider: BeautyExecutionProvider;
	/** Current status. */
	readonly status: BeautyRuntimeStatus;
	/**
	 * Run inference on compact preprocessed input tensors.
	 * @param detectorInput - Detector input tensor from the manifest contract.
	 * @param landmarkInput - Landmark input tensor from the manifest contract.
	 * @returns Inference result, or null if no face detected.
	 */
	infer(detectorInput: Float32Array, landmarkInput: Float32Array): BeautyInferenceResult | null;
	/** Dispose of all resources. Idempotent. */
	dispose(): void;
}

// ─── Execution provider fallback ────────────────────────────────────────

const EXECUTION_PROVIDER_LADDER: BeautyExecutionProvider[] = ['webgpu', 'webnn', 'wasm'];

/** Try execution providers in order, returning the first allowed provider. */
export function resolveExecutionProvider(
	preferred: BeautyExecutionProvider,
	options: Pick<
		BeautyRuntimeOptions,
		'webgpuAvailable' | 'webnnModelSupported' | 'allowWasmReducedPath'
	> = {}
): BeautyExecutionProvider {
	const startIdx = Math.max(0, EXECUTION_PROVIDER_LADDER.indexOf(preferred));
	for (let i = startIdx; i < EXECUTION_PROVIDER_LADDER.length; i++) {
		const executionProvider = EXECUTION_PROVIDER_LADDER[i]!;
		if (executionProvider === 'webgpu' && !options.webgpuAvailable) continue;
		if (executionProvider === 'webnn' && !options.webnnModelSupported) continue;
		if (executionProvider === 'wasm' && !options.allowWasmReducedPath) continue;
		return executionProvider;
	}
	throw new Error('No supported ORT execution provider for Beauty inference');
}

// ─── Session creation ───────────────────────────────────────────────────

/**
 * Create a beauty session.
 *
 * **TODO (T1.2):** This is a scaffolding stub. The actual implementation must:
 * 1. Lazy-load `onnxruntime-web` after explicit user action
 * 2. Create detector and landmark sessions with the resolved execution provider
 * 3. Wire `infer()` to run detector -> primary ROI -> landmark inference
 * 4. Decode model outputs through tested detector/landmark output contracts
 * 5. Report reduced/export-only WASM explicitly instead of hiding fallback
 *
 * The stub returns a session where `infer()` always returns `null`, which means
 * the beauty effect will not produce any face landmarks until the real ORT
 * integration is implemented.
 *
 * @throws {Error} If session creation has no allowed execution provider.
 */
export async function createBeautySession(options: BeautyRuntimeOptions): Promise<BeautySession> {
	const executionProvider = resolveExecutionProvider(options.executionProvider, options);

	// TODO: Replace with real ORT session creation.
	// The stub returns null from infer(), which means no landmarks are produced.
	const session: BeautySession = {
		executionProvider,
		status: 'initializing',
		infer: () => null, // TODO: implement detector -> landmark ONNX pipeline
		dispose: () => {
			(session as { status: BeautyRuntimeStatus }).status = 'disposed';
		}
	};

	// Mark as ready after construction
	(session as { status: BeautyRuntimeStatus }).status = 'ready';
	return session;
}
