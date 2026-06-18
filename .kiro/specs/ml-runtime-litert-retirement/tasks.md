# Tasks — ML runtime: LiteRT/TFLite retirement

> **Plan only — not yet implemented.** All tasks unchecked; a later agent
> implements them. Maps to `requirements.md`. Tasks are ordered by the sequencing
> gates in `design.md` — do not start T3+ before the parity gate (T2) passes.

- [ ] **T1 — (dependency) compositor device adoption (R1.1).** Confirm
      `ml-runtime-compositor-device-adoption` has landed so the ORT matte engine's
      output composites; this gates the matte default flip.
- [ ] **T2 — Pin ONNX matte model + parity proof (R2).** Choose a permissive
      MODNet-class ONNX; fill `public/models/matte-onnx/manifest.json` (real url +
      size + SHA + io); pass the full-WebGPU op-support gate; prove quality +
      performance parity vs the LiteRT MediaPipe Selfie default on the fixture
      matrix; document provenance in the model README. **Gate: do not proceed
      until parity is accepted.**
- [ ] **T3 — Flip matte default (R3.1).** `DEFAULT_MATTE_BACKEND` → `ort-onnx`;
      retire `__MATTE_ONNX_SPIKE__`; keep `matte-temporal.ts` + `matte-resolve.wgsl`.
- [ ] **T4 — Delete LiteRT matte (R4.1).** Remove `matte-engine.ts`,
      `matte-engine.concurrency.test.ts`, `matte/litert-loader.{js,d.ts}`; collapse
      `matte-backend.ts` to the single ORT engine.
- [ ] **T5 — Remove LiteRT ASR fallback (R3.2, R4.2).** Drop the LiteRT entries from
      the ASR `model-catalog` + Auto Captions panel; delete `asr/litert-runtime.ts`
      (+ test), `asr/litert-loader.{js,d.ts}`, and the LiteRT Whisper manifests;
      keep `whisper-decode.ts` + the ORT runtime.
- [ ] **T6 — Remove LiteRT DTLN fallback (R3.2, R4.3).** Drop the LiteRT option from
      the Audio Cleanup panel; delete `audio-cleanup/dtln-runtime.ts` (+ test) and
      `public/models/dtln/`; keep the ORT DTLN runtime.
- [ ] **T7 — Drop the LiteRT dependency + assets (R4.4).** Remove `@litertjs/core`
      from `package.json` + lockfile, `scripts/setup-litert-assets.mjs`, the
      `setup:litert` + `postinstall` scripts, and vendored `public/litert/`.
- [ ] **T8 — Diagnostics & types cleanup (R5).** `mlRuntime` enum → `'ort'` only;
      `buildWorkerDiagnosticSnapshot` / `mlRuntimeSummary` report `'ort'`
      unconditionally; remove LiteRT probes/rows; retire `compositesOnRendererDevice`
      (only ORT remains, and the compositor adopts ORT's device).
- [ ] **T9 — Docs (R6).** `docs/ML-RUNTIME.md` → ORT-only (keep #26107 device
      ownership + EP policy); update Phase 29/31 + audio-cleanup specs/READMEs.
- [ ] **T10 — Verify (R7).** Full quality gate green; manual matrix for matte
      (ONNX) / Auto Captions (ORT) / Audio Cleanup (ORT); a fresh `pnpm install`
      fetches no LiteRT assets; `grep -riE 'litert|tflite|@litertjs' src/ public/
      scripts/ package.json` returns only historical spec text.

## Dependencies

- Builds on `ml-runtime-ort-device-ownership` (merged, PR #121).
- **T1–T4 depend on** `ml-runtime-compositor-device-adoption` landing first.
- T5–T6 are independent (ORT is already the default for ASR/DTLN) but are one-way
  removals of the rollback — confirm the ORT defaults are regression-free first.
