# Design: Phase 40 — On-Device Language Tools

> Status: **Planned.** A strictly progressive-enhancement layer on Chrome's built-in AI APIs.
> Translator + LanguageDetector turn an existing caption/transcript track into a second,
> timing-identical caption track (bilingual zh/en subtitle export); Summarizer + Prompt
> (`LanguageModel`) draft titles, hashtags, and 文案 from a track's transcript into a copyable
> panel. The whole surface is hidden when the APIs are absent. Everything runs on-device.
> **There is no cloud fallback, and none will ever be added.**

## Goal

Give bilingual (SG / zh-en) creators two on-device conveniences without compromising the
accelerated, fully-local architecture:

1. **Translate captions** — pick a caption track (imported in Phase 22 or generated in Phase 29),
   translate it segment-by-segment to the other language, and get a second `CaptionTrack` whose
   timing matches the source **exactly**, ready for bilingual SRT/VTT sidecar export.
2. **Draft copy** — turn a track's transcript into suggested titles, hashtags, and 文案 in a
   read-only, copyable panel that never touches the project document.

Both are pure additive bonuses. On any browser without the relevant Chrome AI APIs, the entire
surface simply does not exist — there is nothing to fail, nothing to nag about, and nothing else
in the app depends on it.

## Why Chrome's built-in AI (and only Chrome's built-in AI)

- **On-device by construction.** Translator, LanguageDetector, Summarizer, and the Prompt API
  run the model in the browser process. Caption text and transcripts never leave the device — the
  same "no cloud" guarantee the rest of LocalCut Studio makes.
- **Nothing for us to host, fetch, version, or pin.** Chrome downloads and caches the models
  (translation language packs; Gemini Nano for Summarizer/Prompt). We ship **zero** weights, add
  **zero** runtime dependencies, and require **no** changes to COOP/COEP/CSP (no third-party
  scripts or CDN). Once Chrome reports a model `available`, our calls work fully offline.
- **Quality.** Chrome's tuned, hardware-gated models outperform anything we could ship for a
  static PWA at acceptable download sizes, especially for zh↔en translation and Chinese 文案.

### No cloud fallback — stated plainly

LocalCut Studio will **not** add a server-side or cloud-API path for translation, summarisation,
or drafting, now or later. If the on-device APIs are unavailable, the feature is hidden. This is a
deliberate product constraint, not a temporary gap. (A *client-side* cross-browser path is
evaluated and deferred below — that is still on-device, never cloud.)

## Why this runs on the main thread (architecture-gate compliance)

Repo-owned ONNX inference runs in dedicated workers because ORT graphs are JS-driven
compute. Chrome's built-in AI is fundamentally different and is correctly hosted on the main
thread:

1. **The browser offloads inference to its own process.** `translate()` / `summarize()` /
   `prompt()` return promises; no decode/GPU/encode/mux/pixel loop runs on the JS main thread, so
   the hard "main thread stays interactive" gate is not engaged. Batch loops `await` per item and
   yield, keeping the UI responsive; long jobs report progress and are cancellable.
2. **The Prompt API is document-context-only on the web.** `LanguageModel` is not exposed to
   dedicated workers for web pages (only extension service workers), so a worker cannot host it.
3. **Model download needs transient user activation**, which a worker does not have. The
   "Download model" affordance must be a real user gesture on the document.
4. **No frame coupling.** These are text APIs; there is nothing to zero-copy. Language Tools never
   touches decoded video frames or the compositor's GPU device.

The only worker hop is the existing, authoritative caption-track creation command, so the timeline
stays worker-owned.

## Non-goals

- No cloud LLM/translation/summarisation calls, ever; no API keys, accounts, or telemetry.
- No auto-posting, platform/social integration, or publishing of drafts.
- No full transcript rewriting/cleanup, no re-timing, no re-segmentation of the source track.
- No dubbing, no text-to-speech, no voice generation.
- No burned-in translated overlay work — translated captions reuse the Phase 22 track/export path
  unchanged.
