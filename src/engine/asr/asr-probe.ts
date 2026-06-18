/**
 * ASR capability probe (Phase 29, ORT Whisper). The shipped ONNX Whisper models
 * run on ORT-WASM, so availability is gated on `WebAssembly` support. WebGPU,
 * experimental WebNN, and cross-origin isolation are reported for information
 * only and never gate the feature.
 *
 * Side-effect free: no model load, no graph build, no WASM instantiation.
 */
import type { AsrProbeResult, FeatureSupport } from '../../protocol';

function fromBoolean(value: boolean): FeatureSupport {
	return value ? 'supported' : 'unsupported';
}

function probeWasm(): FeatureSupport {
	try {
		return fromBoolean(
			typeof WebAssembly !== 'undefined' && typeof WebAssembly.instantiate === 'function'
		);
	} catch {
		return 'unknown';
	}
}

function probeWebGpu(): FeatureSupport {
	try {
		return fromBoolean(typeof navigator !== 'undefined' && 'gpu' in navigator);
	} catch {
		return 'unknown';
	}
}

function probeWebNN(): FeatureSupport {
	try {
		const nav =
			typeof navigator === 'undefined' ? null : (navigator as Navigator & { ml?: unknown });
		return fromBoolean(nav !== null && nav.ml !== undefined);
	} catch {
		return 'unknown';
	}
}

export function probeAsr(): AsrProbeResult {
	const wasm = probeWasm();
	return {
		wasm,
		webgpu: probeWebGpu(),
		webnn: probeWebNN(),
		crossOriginIsolated: globalThis.crossOriginIsolated === true,
		recommended: wasm === 'supported' ? 'ort-whisper' : 'none'
	};
}

export function asrAvailable(result: AsrProbeResult): boolean {
	return result.recommended !== 'none';
}

export const ASR_UNAVAILABLE_MESSAGE =
	'Auto captions require WebAssembly, which is unavailable in this browser.';

export const ASR_ACCURACY_NOTE =
	'On-device Whisper runs through ONNX Runtime Web. The shipped int8 models use ORT-WASM; the first run downloads the selected model once, then caches it for offline reuse.';
