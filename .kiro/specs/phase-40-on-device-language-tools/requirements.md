# Requirements: Phase 40 — On-Device Language Tools

> **Progressive enhancement only.** Strictly additive language features layered on Chrome's
> built-in AI APIs — **Translator** + **LanguageDetector** to translate Phase 22/29 caption
> tracks into a second, timing-identical caption track (bilingual zh/en sidecar export), and
> **Summarizer** + **Prompt** (`LanguageModel`) to draft titles, hashtags, and 文案 from a
> track's transcript into a copyable panel. Everything runs on-device. When the APIs are
> unavailable (Firefox, Safari, Chromium derivatives, or hardware below Chrome's floors) the
> **entire surface is hidden** — no errors, no nags. There is **no cloud fallback** and there
> never will be (see design). No new runtime dependency, no account, no telemetry, no upload.

## R0 — Hard Constraints

- **R0.1** No cloud LLM/translation/summarisation calls, no API key, no account, no telemetry, and no upload of captions, transcript text, or media anywhere. All inference runs on the user's device through Chrome's built-in AI.
- **R0.2** No model is fetched, created, or instantiated at app startup. Boot must be byte-identical in network and storage behaviour whether or not this feature exists. The capability probe performs feature-detection + `availability()` only — never `create()`, never a download.
- **R0.3** A model download (Translator / LanguageDetector / Summarizer / `LanguageModel`) is triggered **only** by an explicit user action carrying transient user activation.
- **R0.4** Zero new npm **runtime** dependency. Phase 40 uses browser-native APIs; the only added source is hand-authored, same-origin ambient TypeScript typings (no third-party CDN, no bundled weights).
- **R0.5** **Entirely hidden when unavailable.** When the probe reports no usable API, nothing renders: no side-rail tab, no toolbar button, no panel, no bilingual-export affordance, and no diagnostic nag. Zero console errors and zero visible Language Tools UI.
- **R0.6** **No other feature may depend on Phase 40.** Import, edit, caption editing, transcript, and export must behave identically with the entire Phase 40 surface removed from the build.
- **R0.7** **Draft output is never auto-applied.** Titles/hashtags/文案 land in a read-only, copyable panel; nothing writes to the project document.
- **R0.8** **Translated tracks preserve source timing exactly.** Each output segment copies the source segment's `start` and `duration` verbatim; only `text` changes. Segment count and order are preserved 1:1.
- **R0.9** No cloud fallback now or in any future revision. `design.md` states this plainly.
- **R0.10** The main thread stays interactive. Batch loops `await` per item and yield to the event loop; no sustained synchronous work. (These APIs offload inference to the browser process — there is no JS decode/GPU/encode/pixel loop on main.)
- **R0.11** Bounded memory. Operate on caption/transcript **text** only; never buffer media. Long transcripts are chunked to the model's input quota; streaming is used where the API supports it.

## R1 — Capability Probe (`LanguageToolsProbeResult`)

- **R1.1** Add a `LanguageToolsProbeResult` reporting, per API, a lifecycle state mapped directly from `availability()`: `'available' | 'downloadable' | 'downloading' | 'unavailable'`, plus `'unknown'` when the API is not feature-detected (e.g. SSR/Node test). Covers: `translator` (keyed by language pair), `languageDetector`, `summarizer`, `languageModel`.
- **R1.2** The probe is cheap and side-effect-free: synchronous feature detection (`'Translator' in self`, `'LanguageDetector' in self`, `'Summarizer' in self`, `'LanguageModel' in self`) followed by `await X.availability(...)`. It never calls `create()`, never downloads, never opens a session.
- **R1.3** The probe **does not** feed `deriveCapabilityTierV2` or any pipeline path — display/feature-gate only, matching the Phase 28 (`cleanup`) and Phase 29 (`asr`) feature-probe precedent.
- **R1.4** Translator availability is checked for the concrete pairs the feature uses (`en→zh`, `zh→en`), and results are keyed by pair so direction selection is accurate.
- **R1.5** The probe is re-runnable without side effects so a state can move `downloadable → downloading → available` across a session (e.g. another tab finished the download).

## R2 — Surface Visibility & Gating

- **R2.1** The Language Tools entry point (a side-rail tab / toolbar button) renders **only** when the surface is visible, i.e. at least one relevant API is `'available' | 'downloadable' | 'downloading'`.
- **R2.2** Inside the panel, each capability is gated independently: the **Translate** section appears only when a usable Translator pair (plus LanguageDetector for auto-direction) exists; the **Draft** section shows only the sub-tools whose API (Summarizer / `LanguageModel`) is usable.
- **R2.3** When the whole surface is hidden there is **no** "unavailable" fallback text (stricter than the PublishPanel pattern, which renders an explanatory fallback).
- **R2.4** If APIs appear or disappear mid-session, the surface appears/disappears on the next probe without throwing.

## R3 — Translation → Second Caption Track

- **R3.1** Translate a selected source caption/transcript track (Phase 22/29) to a target language, producing a **new** `CaptionTrack` marked `generatedBy: 'language-tools-phase-40'`.
- **R3.2** Direction defaults from LanguageDetector run over a sample of the source track within {zh, en}; the user can override the target language.
- **R3.3** **Per-segment** translation: each segment's text is translated independently; `start`/`duration` are copied exactly; segment count and order are preserved (R0.8).
- **R3.4** Download lifecycle UX: when the Translator is `'downloadable' | 'downloading'`, the user action creates it with a `monitor` and the UI shows explicit progress (percentage + stated approximate size) before/while downloading, then proceeds to translate.
- **R3.5** The job is cancellable via `AbortSignal`; cancel stops promptly and creates **no** track (no half-written project state).
- **R3.6** Bilingual export: the source + translated tracks export through the existing Phase 22 sidecar path with language-suffixed filenames (e.g. `name.zh.srt` / `name.en.srt`). A single combined dual-language WebVTT is an optional nicety, not required.
- **R3.7** The new track is undoable (Phase 9 snapshots) and persists like any caption track (Phase 9/23).
- **R3.8** Empty or whitespace-only translation results create no track and surface a clear message (reuse the ASR empty-result guard precedent).

## R4 — Draft Panel (titles / hashtags / 文案)

- **R4.1** The draft source is the concatenated, ordered, trimmed segment text of a chosen caption/transcript track.
- **R4.2** Long transcripts are chunked to the model's input quota (`measureInputUsage`/`inputQuota`) and condensed hierarchically (Summarizer over chunks, then over the summaries) before any prompt, keeping inputs bounded (R0.11).
- **R4.3** Summarizer produces a short description/summary (`type` configurable — default `key-points` or `tldr`; `format: 'plain-text'`).
- **R4.4** `LanguageModel` (Prompt API) produces N title options, a hashtag set, and a 文案 (social caption) in zh and/or en. Output is parsed defensively (robust to plain text even if structured output is requested).
- **R4.5** Output streams into the panel where supported (`summarizeStreaming` / `promptStreaming`) and is cancellable.
- **R4.6** Output is **read-only and copyable** (per-field copy buttons via `navigator.clipboard`, following the DiagnosticsPanel precedent) and is rendered as plain text via JSX/text nodes — never `innerHTML`. It is never written to the project document (R0.7).
- **R4.7** Each draft sub-tool is independently feature-gated; sub-tools whose API is unavailable simply do not render.
- **R4.8** The Prompt API may be unavailable on the public web without an Origin-Trial token or a user flag. The titles/hashtags/文案 tools must hide gracefully in that case; the Summarizer-based description may still be offered if Summarizer is available.

## R5 — Download / Availability UX

- **R5.1** Map `availability()` to UI: `available` → ready (act immediately, offline); `downloadable` → a one-time "Download model" affordance stating the approximate size; `downloading` → live progress; `unavailable` → hidden (R0.5).
- **R5.2** State the approximate download size **before** any fetch: translation language packs are on the order of tens of MB (Chrome-managed); Summarizer/Prompt share Gemini Nano — multiple GB, downloaded once by Chrome and reused across all sites.
- **R5.3** Live progress comes from the `downloadprogress` event on the `monitor` (`e.loaded`, 0..1).
- **R5.4** After a model is `available`, all calls work offline. Phase 40 neither fetches nor caches weights itself — Chrome owns the model lifecycle (so the OPFS/digest model-cache rules used by the Phase 28/29 LiteRT.js runtime do not apply here; see design).

## R6 — Threading & Architecture Compliance

- **R6.1** Phase 40 runs on the **main thread**: the browser offloads inference to its own process, the Prompt API is document-context-only on the web, and downloads require user activation. No AI code enters the pipeline worker, and there is no coupling to the WebGPU device or video frames.
- **R6.2** Batch loops `await` per item and yield; long jobs report progress and remain cancellable; the UI never blocks (R0.10).
- **R6.3** The only worker interaction is the authoritative caption-track creation command — the timeline stays worker-authoritative (Phase 22).

## R7 — Diagnostics

- **R7.1** When the surface is visible, an optional display-only diagnostics section may show per-API lifecycle states and last-job info. It is display-only; no logic elsewhere branches on it. When the whole surface is hidden, no diagnostics row is shown (honour R0.5).
- **R7.2** Errors are recorded in the recent-errors store under a `language-tools` subsystem and folded by code.

## R8 — Tests

- **R8.1** Unit-test the probe with mocked globals: each API present/absent and each `availability()` state → correct `LanguageToolsProbeResult` and `surfaceVisible`.
- **R8.2** Unit-test that startup performs zero `create()` calls and zero downloads (spies on the AI globals; module-graph assertion that the controller isn't imported at boot).
- **R8.3** Unit-test the per-segment timing invariant: with a mocked Translator, output segments copy `start`/`duration` exactly and preserve count/order (R0.8).
- **R8.4** Unit-test direction selection from a mocked LanguageDetector, including user override.
- **R8.5** Unit-test transcript assembly + chunk-to-quota (mocked `measureInputUsage`) + hierarchical summarisation (mocked Summarizer).
- **R8.6** Unit-test draft assembly from a mocked `LanguageModel` (streaming), and the copy helper.
- **R8.7** Unit-test cancellation (`AbortSignal`) mid-translate and mid-draft: prompt stop, no track, sessions reusable.
- **R8.8** Unit-test the empty-result guard (no track created).
- **R8.9** Unit-test the worker command handler: creates the translated track with copied timing and the `generatedBy` marker; visible in timeline state.
- **R8.10** Browser/Playwright test in standard CI Chromium (where these APIs are absent): the surface is entirely hidden, **zero console errors**, and core import/edit/export are unaffected.
- **R8.11** Quality gate: `pnpm run check` (format:check + lint + typecheck + Vitest + build) green; test count does not decrease.

## R9 — Acceptance Criteria

- **A1** On unsupported browsers: zero console errors and zero visible Language Tools UI; the rest of the app behaves normally.
- **A2** No model download at startup; downloads happen only on explicit user action and always surface progress.
- **A3** The translated track preserves source timing exactly (verbatim `start`/`duration`, 1:1 segments).
- **A4** Draft output is never auto-applied — it is copyable only.
- **A5** Once Chrome reports the models `available`, the features work fully offline.
- **A6** No cloud fallback exists; all inference is on-device.
- **A7** No other feature depends on Phase 40; removing the surface leaves the app fully functional.
- **A8** Bilingual zh/en sidecar export works from the source + translated tracks.