- No new global capability tier; the probe is feature-gate-only.
- No hosting, caching, or digest-pinning of model weights — Chrome owns that lifecycle.

## Architecture

```
Main thread (SolidJS UI)
  ├─ probeLanguageTools() ── feature-detect globals + availability() (no create, no download)
  │     gates only this feature; never feeds deriveCapabilityTierV2
  ├─ LanguageToolsPanel.tsx (rendered only when surface is visible)
  │     ├─ Translate section  ─► translation-controller.ts
  │     │     detector = LanguageDetector.create(); detector.detect(sample)[0] → direction
  │     │     translator = Translator.create({sourceLanguage, targetLanguage, monitor})
  │     │     for each source segment:  translator.translate(text, {signal})
  │     │       └─ copy {start,duration} verbatim → translated CaptionSegment
  │     │     monitor(downloadprogress) e.loaded 0..1 → progress UX
  │     └─ Draft section      ─► draft-controller.ts
  │           transcript = join(track.segments.text)
  │           chunk to inputQuota → summarizer.summarize (hierarchical) → condensed
  │           session.promptStreaming(condensed, simple delimited ask: N titles, hashtags, 文案 zh/en)
  │           session.summarize → description       (copy-only, never applied)
  │
  ├─ caption-bridge (existing) ── add-translated-caption-track ─► pipeline worker
  │                                                               └─ createCaptionTrack +
  │                                                                  commitCaptionMutation (undo)
  └─ pipeline worker (src/engine/worker.ts) — UNCHANGED except the one additive command;
                                              no AI code, no model state.
```

Key boundaries:

- **No AI in `src/engine/worker.ts`.** The worker only stores the finished translated segments as
  a normal caption track (authoritative timeline, Phase 22 model, Phase 9 undo).
- **Drafts never reach the worker or the project doc** — they exist only in panel state and the
  clipboard.
- **`src/ui/` holds no media objects** (structure rule); Language Tools handles only strings.

## Capability probe

```typescript
// src/protocol.ts
export type AiAvailability =
  | 'available'      // ready now; works offline
  | 'downloadable'   // supported, model not yet fetched (needs user gesture)
  | 'downloading'    // fetch in progress
  | 'unavailable'    // not supported on this browser/hardware, or blocked
  | 'unknown';       // not feature-detected (SSR / Node test env)

export interface LanguageToolsProbeResult {
  /** Per zh<->en pair, keyed 'en->zh' | 'zh->en'. */
  translator: Record<string, AiAvailability>;
  languageDetector: AiAvailability;
  summarizer: AiAvailability;
  /** Prompt API; often 'unavailable' on the public web without an OT token. */
  languageModel: AiAvailability;
}

/** True when any sub-tool is at least downloadable — the only thing the UI gates the surface on. */
export function languageToolsSurfaceVisible(p: LanguageToolsProbeResult): boolean { /* ... */ }
```

```typescript
// src/engine/language-tools/probe.ts  (pure, unit-testable with mocked globals)
export async function probeLanguageTools(
  scope: LanguageToolsScope = globalThis as LanguageToolsScope
): Promise<LanguageToolsProbeResult>;
```

The probe maps each global's static `availability()` straight through (`Translator.availability({sourceLanguage, targetLanguage})`, `LanguageDetector.availability()`, `Summarizer.availability()`, `LanguageModel.availability()`). It is side-effect-free: it never
calls `create()`, opens a session, or starts a download. Like the Phase 28 `cleanup` and Phase 29
`asr` feature probes it is attached to the capability-probe result for display only and is **never** read by
`deriveCapabilityTierV2`.

## Surface visibility & gating

