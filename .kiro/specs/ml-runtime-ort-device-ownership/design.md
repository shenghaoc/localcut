# Design — ML runtime: ORT-owned GPU device + unify-on-ORT policy

## Key insight: we had the device direction backwards

The foundation was built assuming ORT could run on a caller-supplied `GPUDevice`
(inject the compositor's device → `deviceOwner: 'renderer'`). It cannot.
[microsoft/onnxruntime#26107][ort-26107] (open): *"The `device` specified in
`ort.env.webgpu` will not be used at runtime"* — ORT ignores the injected device
and creates its own internally, and a GPU buffer created on a different device then
fails ORT's tensor validation (`Buffer is associated with [Device '…'], and cannot
be used with [Device]`).

So the only workable direction is the inverse of LiteRT's:

```
LiteRT:  compositor creates GPUDevice ──▶ LiteRT adopts it          (works)
ORT:     ORT creates GPUDevice ──▶ renderer adopts ort.env.webgpu.device
```

`ort.env.webgpu.device` is **read-back-only** for the WebGPU EP: writing it is
ignored, reading it (after a session is created) yields the device ORT built. The
session wrapper returns that as `OrtSessionHandle.device`.

[ort-26107]: https://github.com/microsoft/onnxruntime/issues/26107

## Foundation changes (`src/engine/ml/ort/`)

- `ort-types.ts` — `OrtDeviceOwner` drops `'renderer'` → `'ort-webgpu' |
  'webnn-context'`. Doc comment cites #26107.
- `ort-session.ts` —
  - `CreateOrtSessionOptions.device` removed (WebGPU is always ORT-owned). The
    WebNN `mlContext` path is untouched.
  - `resolveDeviceOwner(primaryEp, hasMlContext)` — WebGPU ⇒ always `'ort-webgpu'`;
    WebNN ⇒ `'webnn-context'` iff an `MLContext` was supplied; else `undefined`.
  - The `ort.env.webgpu.device = options.device` injection is deleted; `device` is
    read back via `await ort.env.webgpu.device` and returned in the handle.

## Engine changes (frame-coupled ORT-WebGPU)

`matte-onnx-engine.ts`, `interpolation-engine.ts`, `beauty-engine.ts` previously
took a `device` option and injected it. Now each:

- drops the `device` option;
- adopts ORT's device in `loadModel`/`loadModels` (`this.device = handle.device`,
  with a clear error if the WebGPU session exposed none);
- runs its own preprocess/resolve/postprocess WGSL passes on that ORT-owned device;
- guards `this.device` as nullable (set post-load; methods that use it run only
  after the model is loaded) and nulls it on `dispose`.

The worker (`src/engine/worker.ts`) stops passing `renderer.gpuDevice` to these
three engines. The **LiteRT** `MatteEngine` still receives `renderer.gpuDevice` —
LiteRT *can* adopt an external device, which is why it was chosen originally.

`face-detector-ort.ts` (non-frame-coupled, WASM-capable, no compositor device)
drops its unused `device` option; ORT owns its device as before.

## Why unify on ORT (one runtime, three EPs)

ORT Web ships a single JSEP binary (`ort-wasm-simd-threaded.jsep.wasm`, ~26 MB,
proxied same-origin at `/_ort/`) that backs WebGPU **and** WebNN **and** WASM — the
EP is chosen per session. Two facts make carrying LiteRT alongside pure
duplication:

1. The WASM EP is the universal floor we can't ditch (older browsers,
   software-rendered/headless, locked-down enterprise), and it's already in the
   binary we load for WebGPU — no extra download.
2. LiteRT is a *second* ML runtime for capabilities ORT already covers.

Hence the policy: run as much as possible on the one ORT runtime, retire LiteRT.

## Model sourcing (direct from ONNX, not R2)

R2 was speculatively allowlisted but never wired (`src/worker/index.ts` only has
`/_model/{hf,gh,gcs}/`). Models come straight from `onnx-community` on Hugging
Face via `/_model/hf`. `ORT_TRUSTED_MODEL_HOSTS` drops the two R2 suffixes; the
asset-loader tests assert R2 is now rejected; template manifests + model READMEs
drop "or a Cloudflare R2 bucket". The runtime-WASM self-host note no longer
singles out R2.

## Scope boundary (what this spec does NOT do)

- **Compositor single-device adoption.** The three engines now produce output on
  *ORT's* device, but the compositor (`PreviewRenderer`, ~30 `readonly`
  device-bound pipelines) still runs on its own device. A live device-swap is a
  feature-sized change and these engines are double-gated off (spike flag +
  template manifest), so it is deferred to `ml-runtime-compositor-device-adoption`.
  Nothing composites ORT output today, so there is no live device mismatch.
- **Removing LiteRT code.** Matte is still LiteRT-default with no license-verified
  ONNX replacement (its ONNX manifest is a `template`). Deferred to
  `ml-runtime-litert-retirement`.

## Risk / verification

Engine GPU paths need real WebGPU hardware, so the engine tests are source-contract
+ scheduling/lifetime tests (the established pattern). The full quality gate
(format + lint + typecheck + 2400 unit tests + production build) is green; deployed
behaviour is unchanged because the affected engines are disabled by gate.
