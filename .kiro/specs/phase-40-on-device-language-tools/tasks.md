# Tasks: Phase 40 — On-Device Language Tools

> Status: **Implemented.** Progressive enhancement on Chrome's built-in AI (Translator,
> LanguageDetector, Summarizer, Prompt). All main-thread; the only worker hop is one additive
> caption-track command. Hidden entirely when the APIs are absent. No new runtime dependency, no
> cloud, no telemetry.

## T1 — Capability probe & types

- [x] **T1.1** Add `AiAvailability`, `LanguageToolsProbeResult`, and `languageToolsSurfaceVisible()` to `src/protocol.ts` (R1.1).
- [x] **T1.2** Create `src/engine/language-tools/probe.ts`: `probeLanguageTools(scope?)` — feature-detect the globals (`'Translator' | 'LanguageDetector' | 'Summarizer' | 'LanguageModel' in self`) then read each static `availability()`; check `Translator.availability` for `en->zh` and `zh->en`; never `create()`/download (R1.2, R1.4).
- [x] **T1.3** Attach `languageTools` to the capability-probe result for display only; confirm with a test that `deriveCapabilityTierV2` ignores it (R1.3) — mirror the `cleanup`/`asr` feature-probe precedent.
- [x] **T1.4** Unit-test the probe with mocked globals: each API absent/present × each availability state → correct result + `surfaceVisible`; `'unknown'` when undefined (R8.1).

## T2 — Surface gating & entry point

- [x] **T2.1** Add the Language Tools entry (side-rail tab or toolbar button) rendered only when `languageToolsSurfaceVisible(probe)` is true — no tab/button/panel otherwise, and no fallback nag text (R2.1, R2.3, R0.5).
- [x] **T2.2** Inside `LanguageToolsPanel`, wrap the Translate and each Draft sub-tool in `<Show when={...}>` keyed on per-API availability (R2.2, R4.7).
- [x] **T2.3** Re-run the probe on relevant lifecycle points so the surface can appear/disappear mid-session without throwing (R1.5, R2.4).

## T3 — Translation controller

- [x] **T3.1** Create `src/ui/language-tools/translation-controller.ts`: framework-free state machine owning Translator/LanguageDetector sessions, with `translateTrack(source, target?, signal)`.
- [x] **T3.2** Direction: create a `LanguageDetector` session via `LanguageDetector.create()`, run `detector.detect(text)[0]` over a sample of source segments → dominant {zh|en} → default target = the other; allow user override; guard the resolved pair with `Translator.availability` before `create()` (R3.2, R8.4).
- [x] **T3.3** Per-segment translate, copying `start`/`duration` verbatim; preserve count/order; `await` per item and yield (R3.3, R0.8, R0.10).
- [x] **T3.4** Download lifecycle: when `downloadable`/`downloading`, `create({ monitor })` on the user gesture; surface `downloadprogress` and the stated approx size before/while downloading (R3.4, R5.1–R5.3).
- [x] **T3.5** `AbortSignal` cancellation: prompt stop, no track, sessions reusable; `destroy()` on dispose (R3.5, R8.7).
- [x] **T3.6** Empty/whitespace-only result → clear error, no track (R3.8, R8.8).
- [x] **T3.7** Put pure helpers (transcript/segment timing-copy) in `src/engine/language-tools/transcript.ts`; unit-test the timing invariant with a mocked Translator (R8.3).

## T4 — Translated caption track (worker)

- [x] **T4.1** Add `add-translated-caption-track` command + `translated-caption-track-created` state to `src/protocol.ts` (design protocol sketch).
- [x] **T4.2** Handle it in `src/engine/worker.ts` reusing `createCaptionTrack(...)` + `commitCaptionMutation(...)` (undoable); set `generatedBy: 'language-tools-phase-40'`; assert segment count + per-segment timing unchanged; keep the empty-result guard (R3.7, R6.3).
- [x] **T4.3** Unit-test the handler: track created with copied timing + marker, visible in timeline state; undo removes it (R8.9).

## T5 — Bilingual export

- [x] **T5.1** Add a language-suffixed filename helper so the source + translated tracks export via the existing `exportCaptionSidecars` path as `stem.zh.srt` / `stem.en.srt` (R3.6, A8).
- [x] **T5.2** Wire a "Export bilingual" affordance in the panel that triggers the two existing per-track sidecar exports (no new export engine).
- [x] **T5.3** Unit-test the filename helper and that both single-language sidecars serialise correctly.

## T6 — Draft controller

- [x] **T6.1** Create `src/ui/language-tools/draft-controller.ts` owning Summarizer + `LanguageModel` sessions.
- [x] **T6.2** Assemble transcript from a chosen track; chunk using the session's `measureInputUsage()` against its `inputQuota`; hierarchical Summarizer condense for long transcripts; bound the Prompt input to `inputQuota` even when no summarizer runs (R4.1, R4.2, R0.11).
- [x] **T6.3** Summarizer description via `summarizer.summarize()` (`type` default `key-points`/`tldr`, `format:'plain-text'`); `languageModel.promptStreaming()` for N titles + hashtags + 文案 (zh/en) with simple delimited prompts and defensive parsing (R4.3, R4.4).
- [x] **T6.4** Stream output, cancellable via `AbortSignal`; `destroy()` sessions on dispose (R4.5, R8.7).
- [x] **T6.5** Put prompt builders + parsing in `src/engine/language-tools/draft-prompts.ts` (pure); unit-test draft assembly from a mocked streaming `LanguageModel` (R8.6) and chunk/quota + hierarchical summarise from a mocked Summarizer (R8.5).