Following the `PublishPanel`/`createMemo(available)` precedent, but stricter: the gate is applied
at the **entry point**, so when `languageToolsSurfaceVisible` is false there is no tab, no button,
and no panel — nothing rather than a fallback message (R0.5/R2.3). Inside the panel, each section
is wrapped in its own `<Show when={...}>` keyed on the per-API availability so partial support
(e.g. Translator available, Prompt API not) renders only the usable tools.

## Translation pipeline

```
source CaptionTrack (Phase 22/29)
  → detector = LanguageDetector.create(); detector.detect(text)[0] over a sample → dominant {zh|en}
  → default target = the other; user may override
  → check Translator.availability({sourceLanguage, targetLanguage}) for the resolved pair:
        'available'  → Translator.create(...) and use immediately
        'downloadable'/'downloading' → Translator.create({monitor}) on the user gesture, show progress
        'unavailable' → clear message, create no track
  → for each segment (await, yielding; AbortSignal-cancellable):
        translatedText = await translator.translate(segment.text)
        push { id: new, start: segment.start, duration: segment.duration, text: translatedText }
  → if no non-whitespace text → error, create no track
  → caption-bridge.send({ type: 'add-translated-caption-track', name, language, segments, sourceTrackId })
```

- **Timing is copied, never recomputed** — the core invariant (R0.8/A3). One source segment maps
  to exactly one output segment.
- Per-segment translation keeps each call's input tiny (bounded memory) and makes the timing
  mapping trivial. The known trade-off — sentences split across cues lose cross-cue context — is
  accepted to guarantee exact timing; it is documented in the user guide.
- The resulting track is a normal `CaptionTrack` (`generatedBy: 'language-tools-phase-40'`), so it
  is editable, undoable, persisted, and exported exactly like an imported track.

### Bilingual export

No new export engine. The source and translated tracks each export through the Phase 22 sidecar
path (`exportCaptionSidecars`). Phase 40 adds a language-suffixed filename helper
(`stem.zh.srt` / `stem.en.srt`) so a bilingual pair drops out of two ordinary exports. A single
combined dual-language WebVTT (both languages per cue) is an optional convenience and not part of
the acceptance bar.

## Draft pipeline (titles / hashtags / 文案)

```
chosen track transcript = track.segments.map(s => s.text.trim()).filter(Boolean).join(' ')
  → create needed sessions up-front, within the click's user activation (P1-F):
        Summarizer.create({type, format, monitor}); LanguageModel.create({monitor})
  → if summarizer.measureInputUsage(transcript) > summarizer.inputQuota:
        split into quota-sized chunks; summarize each → summarize the summaries (hierarchical, bounded)
  → description = summarizer.summarize(condensed, {type:'key-points', format:'plain-text'})
  → bound condensed to languageModel.inputQuota via measureInputUsage (covers the no-summarizer case)
  → drafts = languageModel.promptStreaming(prompt, simple delimited ask: N titles, hashtags, 文案 zh/en)
  → render each field read-only with a Copy button (navigator.clipboard.writeText)
```

- Outputs are **plain text** rendered via JSX/text nodes (no `innerHTML`; satisfies the security
  steering). Markdown is not rendered; if it ever is, it must reuse the docs' isolated DOMPurify
  path.
- Streaming gives progressive output and lets Cancel stop promptly.
- Summarising before prompting keeps the Prompt API input within Gemini Nano's context window and
  bounds memory regardless of transcript length (R0.11).
- Nothing here mutates the project — drafts live in panel signals and the clipboard only (R0.7/A4).

## Download & availability UX, and model sizes

| API | Model (Chrome-managed) | Approx. download | Notes |
|-----|------------------------|------------------|-------|
| Translator | per-language-pair pack | tens of MB / pair | downloaded on first use of the pair |
| LanguageDetector | language-id model | a few MB | tiny |
| Summarizer | Gemini Nano | multiple GB (one-time) | shared across all sites/origins |
| Prompt (`LanguageModel`) | Gemini Nano | shared with Summarizer | OT/flag gated on the open web |

