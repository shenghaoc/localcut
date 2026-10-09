/** Keep the public cache keys and the CDN target tied to the pinned ORT package. */
export const ORT_RUNTIME_VERSION = '1.30.0';
export const ORT_PROXY_ROOT = '/_ort/';
export const ORT_WASM_BASE_PATH = `${ORT_PROXY_ROOT}${ORT_RUNTIME_VERSION}/`;
export const ORT_RUNTIME_BASE = `/npm/onnxruntime-web@${ORT_RUNTIME_VERSION}/dist/`;
export const ORT_RUNTIME_CACHE_NAME = `ort-runtime-${ORT_RUNTIME_VERSION}`;
