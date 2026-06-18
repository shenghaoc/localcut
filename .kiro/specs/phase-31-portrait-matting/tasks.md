# Tasks: Phase 31 - Portrait Video Matting

- [x] **T1 - ORT manifest and model provenance.** Pinned the Apache-2.0 MODNet ONNX
      model in `public/models/matte-onnx/manifest.json`; documented provenance in
      the model README.
- [x] **T2 - Manifest validator.** `validateMatteOnnxManifest` enforces ONNX
      format, WebGPU-only EP, GPU-buffer output, permissive license, non-template
      manifest, RGB FP32 input, and single-channel unit alpha output.
- [x] **T3 - GPU preprocess.** `matte-onnx-preprocess.wgsl` imports the source
      frame as an external texture, resizes to model dimensions, normalizes, and
      writes NCHW/NHWC FP32 input into a GPU buffer.
- [x] **T4 - ORT runtime.** `MatteOnnxEngine` lazy-loads ORT-WebGPU, fetches and
      verifies the model, creates a session, and wraps input/output as GPU
      buffers.
- [x] **T5 - ORT device adoption.** The worker adopts the renderer to ORT's
      `GPUDevice` before matte output is considered compositable.
- [x] **T6 - Resolve and temporal smoothing.** `matte-resolve.wgsl` and
      `matte-temporal.ts` provide the alpha texture, EMA smoothing, and reset
      policy used by preview and export.
- [x] **T7 - UI integration.** Inspector controls retain remove/replace/blur
      modes, strength, blur radius, and visible model status.
- [x] **T8 - Cleanup of retired path.** PR #123 removed the old matte runtime,
      loader, manifest, public model directory, and retired preprocess shader.
- [x] **T9 - Tests.** Manifest, backend, engine lifecycle, concurrency, temporal,
      and no-startup-load coverage remains with the ORT runtime.
- [ ] **T10 - Manual browser matrix.** Validate on hardware WebGPU: first model
      load, preview matte, export matte, seek reset, model fetch failure, and
      reduced-tier unavailable behaviour.