- The approximate size is shown **before** any download (R5.2); live percentage comes from the
  `downloadprogress` monitor event.
- We do **not** fetch or cache these; therefore the OPFS model-cache + digest-pinning rules that
  govern app-owned ORT model assets **do not apply** to Phase 40, and there is nothing for
  the PWA bundle-cache to pin. This is the honest distinction between "Chrome-owned models" and
  "weights we host".
- The repository now has an ORT/ONNX ML platform for app-owned model assets. Phase 40
  intentionally does **not** use it: Chrome owns the built-in AI model download/cache/lifecycle.
  There are no Phase 40 model URLs, manifests, SHA-256 pins, OPFS model-cache entries, or ORT
  sessions.

## Protocol additions

```typescript
// src/protocol.ts — command (UI → pipeline worker)
export interface AddTranslatedCaptionTrackCommand {
  type: 'add-translated-caption-track';
  sourceTrackId: string;
  name: string;            // e.g. "译文 (zh)" / "Translation (en)"
  language: string;        // target IETF tag
  segments: CaptionSegmentSnapshot[]; // timing already copied from the source
  generatedBy: 'language-tools-phase-40';
}

// state (worker → UI)
export interface TranslatedCaptionTrackCreated {
  type: 'translated-caption-track-created';
  trackId: string;
}
```

The handler mirrors `handleAsrCreateCaptionTrack`: `createCaptionTrack(...) →
commitCaptionMutation(...)` for undoable insertion, with the same empty-result guard. The worker
asserts segment count and per-segment `start`/`duration` were not altered (defence-in-depth on the
timing invariant). No new dependency on ASR semantics is introduced.

## Deferred: cross-browser app-owned text models (cost/benefit)

Phase 29's Auto Captions already run on-device in **any** browser with WebAssembly through
ORT-WASM. Only the **translation + drafting** layer is Chrome-only. A future cross-browser
implementation would need app-owned MT/LLM models on ORT-WASM/WebGPU or a separately approved
runtime, with the same explicit-load, size/SHA verification, OPFS cache, and no-cloud rules used
by other app-owned model assets.

The consequence: the **transcript that feeds the Draft panel is already cross-browser** (Phase 29
produces it everywhere via ORT-WASM). The open question is narrow: should Firefox/Safari/older
Chromium users also get local translation and drafting through downloaded app-owned text models?

**Cost.** Translation and a usable instruct LLM mean multi-GB downloads, materially lower quality
than Chrome's tuned models, real maintenance for a non-Chrome minority, and licence review:

| Candidate | Task | Size (approx) | Licence | Verdict |
|-----------|------|---------------|---------|---------|
| NLLB-200 distilled-600M | MT | ~2.4 GB | CC-BY-**NC** | ✗ non-commercial — incompatible |
| Opus-MT (per pair) | MT | ~few hundred MB/pair | CC-BY 4.0 | △ attribution; lower quality |
| M2M100-418M | MT | ~1.7 GB | MIT | △ permissive but large/weaker |
| Qwen2.5-0.5B/1.5B-Instruct | draft | ~1–3 GB | Apache-2.0 | △ clean licence, modest quality |
| Gemma-2-2B | draft | ~2.5 GB | Gemma terms | △ use restrictions |
| Phi-3-mini | draft | ~2.3 GB | MIT | △ permissive, large |

**Benefit.** Feature parity for the minority of users not on a capable Chrome — for a
convenience feature that is explicitly optional.

**Decision: defer.** Phase 40 stays Chrome-only progressive enhancement. A cross-browser path is
recorded as a possible future phase on app-owned models, gated on (a) an MIT/Apache-licensed model
meeting an acceptable size **and** quality bar, and (b) acceptable local latency for interactive
text generation. The download/quality/maintenance/licence cost outweighs the benefit today.

## Dependencies & licensing

