# AI Agent Quickstart (Kiro Workflow)

Use this file as a **thin router**. Read steering before coding; specs live under `.kiro/specs/`.

## Read steering first

- [**Product vision**](.kiro/steering/product.md) — client-compute NLE for mid-tier creators; performance is the product.
- [**Architecture**](.kiro/steering/architecture.md) — accelerated pipeline, capability tiers, compatibility paths, development phases.
- [**Technical constraints**](.kiro/steering/tech.md) — SolidJS + Vite, Mediabunny, WebGPU/WebCodecs, Cloudflare static PWA.
- [**Repository structure**](.kiro/steering/structure.md) — `src/ui/` vs `src/engine/`, naming, layout.
- [**UI standards**](.kiro/steering/ui-standards.md) — dark professional-tool aesthetic, bespoke timeline.
- [**Code style**](.kiro/steering/style.md) — TypeScript strict conventions, SolidJS patterns, naming, CSS.
- [**Testing standards**](.kiro/steering/testing.md) — Vitest scope, mocking strategy, quality gate.
- [**Accessibility**](.kiro/steering/accessibility.md) — ARIA patterns, keyboard nav, contrast, focus management.
- [**Security**](.kiro/steering/security.md) — COOP/COEP, file handling, no secrets, user data policy.
- [**Review policy**](.kiro/steering/review.md) — Kiro/Claude review process + output format (`#review`); priorities live in [Review guidelines](#review-guidelines) below.

## Workspace MCP config

[`.kiro/settings/mcp.json`](.kiro/settings/mcp.json) — workspace MCP server configuration.

## Skills

Reusable packs in [`.kiro/skills/`](.kiro/skills/):

- **web-design-guidelines** — Web Interface Guidelines compliance checker.
- **solid-patterns** — SolidJS reactivity and main-thread UI conventions for this project.

## Specs (`.kiro/specs/`)

Each spec has `design.md`, `requirements.md`, and `tasks.md` (bugfix specs use `bugfix.md` instead of `requirements.md`).

**Active:**

- [**ML runtime: MediaPipe Tasks-Vision retirement**](.kiro/specs/ml-runtime-mediapipe-retirement/tasks.md) — final unify-on-ORT implementation: Smart Reframe face detection moves off the old MediaPipe Tasks Vision package to the ORT face-detector path (`face-detector-ort.ts` + `reframe-face` ONNX manifest), then deletes the MediaPipe dependency/assets/loader/copy. Non-frame-coupled analysis remains worker-side on ORT-WASM/CPU tensors; saliency remains the default fallback until the model is explicitly loaded. Leaves ORT as the sole ML runtime with PR123's LiteRT/TFLite retirement.

- [**ML runtime: compositor single-device adoption**](.kiro/specs/ml-runtime-compositor-device-adoption/tasks.md) — follow-up to the ORT device-ownership work: make `PreviewRenderer` adopt ORT's `GPUDevice` (it can't be injected — [onnxruntime#26107](https://github.com/microsoft/onnxruntime/issues/26107)) so frame-coupled ORT-WebGPU output (matte/interpolation/beauty) composites zero-copy on one device. Lazy renderer rebuild on `ort.env.webgpu.device` on first ORT-WebGPU activation; flips the `compositesOnRendererDevice` gate so the worker composites those views; preserves no-startup-load.

- [**ML runtime: LiteRT/TFLite retirement**](.kiro/specs/ml-runtime-litert-retirement/tasks.md) — implements the unify-on-ORT policy in code: portrait matte now loads the Apache-2.0 MODNet ONNX manifest on ORT-WebGPU, ASR and DTLN expose only ORT engines, diagnostics collapse to `mlRuntime: 'ort'`, and the old runtime dependency/assets/loaders/manifests/scripts are removed. The ORT-WASM floor stays for small non-frame-coupled models.

- [**Phase 47: WHIP Publish**](.kiro/specs/phase-47-whip-publish/tasks.md) — RFC 9725 WHIP client over RTCPeerConnection; bearer-token endpoints; H.264 baseline default with probed AV1; encoder-session budget gating record+stream; ICE restart/reconnect policy; clean HTTP DELETE teardown; MediaMTX CI integration test.

- [**Phase 48: OpenTimelineIO export**](.kiro/specs/phase-48-otio-export/tasks.md) — TypeScript `ProjectDoc` → `.otio` serialiser (tracks, gaps, clips with P23 fingerprints, markers, transitions); `metadata.localcut` round-trip namespace; `project.otio` in the bundle root beside authoritative `project.json`; cuts-only CMX3600 EDL; documented `otioconvert` path for AAF/FCPXML.

- [**Phase 33: Smart Reframe**](.kiro/specs/phase-33-smart-reframe/tasks.md) — automatic crop-path generation between aspect ratios (16:9 ↔ 9:16, 1:1, 4:5); optional click-to-load ORT/ONNX face detection via the pinned UltraFace RFB-320 manifest; pure-DSP saliency fallback (and default until the model is loaded); IoU-tracked primary subject with One Euro smoothing; shot-boundary detection via histogram difference; output as editable Phase 15 transform keyframes with velocity/acceleration bounds; review/apply overlay.

- [**Phase 31: Portrait Video Matting**](.kiro/specs/phase-31-portrait-matting/tasks.md) — per-clip person matting (remove/replace/blur) running zero-copy on ORT's adopted `GPUDevice`: VideoFrame → `importExternalTexture` → preprocess WGSL (NCHW/NHWC, manifest-`inputRange` normalize) → ORT-WebGPU GPU-buffer tensor IO → resolve WGSL (rgba8unorm alpha + EMA smoothing) → Phase 12 compositor. Deployed model is Apache-2.0 MODNet ONNX loaded via the same-origin `/_model/hf/` proxy + OPFS/SHA-256 cache; recurrent-state reset policy; P19 proxy preview + guided-upsample export; project schema v15.

- [**Phase 37: Frame Interpolation**](.kiro/specs/phase-37-frame-interpolation/tasks.md) — RIFE-class learned interpolation on **ONNX Runtime Web (ORT-WebGPU)**, built on the shared ORT foundation (`src/engine/ml/ort/`): `VideoFrame`→`importExternalTexture`→preprocess WGSL→`ort.Tensor.fromGpuBuffer`→`session.run` (`gpu-buffer` output)→postprocess WGSL, on ORT's adopted `GPUDevice` (zero-copy, no CPU readback). Frame-coupled EP gate forbids WASM/CPU fallback. Smooth slow-motion `synthesize` mode for Phase 35 ramps, fps upconversion at export (24→60), optional flow-field motion blur; render-cache-backed with mode/factor/EP invalidation; export-only below the high tier, bounded-segment preview on the high tier; probe-driven tiling bounds VRAM at 1080p/4K; ≤4× factor cap; probe-derived time estimate (states EP) before every run; Phase 33 shot-boundary refusal. Ships a `template` manifest (feature hidden) until a license-verified ONNX model passes the full-WebGPU op-support gate.

- [**Phase 40: On-Device Language Tools**](.kiro/specs/phase-40-on-device-language-tools/tasks.md) — progressive enhancement on Chrome's built-in AI; Translator + LanguageDetector translate Phase 22/29 caption tracks into a timing-identical second track for bilingual zh/en sidecar export; Summarizer + Prompt draft titles/hashtags/文案 from a transcript into a copyable panel; feature + model-download lifecycle detection (`downloadable`/`downloading`/`available`) with progress UX; entire surface hidden (no errors, no nags) when unavailable; on-device only, no cloud fallback; main-thread (no pipeline-worker/GPU coupling); cross-browser small-model runtime path remains deferred after the ORT consolidation.

- [**Bugfix: Post-merge editor chrome cleanup**](.kiro/specs/bugfix-post-merge-chrome-cleanup/tasks.md) — restore the editor chrome after rapid PR-merger churn left the workspace grid with four children in three column tracks (preview collapsed to ~320×292 in the top-right; side rail wrapped to a second row at the left); wrap MediaBin + BeatPanel in a single `<aside class="dock-left">` so the grid stays 3-column; rewrite the `:root` design tokens to a precision-instrument palette (single cyan accent, hairline edges, integer-px type scale, ruthless JetBrains Mono for technical readouts); split the toolbar pipeline strip into state chips and tool buttons; replace the gradient brand circle with an inline-SVG reticle; calibration-grid preview empty state with cyan corner brackets.

- [**Bugfix: Merged-phase review-comment fix-up**](.kiro/specs/bugfix-merged-phase-review-comments/tasks.md) — cross-phase audit (Phase 1–48) of unresolved Codex/Gemini review-bot findings; bundles 34 actionable bugs into one fix-up PR. Highlights: Phase 38 GPU pingPong / f16 / halation-radius / timeline-time grain; Phase 21 source colour metadata wiring; Phase 13 transition preservation + tests; Phase 22/20 export+overwrite gates; Phase 32a Inspector UX; Phase 23/24 replace-modal + queue-picker activation; Phase 38 Lottie/animated-image hardening + atomic preset; Phase 40 stale-detector + structured error; Phase 47 WHIP spec corrections; in-app docs content. Historical runtime-coupled exclusions have since been superseded by the ORT consolidation.

- [**Bugfix: IMG_6213.mov media handling**](.kiro/specs/bugfix-img-6213-media-issues/tasks.md) — apply rotation metadata on placement, rotation-aware fit rect, VFR-aware frame cadence, codec-named warnings, Media Bin details popover, user-guide updates.

- [**Bugfix: Phase 29 LiteRT WASM Whisper**](.kiro/specs/bugfix-phase-29-litert-wasm-whisper/tasks.md) — historical Auto Captions runtime spec, superseded by the ORT Whisper manifests in `public/models/whisper-onnx/` and the PR123 runtime consolidation.

- [**Bugfix: Phase 29 Whisper ONNX backend**](.kiro/specs/bugfix-phase-29-whisper-onnx-backend/tasks.md) — Auto Captions on **ONNX Runtime Web**: int8-quantized `onnx-community/whisper-{base,tiny}` encoder + no-past decoder on the ORT-WASM EP, reusing `whisper-decode.ts`; default at ~77 MB (base) with ~41 MB tiny option; `runtime: "ort-whisper"` manifest discriminator routes the worker; SHA-256/OPFS/explicit-load/offline/no-startup-load preserved; ORT reached only via the lazy `ort-loader`.

- [**Bugfix: Whisper-tiny decode quality**](.kiro/specs/bugfix-whisper-tiny-decode-quality/tasks.md) — manifest-configurable decode thresholds (`logProbThreshold`, `noSpeechThreshold`, `compressionRatioThreshold`, `temperatures`) so whisper-tiny's lower-confidence predictions don't trigger the silence gate or temperature fallback on real speech; tuned tiny params ship in `manifest-tiny.json`.

- [**Bugfix: Mixed-rate audio resampling**](.kiro/specs/bugfix-mixed-rate-audio/tasks.md) — streaming polyphase sinc resampler complementing Mediabunny; per-call target-rate `pcmWindowAt`/`pcmAt`; canonical playback ring rate; anti-aliased downsample; source-health + docs.

- [**Bugfix: Remove Chrome Speech fallback (Phase 29)**](.kiro/specs/bugfix-phase-29-asr-availability/tasks.md) — delete the dead Chrome Speech service (adapter, ambient typings, `speechRecognition` probe field, "Browser Speech disabled" UI copy); there is no browser-speech fallback for selected-clip ASR. Auto Captions now use ORT Whisper when WebAssembly is available.

- [**Phase 26: Cross-browser compatibility engine**](.kiro/specs/phase-26-cross-browser-compatibility-engine/tasks.md) — CapabilityTierV2 probes, reduced-tier diagnostics, optional-SAB worker init, codec/export constraints, compatibility resource-lifetime helpers.

- [**Phase 27: Local Audio Cleanup with WebNN RNNoise**](.kiro/specs/phase-27-webnn-audio-cleanup/tasks.md) — optional/experimental on-device noise suppression; WebNN probe + capability row; lazy, cancellable Audio Cleanup worker separate from the pipeline worker; checksummed RNNoise weights loaded only on explicit user action; TypeScript DSP port + WebNN GRU graph; undoable cleaned-audio assets through playback/export. Foundation implemented; Inspector badge + manual browser matrix pending.

- [**Bugfix: Phase 28 LiteRT DTLN Audio Cleanup**](.kiro/specs/bugfix-phase-28-litert-dtln/tasks.md) — historical DTLN migration spec, superseded by the ORT DTLN worker and `public/models/dtln-onnx/manifest.json` after PR123.

- [**Phase 23: Project packaging + portability**](.kiro/specs/phase-23-project-packaging/tasks.md) — directory bundles, fingerprint dedup, integrity validation, collect media, import/export.

- [**Phase 41: Capture Engine**](.kiro/specs/phase-41-capture-engine/tasks.md) — recording as a first-class source: `getDisplayMedia`/`getUserMedia` acquisition; MSTP → WebCodecs realtime encode in the worker; crash-safe fragmented-MP4 chunks to OPFS via `SyncAccessHandle` + chunk manifest; boot recovery scan; screen/webcam/mic/system-audio as separate VFR-honest tracks; quota preflight + graceful stop; accelerated-tier gated.

- [**Phase 35: Time Remapping**](.kiro/specs/phase-35-time-remapping/tasks.md) — per-clip keyframed speed curves (0.25×–4×) with Hermite-smoothstep easing; pre-sampled monotone LUT (1/120 s steps, Simpson integration) for O(1) output→source time lookup; WSOLA pitch-preserving time-stretch in the worker; VFR-correct frame scheduling on real timestamps; Phase 19 render-cache invalidation via `timeRemapHash`; preview/export parity through one shared time-mapping module.

- [**In-app User Guide**](.kiro/specs/feature-in-app-user-guide/tasks.md) — routed, user-facing guide at `/docs` replacing the modal HelpPanel; ten bundled markdown sections with `marked` + isolated DOMPurify sanitisation; lightweight `pushState`/`popstate` routing in App; declarative `inert` on editor shell while guide is open; contextual links from Toolbar, Export, Capability, Diagnostics, source-health, empty preview, and Publish panels; `wrangler.jsonc` SPA fallback for deep links.

**Completed:**

- [**ML runtime: ORT-owned GPU device + unify-on-ORT**](.kiro/specs/ml-runtime-ort-device-ownership/tasks.md) — ORT owns the WebGPU `GPUDevice` (it ignores an injected one — [onnxruntime#26107](https://github.com/microsoft/onnxruntime/issues/26107)); the renderer adopts `ort.env.webgpu.device` rather than the reverse. Frame-coupled ORT engines (matte-onnx/interpolation/beauty) self-bootstrap on ORT's device and run their own WGSL passes on it; `OrtDeviceOwner` drops `'renderer'`. Policy: unify on the single ORT runtime (WebGPU/WebNN/WASM from one package; WASM the un-droppable floor). Models sourced directly from `onnx-community` on Hugging Face; R2 dropped as a model host.

- [**Phase 27: WebCodecs decode bridge**](.kiro/specs/phase-27-webcodecs-decode-bridge/tasks.md) — direct `VideoDecoder`/`AudioDecoder` over Mediabunny demux; bounded backpressure; key-packet seek; `getDecoderConfig` extradata; codec support matrix; worker integration; DualStreamFrameSource; diagnostics surface.
- [**Phase 13: Transitions**](.kiro/specs/phase-13-transitions/tasks.md) — cut-point transition model; dual-stream readahead; 2-input mix pass in the single submission; export parity.
- [**WASM SIMD Audio Resampler**](.kiro/specs/wasm-simd-resampler/tasks.md) — hand-written WAT with wasm-simd128; Kaiser-windowed polyphase sinc; transparent JS fallback; build:wasm script; ≥2x throughput.

- [**Alpha 0.1 Release Hardening**](.kiro/specs/alpha-0-1-release-hardening/tasks.md) — documentation truth sync, alpha support boundary, deployment verification checklist, media fixture checklist, release gates, UI honesty labels, build metadata in diagnostics.
- [**Phase 25: Release hardening**](.kiro/specs/phase-25-release-hardening/tasks.md) — diagnostics, recovery, performance budgets, fixture matrix, accessibility, release gates.
- [**Phase 24: Render Queue + Export Presets**](.kiro/specs/phase-24-render-queue-presets/tasks.md) — saved export presets; multi-job render queue with sequential execution; full/range/marker-bounded jobs; output filename templates; queue persistence.
- [**Phase 22: Captions + subtitles**](.kiro/specs/phase-22-captions-subtitles/tasks.md) — SRT/VTT import, inline editing, timing, split/merge, style presets, burn-in, export.
- [**Phase 21: Colour management + scopes**](.kiro/specs/phase-21-colour-management-scopes/tasks.md) — waveform, vectorscope, histogram; BT.601/BT.709/Rec.2020/Display P3 conversions.
- [**Phase 20: Editing Tools V2**](.kiro/specs/phase-20-editing-tools-v2/tasks.md) — linked A/V clips; insert/overwrite edits; ripple delete/trim; roll/slip/slide; lift/extract; track lock/visibility/sync lock/edit targeting.
- [**Phase 19: Proxy/render cache**](.kiro/specs/phase-19-proxy-render-cache/tasks.md) — LRU frame cache, proxy generation, cache budgets, OPFS storage.
- [**Phase 18: Media conformance**](.kiro/specs/phase-18-media-conformance/tasks.md) — source health warnings, VFR detection, rotation metadata, codec validation.
- [**Phase 17: Export expansion**](.kiro/specs/phase-17-export-expansion/tasks.md) — probed codec/container choice (H.264/VP9/AV1); resolution/fps/bitrate overrides; in/out range export; persisted settings.
- [**Phase 16: Audio mixing polish**](.kiro/specs/phase-16-audio-mixing/tasks.md) — shared mix stage; master bus; per-track pan; clip fades + transition crossfades; AudioWorklet meters over SAB.
- [**Phase 15: Keyframes + advanced colour**](.kiro/specs/phase-15-keyframes-colour/tasks.md) — keyframe tracks with shared preview/export interpolation; Inspector keyframe UI; `.cube` LUT import as a 3D-texture pass.
- [**Phase 14: Titles + text**](.kiro/specs/phase-14-titles-text/tasks.md) — source-less title clips; edit-time OffscreenCanvas raster cached as a GPU texture keyed by content hash; bundled offline fonts (Inter/Lora OFL); transform-driven layout; toggleable safe-area guides.
- [**Phase 12: Multi-track compositing + transforms**](.kiro/specs/phase-12-compositing-transform/tasks.md) — layered resolve; N-layer single-submission composite; per-clip position/scale/rotation/opacity; preview gizmo; fit/letterbox.
- [**Phase 11: Media library + stills + tracks**](.kiro/specs/phase-11-media-library/tasks.md) — batch import; media bin with budgeted worker thumbnails; image-still + audio-only sources; explicit track management; filmstrips.
- [**Phase 10: Timeline UX + gap model**](.kiro/specs/phase-10-timeline-ux/tasks.md) — px-per-second zoom/scroll; gap-tolerant time-based moves; snapping; multi-select; copy/paste/duplicate; markers; keyboard map.
- [**Phase 9: Project persistence + undo/redo**](.kiro/specs/phase-9-persistence-undo/tasks.md) — versioned timeline serialization; worker-owned snapshot undo/redo; IndexedDB autosave + restore-on-launch; layered media re-linking.
- [**Phase 8: Capability-tier UX + compatibility engine**](.kiro/specs/phase-8-capability-tiers/tasks.md) — preserve the accelerated path while making missing browser capabilities understandable and recoverable.
- [**Phase 7: PWA + deployment**](.kiro/specs/phase-7-pwa-deployment/tasks.md) — installable offline PWA; Cloudflare Pages; production `crossOriginIsolated`.
- [**Phase 6: Export**](.kiro/specs/phase-6-export/tasks.md) — pipelined decode → effects → encode → mux; backpressure; quality/speed presets; ETA.
- [**Phase 5: Audio**](.kiro/specs/phase-5-audio/tasks.md) — AudioWorklet graph; audio as master clock; per-track gain/mute/solo; waveforms.
- [**Phase 4: Effect chain**](.kiro/specs/phase-4-effect-chain/tasks.md) — WGSL compute effects; single-submission chain; per-clip params; f16/f32 variants.
- [**Phase 3: Timeline + editing**](.kiro/specs/phase-3-timeline-editing/tasks.md) — authoritative timeline model + mirror; split/delete/reorder/trim; seamless playback; frame cache.
- [**Phase 2: Zero-copy preview**](.kiro/specs/phase-2-zero-copy-preview/tasks.md) — decode → `importExternalTexture` → OffscreenCanvas; playback loop; adaptive preview resolution; throughput probe.
- [**Phase 1: Scaffolding**](.kiro/specs/phase-1-scaffolding/tasks.md) — Vite + Solid, COOP/COEP, worker skeleton, SAB clock, Mediabunny metadata import.

## Useful commands

```bash
vp install         # Clean install from the lockfile
vp dev             # Vite dev server (COOP/COEP headers enabled)
vp run check       # Full quality gate: format:check + lint + typecheck + test + build
vp build           # Production build
vp test run        # Vitest unit tests (node environment)
vp run test:browser     # Vitest Browser Mode (real Chromium, component/integration tests)
vp run test:e2e         # Playwright E2E (full user-flow tests)
vp lint .          # Lint
vp fmt .           # Format
vp run typecheck   # tsc --noEmit
vp cache clean     # Clear the Vite+ task cache (node_modules/.vite/task-cache)
```

The `check` quality-gate steps are declared as cached tasks (`check:format`, `check:lint`, `check:typecheck`, `check:test`, `check:build`) in [`vite.config.ts`](vite.config.ts) under `run` — prefixed because a Vite+ task may not share a name with a package.json script — so `vp run check` content-caches each step. CI persists `node_modules/.vite/task-cache` across runs, so a re-push only re-executes the steps whose inputs actually changed.

## TypeScript 6/7 transition

- Prefer `vp run typecheck` / `tsgo --noEmit` for day-to-day type-checking while TypeScript 7 is in preview. Once TypeScript c is stable and installed as `typescript`, `tsgo` becomes `tsc` and `@typescript/native-preview` can be dropped.
- Keep `typescript` at 6.x so peer-dependent tooling continues to import the TypeScript 6 API during the transition.

## Architectural boundaries (hard gates)

1. **Main thread stays interactive** — no sustained decode/GPU/encode/mux/pixel loops on main. Bounded probes and labeled compatibility helpers are allowed when measured.
2. **Accelerated path has no CPU pixel round-trips** — `VideoFrame` → `importExternalTexture` → compute chain → encoder stays zero-copy. Compatibility paths may be slower only when separate, explicit, and visibly labeled.
3. **`SharedArrayBuffer` is the premium clock** — high-frequency accelerated playback uses SAB. If `crossOriginIsolated !== true`, keep the shell alive and show a limited capability tier instead of a dead-end fatal screen.
4. **Single WebGPU command submission per frame** for the accelerated effect chain (Phase 4+).
5. **Client-compute core editing** — import/edit/preview/effects/audio/export must run in the user's browser. Cloudflare is for static hosting and COOP/COEP headers, not server-side media processing.
6. **pnpm only** — `pnpm-lock.yaml` is the lockfile; no `yarn.lock`, `package-lock.json`, or `bun.lock`.

## Quality gate

1. `vp run check` → green (format:check + lint + `tsc --noEmit` + Vitest + production build). This is what CI runs after `vp install`.
2. Test count must not decrease for non-trivial logic changes.
3. Full-performance dev and production must keep COOP/COEP so `crossOriginIsolated === true`; missing isolation must show the limited capability tier rather than crashing the shell.
4. Every `VideoFrame` `.close()`d exactly once in engine code paths.

## Review guidelines

These guidelines drive **Codex** PR reviews (`@codex review`, or automatic reviews) and apply to every other review agent too. Codex reads this section per the [GitHub integration docs](https://developers.openai.com/codex/integrations/github), applying the closest `AGENTS.md` to each changed file. **This section is the single source of truth for review priorities** — the Kiro/Claude review process and output format live in [`.kiro/steering/review.md`](.kiro/steering/review.md), which extends (never restates) this checklist.

**Match the depth of Claude's [code-review](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/README.md) and [pr-review-toolkit](https://github.com/anthropics/claude-code/blob/main/plugins/pr-review-toolkit/README.md) plugins.** Do **not** stop after one or two findings: review every changed file in full and run all the lenses below before concluding.

### Method (mirror Claude's multi-agent review)

1. Read **all** changed files end to end — never just the diff hunks.
2. Run each lens as an independent pass: guideline compliance, bug detection, resource/lifetime, error handling, tests, type design, comment accuracy, simplification.
3. Trace consumers when a `postMessage` protocol or `SharedArrayBuffer` layout changes; verify CSS selectors match the actual SolidJS DOM.
4. Report one finding per concrete issue with `file:line`, the impact, and a concrete fix — not a vague summary.

### Priorities (GitHub surfaces only P0 and P1 — classify accordingly)

**P0 — blocks merge (architectural hard-gate violations):**

- Sustained media decode/encode/GPU/pixel processing on the main thread without an explicit measured compatibility-tier design.
- `getImageData`, Canvas2D readback, or CPU pixel round-trip in the accelerated preview/export hot path.
- Per-frame `postMessage` for the accelerated playback clock when `SharedArrayBuffer` is available.
- Missing COOP/COEP headers for the full-performance build, or missing user-facing capability handling when `crossOriginIsolated` is false.
- Server runtime, external API calls, telemetry, cloud storage, or paid server compute required for core editing/export.
- `yarn.lock`, `package-lock.json`, or `bun.lock` added (pnpm only).
- A `VideoFrame` not `.close()`d, or closed twice.
- Logic bugs, crashes, data loss, race conditions, or security issues introduced by the change.

**P1 — should fix this cycle:**

- Multiple `queue.submit` per frame for the accelerated effect chain (Phase 4+).
- `importExternalTexture` cached across frames.
- Unbounded frame queues without `encodeQueueSize` backpressure; frame cache without LRU + `.close()` on eviction.
- Accelerated effect chain run twice for preview vs export instead of sharing one processed texture.
- Media objects or WebGPU handles leaking into `src/ui/`; missing `onCleanup` for rAF/listeners.
- Unstable references causing unnecessary re-renders in the rAF clock loop.
- Silent failures: swallowed errors, empty catch blocks, missing handling on critical paths.
- Missing tests for timeline model, seek logic, or protocol types on non-trivial changes; tests that mock away the invariant under test.
- Inaccurate/outdated comments, weak types that fail to encode invariants, and dead code.
- Missing or outdated user-facing documentation for user-visible changes. Reference docs in `docs/` and the in-app User Guide content in `src/features/docs/content/` live in the repo as the single source of truth; both render on GitHub, and the User Guide is bundled into the app at `/docs`.

Be thorough but not noisy: surface every P0/P1 you can substantiate, and skip pedantic nits, pre-existing issues the PR didn't touch, and anything a linter already catches.

## Cursor Cloud specific instructions

- **COOP/COEP** are load-bearing: `public/_headers` and `vite.config.ts` `server.headers` / `preview.headers`.
- **WebGPU + WebCodecs** require a modern Chromium browser for full performance; engine code runs in the pipeline worker, not on main.
- **Preview shortcuts must be capability-tiered** — do not regress the worker WebGPU path. If adding Canvas/WebGL/CPU fallback preview, keep it separate, reduced capability, and visibly labeled.
- **Single dev process** — no backend, media server, database, Docker, or `.env` secrets. Only `vp dev` (port **5173**) is required for interactive work; the pipeline worker is spawned automatically by the UI.
- **Remote browser access** — when testing via the Desktop pane, start Vite with `vp dev --host 0.0.0.0` so Chrome can reach the server.
- **Quality gate in CI-like runs** — `vp install` to install, then `vp run check` (format:check + lint + typecheck + Vitest + production build), mirroring `.github/workflows/ci.yml`.
- **Manual E2E smoke test** — open Chromium to `http://localhost:5173` (or the server's remote URL when using `--host 0.0.0.0`), confirm the status bar shows the accelerated/COOP-COEP OK tier, click **Import**, and load a local MP4/MOV/WebM. Also verify a non-isolated/missing-capability run shows limited mode instead of a blank app. A tiny test clip can be generated with `ffmpeg` if none is checked in.
- **WebGPU in cloud VMs** — headless or software-rendered environments may report “No WebGPU adapter”; metadata import and the SAB clock still work. Full zero-copy preview requires hardware WebGPU.