## T7 — Panel UI

- [x] **T7.1** Create `src/ui/LanguageToolsPanel.tsx` following the panel idiom (focus on open, Escape to close, `role`/ARIA, ghost icon buttons).
- [x] **T7.2** Translate section: source-track picker, detected/overridable target, model state + progress, Translate + Cancel (disabled-with-reason where prerequisites missing), Export-bilingual.
- [x] **T7.3** Draft section: source-track picker, generate buttons per available sub-tool, streamed read-only output rendered as text (no `innerHTML`), per-field Copy via `navigator.clipboard` (DiagnosticsPanel precedent) with a status message (R4.6).
- [x] **T7.4** A permanent privacy line: "All translation and drafting run on this device through Chrome's built-in AI. Nothing is uploaded. No cloud API."
- [x] **T7.5** Footer/help link to the in-app guide section.

## T8 — Ambient types & feature detection

- [x] **T8.1** Hand-author `src/engine/language-tools/chromium-ai.d.ts` for the subset used — the global classes `Translator`, `LanguageDetector`, `Summarizer`, `LanguageModel`, each with static `availability()` / `create({…monitor})`, plus instance `translate` / `detect` / `summarize` / `prompt` (+ streaming), `measureInputUsage()` / `inputQuota`, `destroy()`, and the `downloadprogress` monitor (`e.loaded` 0..1, no `e.total`). No dependency added (R0.4).
- [x] **T8.2** Confirm strict `tsc` passes with the new globals declared on `self`/`window`.

## T9 — Diagnostics (optional, display-only)

- [x] **T9.1** When the surface is visible, contribute display-only diagnostic rows (per-API lifecycle state, last-job info); hidden when the surface is hidden (R7.1).
- [x] **T9.2** Record errors in the recent-errors store under a `language-tools` subsystem, folded by code (R7.2).

## T10 — Docs

- [x] **T10.1** Add `src/features/docs/content/language-tools.md` and register it in `src/features/docs/docsManifest.ts` (`DOC_SECTIONS`): privacy statement, Chrome requirements + model sizes, translate flow, per-segment context limitation, bilingual export, draft "copy-only, never applied", offline-after-download, and the "hidden on unsupported browsers / no cloud fallback" policy.
- [x] **T10.2** Add a matching "On-Device Language Tools" section to `docs/USER-GUIDE.md`.

## T11 — Tests

- [x] **T11.1** Probe matrix unit tests (T1.4 / R8.1) and the no-startup-download test: spy on the AI globals → zero `create()`/downloads at boot; module-graph assertion the controllers aren't imported at boot (R8.2).
- [x] **T11.2** Timing-invariant, direction-selection, transcript chunk/quota, hierarchical summarise, draft streaming, cancellation, and empty-guard unit tests (R8.3–R8.8) with mocked AI APIs (no large fixtures).
- [x] **T11.3** Worker-handler integration test (R8.9).
- [x] **T11.4** Real-browser test in standard CI Chromium (APIs absent): no actionable Translate/Draft UI, **zero console errors** (`src/__browser__/LanguageTools.browser.test.tsx`, run by `browser-tests.yml`). Implemented via Vitest Browser Mode per the testing steering (Playwright is reserved for WHIP); the toolbar entry-point gate is covered by the `languageToolsSurfaceVisible` unit tests (R8.10, A1, A7).

## T12 — Non-regression & quality gate

- [x] **T12.1** Existing caption/transcript/export suites stay green with Language Tools never loaded; confirm core flows are independent of Phase 40 (R0.6, A7).
- [x] **T12.2** `pnpm run check` green (format:check + lint + typecheck + Vitest + build); test count grows; Language Tools controllers emit as code that is not pulled into the boot path (R8.11).

## Pre-implementation notes

- **Main thread, by design.** The Prompt API (`LanguageModel`) is document-context-only on the
  web and model download needs transient user activation, so sessions live on the main thread; the
  browser offloads inference to its own process (no JS compute loop on main). See design
  "Why this runs on the main thread".
- **No weights hosted.** Chrome owns the model lifecycle, so there is nothing for us to fetch,
  cache in OPFS, or digest-pin — unlike the Phase 28/29 LiteRT.js runtime, which SHA-256-verifies
  and OPFS-caches its TFLite weights. Surface Chrome's reported size/progress before any download.
- **Prompt API may be gated.** On the public web it can be `unavailable` without an Origin-Trial
  token or user flag; the titles/hashtags/文案 tools must hide gracefully while Summarizer-based
  description may still be offered (R4.8).
- **Cross-browser path is deferred**, not dropped — see design's cost/benefit + licence table.
  Phase 29 already makes captions/transcripts cross-browser on the LiteRT.js (`@litertjs/core`)
  WASM runtime, so only the translation + drafting layer is Chrome-only; porting text models onto
  LiteRT.js would stay on-device, never cloud.
