# Tasks: ML Runtime - LiteRT/TFLite Retirement

- [x] **T1 - Confirm compositor adoption dependency.** PR #122 landed
      `.kiro/specs/ml-runtime-compositor-device-adoption/` and the renderer now
      adopts ORT's `GPUDevice`, so frame-coupled ORT matte output can composite.
- [x] **T2 - Pin ONNX matte model.** `public/models/matte-onnx/manifest.json`
      pins `onnx-community/modnet-webnn` (`onnx/model.onnx`, Apache-2.0,
      25,888,640 bytes,
      `sha256-07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9`)
      with a 256x256 NCHW signed-unit input and unit alpha output contract.
- [x] **T3 - Flip matte default to ORT.** `DEFAULT_MATTE_BACKEND` is `ort-onnx`;
      the spike flag is gone; `matte-temporal.ts` and `matte-resolve.wgsl` stay.
- [x] **T4 - Delete retired matte path.** Removed `src/engine/matte/matte-engine.ts`,
      `src/engine/matte/matte-engine.concurrency.test.ts`,
      `src/engine/matte/litert-loader.{js,d.ts}`, retired matte manifest/tests,
      `public/models/matte/`, and `src/engine/shaders/matte-preprocess.wgsl`;
      `matte-backend.ts` now selects the single ORT engine.
- [x] **T5 - Remove ASR fallback.** The ASR catalog contains only ORT Whisper;
      protocol/probe/controller/panel/diagnostic copy use `ort-whisper`; retired
      runtime, loader, manifest tests, and `public/models/whisper/` are gone.
- [x] **T6 - Remove DTLN fallback.** Audio Cleanup exposes only ORT DTLN;
      `CleanupBackendKind` is `'ort'`; `cleanup-bridge.ts` always spawns
      `cleanup-ort-worker.ts`; `App.tsx` points to
      `models/dtln-onnx/manifest.json`; deleted the retired DTLN runtime,
      retired worker, retired manifests/tests, `public/models/dtln/`, and
      `scripts/verify-dtln-onnx-parity.mjs`.
- [x] **T7 - Drop dependency/assets/build hooks.** Removed `@litertjs/core` from
      package metadata, deleted `scripts/setup-litert-assets.mjs`, removed
      setup/postinstall hooks, deleted `public/litert/`, removed
      `litertRuntimeAssetsPlugin()`, and removed Workbox runtime caches for the
      retired runtime/model paths.
- [x] **T8 - Collapse diagnostics and UI.** `mlRuntime` is ORT-only; capability
      and panels no longer advertise retired engine choices; matte composition
      relies on ORT device adoption.
- [x] **T9 - Update docs/specs.** Updated `docs/ML-RUNTIME.md`,
      `docs/USER-GUIDE.md`, bundled user-guide markdown under
      `src/features/docs/content/`, model READMEs, and active Phase 28/29/31/40
      specs to describe the ORT-only runtime state.
- [x] **T10 - Verify current-reference scope.** Grep excludes only intentional
      historical specs and Smart Reframe's out-of-scope MediaPipe Tasks Vision
      model path; current `src/`, `public/`, docs, package, and Vite config do not
      retain retired runtime code paths.
- [x] **T11 - Final validation.** Run install/lockfile update, typecheck, relevant
      unit tests, build/check, then re-fetch PR #123 review threads after push.