- **Runtime dependencies added: none.** Phase 40 calls browser-native APIs only.
- **Typings:** hand-authored minimal ambient declarations in `src/types/chromium-ai.d.ts`
  covering only the surface we use (mirrors the prior `web-speech.d.ts` approach; keeps us
  dependency-free and in control). `@types/dom-chromium-ai` (DefinitelyTyped, MIT, dev-only) would
  meet the AGENTS.md criteria if a maintained external type source is later preferred, but is not
  adopted now to avoid churn.
- **Models:** Google's, shipped and managed by Chrome under its own terms; we redistribute
  nothing, so there is no bundled-weight licence for us to vet.

## Security & privacy

- COOP/COEP and CSP are unchanged — no third-party scripts, no CDN, no cross-origin fetch.
- No secrets in source. The Prompt API may need a Chrome **Origin-Trial token** on the open web;
  if adopted it is a static, origin-bound, expiring `<meta http-equiv="origin-trial">` /
  `public/_headers` entry (no secret, no server), and the feature must still hide gracefully when
  absent (R4.8).
- AI output is rendered as text via JSX/text nodes — never `innerHTML` (security steering).
- No media, file names, captions, or transcript text are uploaded or logged anywhere (R0.1).

## Modules

| Module | Description |
|--------|-------------|
| `src/engine/language-tools/probe.ts` | `probeLanguageTools()` + `languageToolsSurfaceVisible()`; pure, mock-testable |
| `src/engine/language-tools/transcript.ts` | transcript assembly, quota chunking, per-segment timing-copy helpers (pure) |
| `src/engine/language-tools/draft-prompts.ts` | prompt builders + defensive parsing for titles/hashtags/文案 (pure) |
| `src/ui/language-tools/translation-controller.ts` | session lifecycle, direction, batch translate, progress, cancel |
| `src/ui/language-tools/draft-controller.ts` | summarise→prompt orchestration, streaming, cancel |
| `src/ui/LanguageToolsPanel.tsx` | gated panel: Translate section + Draft section + copy + progress (ARIA) |
| `src/types/chromium-ai.d.ts` | hand-authored ambient types for the Chrome AI APIs we use |
| `src/protocol.ts` | `AiAvailability`, `LanguageToolsProbeResult`, `add-translated-caption-track` |
| `src/engine/worker.ts` | one additive handler reusing `createCaptionTrack` + `commitCaptionMutation` |
| `src/features/docs/content/language-tools.md` | in-app user-guide section (privacy, requirements, flows, limits) |

## Validation

| Scenario | Expected result |
|----------|----------------|
| App startup (any browser) | Zero AI `create()`/downloads; controller not imported at boot |
| Firefox / Safari / no-API Chromium | No tab, no button, no panel; zero console errors; rest of app normal |
| Chrome, model `downloadable` | "Download model (~size)" affordance; user gesture downloads with live progress |
| Translate a 200-cue track | Second track with 200 cues; every `start`/`duration` equals the source |
| Bilingual export | `stem.zh.srt` + `stem.en.srt` via the existing sidecar path |
| Long transcript draft | Chunked to quota, hierarchical summarise, streamed drafts; UI responsive |
| Draft copy | Copy buttons write to clipboard; project document unchanged; undo shows no new edit |
| Cancel mid-job | Prompt stop; no track (translate) / partial discarded (draft); sessions reusable |
| Offline after `available` | Translate + draft succeed with the network disabled |
| Quality gate | `pnpm run check` green; test count grows |

## Acceptance Criteria

- Unsupported browsers show zero Language Tools UI and produce zero console errors (A1).
- No startup download; downloads are user-initiated with progress (A2).
- Translated tracks preserve source timing exactly, 1:1 (A3).
- Drafts are copy-only and never auto-applied (A4).
- Features work offline once Chrome reports models `available` (A5).
- No cloud fallback; all inference on-device (A6).
- Nothing else depends on Phase 40; removing it leaves the app fully functional (A7).
- Bilingual zh/en sidecar export works from the source + translated tracks (A8).
