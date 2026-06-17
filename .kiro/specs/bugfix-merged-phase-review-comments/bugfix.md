# Bugfix — Address unresolved Codex / Gemini review comments across merged phases

> Status: **In review** (PR #112). Audits Phase 1 – Phase 48 merged PRs for
> unresolved review-bot findings and bundles the actionable, non-litert fixes
> in one cross-phase pass.

## Why this exists

Several phases (notably the recent Phase 38 Look Packs and Animated Overlays,
PR #73) were merged with outstanding Codex P0/P1 and Gemini high/medium review
comments that were never addressed in follow-up commits. The reviewer findings
are real — they include WGSL pipeline-creation failures on shader-f16 GPUs,
WebGPU same-view src/dst collisions, silent A/V desync hazards, and several
"feature surface lies" (a slider that does nothing, a fps getter that returns a
placeholder, etc.).

Rather than open a chase-PR per phase, this spec covers a single audit pass
over **all merged phase PRs** (Phase 1 – Phase 48) and bundles the
substantiated, still-applicable findings into one fix-up PR.

## Scope and explicit exclusions

**In scope** — review-bot comments that, when re-checked against the current
main, are still present and are either:

- a correctness bug (logic error, race, missing close, wrong shader call),
- a contract violation (returning a typed lie, partial commit on a multi-part
  edit, advertising a feature the path can't deliver), or
- a documented spec inconsistency that propagated into the implementation.

**Out of scope** — and explicitly skipped:

1. **Any code path under LiteRT.** Phase 27 (Audio Cleanup, RNNoise→DTLN
   migration), Phase 28 (DTLN cleanup), Phase 29 (Auto Captions / Whisper ASR),
   and Phase 31 (Portrait Matting) all currently run on LiteRT.js. These are
   being migrated to **ONNX Runtime Web** in a separate effort (see PR #105 for
   the ORT foundation, and the in-flight Phase 37 Frame Interpolation work on
   ORT). Fixing a finding in code that's about to be deleted or rewritten is
   wasted churn, so any finding whose file lives under `src/engine/ml/litert/`,
   `src/engine/asr/litert*/`, `src/engine/audio-cleanup/` (DTLN paths), or the
   matte engine's LiteRT loader is deferred to the ONNX migration.
2. **Pure nit / style suggestions** — comment wording, variable rename
   preferences, "consider using X instead of Y" without a concrete bug.
3. **Findings the agent surfaced but the current code already addresses.**
   Several Gemini/Codex comments were filed against the original PR diff and
   later fixed by a follow-up commit before merge; re-verification against
   current main caught these and excluded them.
4. **Features the reviewer flagged as incomplete that would require a separate
   design effort.** One concrete example is deferred rather than bundled:
   - Phase 21 source-normalize gamut matrix multiplication (the transfer + range
     wiring is done; matrix mult is still identity and the limitation is
     documented in-shader).
   - (Phase 21 scope compute dispatch was originally on this list, but PR #111
     shipped the real dispatch to main before this fix-up rebased, so the
     planned docstring-stub update became a no-op.)

## How the bug list was derived

A workflow over all 41 merged phase PRs spawned one agent per PR. Each agent:

1. Fetched every review comment via the GitHub API
   (`gh api repos/.../pulls/<N>/comments` and `.../issues/<N>/comments`).
2. Filtered for substantive reviewer findings — chatgpt-codex-connector (P0/P1),
   gemini-code-assist (high/medium), coderabbit, claude review-bot.
3. Opened the referenced file in current main and verified the issue still
   applied (the agent reported `still_applies: 'yes' | 'no' | 'partially'`).
4. Flagged litert-dependent findings for exclusion.

50 findings came back as "actionable, still applicable, non-litert." That set
is the bug list below, deduplicated and grouped by phase.

## Bugs

### B1 — Phase 38 `encodeFilmLooks` binds the same view as both sampled input and storage output

`effects.ts:573` hard-coded `pingPong[0] = storage.b` as the first film-pass
destination. When the upstream LUT pass already left `srcView === storage.b`
(the common "LUT-only clip + look pack" path), the next compute pass binds
`storage.b` as both the read-only sampled texture and the writable storage
texture. WebGPU rejects this and Look Pack playback / export breaks.

**Expected:** Pick the first ping-pong destination from whichever storage slot
`currentSrc` currently occupies, so the first dst is never equal to the src
view. Match the existing pattern in `encodeLut` / `encodeMatte` / `encodeSkinSmooth`.

### B2 — Phase 38 f16 look shaders fail pipeline creation on shader-f16 GPUs

`grain.f16.wgsl:23`, `halation.f16.wgsl:35-39`, and `vignette.f16.wgsl:24` use
the scalar `f16(colour.rgb)` constructor on a `vec3f`. WGSL requires the vector
conversion `vec3<f16>(colour.rgb)`. On the high-performance path the renderer
prefers `*.f16.wgsl`, and pipeline creation throws, blocking the entire
accelerated preview/export.

**Expected:** `vec3<f16>(colour.rgb)` everywhere, matching the existing
`brightness-contrast.f16.wgsl` and friends. f16 variants stay
behaviour-identical to their f32 siblings.

### B3 — Phase 38 halation radius uniform is unused

`halation.wgsl` declares `radius` but the shader never reads it. The UI exposes
a 0–64 radius slider that produces identical output at radius = 1 and radius =
64 (no blur, just a screen-blend of the bright pass). The slider is a feature
surface that does nothing.

**Expected:** Sample neighbours within `radius` pixels and weight the bright
contribution by a Gaussian falloff so the slider visibly changes glow size.
A single-pass 16-tap golden-spiral sampling pattern is sufficient; the proper
separable-blur upgrade can come later. Also fix the type mismatch: the JS
packs `halationRadius` as a `Float32`, so the shader struct must declare it
`f32`, not `i32`.

### B4 — Phase 38 grain seeded from source frame timestamp, not timeline time

`gpu.ts:671` derives the grain seed from `layer.frame.timestamp / 1e6`. That is
the source decoded-frame timestamp, which is:

- always `0` for stills (entire clip duration runs on one frame),
- reused on cache hits (the cached `VideoFrame` carries the original
  decoded-frame timestamp, not "now"), and
- the same value across loops of the same source frame index.

The spec says grain is "timeline-time seeded for export determinism." The
current implementation freezes grain on stills and repeats it on cached /
looped media.

**Expected:** Thread the timeline / render time through `present()` →
`compositeLayers` → `processLayer` → `encodeFilmLooks`. Use that as the grain
seed. Preview's `renderFrames(_, time)` callback already exposes the timeline
time; export's `outputTimestamp` + `plan.rangeStartS` give the same.

### B5 — Phase 38 Lottie `.json` import is unreachable through the UI

`mediabunny-adapter.ts:625` accepts plain Lottie JSON files, but
`App.tsx`'s `VIDEO_PICKER_TYPES`, `MEDIA_FILE_PATTERN`, and `isImportableFile`
filter `application/json` and `.json` out. The Lottie code path is dead code
behind the normal Import flow.

**Expected:** Add `application/json` + `.json` to the picker types, the regex,
and the drag-drop filter.

### B6 — Phase 38 `.lottie` zip branch returns `null` cast as `MediaInputHandle`

`mediabunny-adapter.ts:617` writes `return { handle: null as unknown as MediaInputHandle, ... }`.
The worker then dereferences that null handle while building the source
descriptor, producing a generic null-deref crash instead of the documented
`lottie-zip-unsupported` health warning the spec promises.

**Expected:** Throw a structured `BlockedImportError` (new export from
`media-adapters/types.ts`) carrying the warning + inspection + conformance.
Worker import catches the error and routes it through `postSourceHealth`. The
adapter contract stops lying with a null cast.

### B7 — Phase 38 animated-image `effectiveFps` reports placeholder before init

`AnimatedImageFrameSource.effectiveFps` returns 25 until `ensureInitialized()`
decodes frame metadata, but the adapter stores `frameRate: animatedSource.effectiveFps`
on the handle immediately after construction. Animated WebP / GIF / AVIF
imports always report 25 fps regardless of their authored cadence; downstream
scheduling steps at the wrong rate.

**Expected:** `await animatedSource.ensureInitialized()` before reading
`effectiveFps` on the adapter side. (Make `ensureInitialized` public.)

### B8 — Phase 38 animated-image uses first-frame duration for every frame

`animated-image-source.ts:34-40` seeds `frameDurations[i]` with the **first**
frame's duration for every frame in the track. Animated GIF / WebP / AVIF with
variable per-frame delays mis-time after the first non-uniform delay; playback
and export are not frame-accurate.

**Expected:** Decode each frame's header once on init and store its actual
duration. Close the bitmap immediately — no buffering retained.

### B9 — Phase 38 `ImageDecoder` support probed via `typeof` only

`mediabunny-adapter.ts:344` treats a global `ImageDecoder` constructor as
support for every animated WebP / AVIF / GIF MIME. Browsers can expose the API
without the per-codec implementation; constructing then decoding throws and
the whole import fails instead of falling back to the static path.

**Expected:** Call `ImageDecoder.isTypeSupported(mimeType)` before constructing
`AnimatedImageFrameSource`. Fall through to the still-image path on `false`.

### B10 — Phase 38 silent static fallback for animated images

When `imageDecoder` is unsupported, animated GIF/WebP/AVIF imports drop into
the still-image branch with no warning, badge, or status line — the user sees
only the first frame and has no signal that the animation isn't broken. The
spec promised a visible "static (browser limitation)" indication.

**Expected:** Add a new `animated-image-static-fallback` info-severity warning
(non-blocking) when the static path handles an animated MIME. Surface it via
the existing source-health pipeline.

### B11 — Phase 38 Lottie clips placed with `STILL_DEFAULT_DURATION_S`

`worker.ts placeAsset` clips the duration to `STILL_DEFAULT_DURATION_S` (5 s)
whenever `handle.kind === 'image'`. The Lottie adapter sets `kind: 'image'` but
stores the animation's real duration on the handle. Result: a 12-second Lottie
animation is placed as a 5-second still clip and the rest of the animation is
silently discarded.

**Expected:** When `handle.kind === 'image'` AND `handle.duration` is below
`STILL_MAX_DURATION_S` (the still sentinel), use `handle.duration` as the
clip length. This covers both Lottie and animated images that report their
true playback length.

### B12 — Phase 38 look preset import is not atomic with the paired LUT

`worker.ts handleImportLookPreset` parses the `.cube` file in a try/catch and
only posts a project warning on failure — then commits the preset params
without the paired LUT. Users get a half-applied look (grain + halation +
vignette, but no grade) and have to manually clear it.

**Expected:** A bad or missing LUT (or a missing GPU renderer for the LUT
pass) rejects the entire preset import via `look-preset-error`. Either both
parts commit or neither does.

### B13 — Phase 21 source-normalize ignores per-clip colour metadata

`gpu.ts encodeSourceNormalize:853` writes a hardcoded `[2, 1]` (sRGB / full
range) to the uniform regardless of the clip's actual colour metadata. HDR
(PQ / HLG) sources are treated as sRGB; limited-range BT.709 is treated as
full-range. The decoder spec implies per-clip metadata flows through, but the
plumbing was never finished.

**Expected:** Add an optional `colorMetadata?: ColorMetadata` field to
`FrameCompositeLayer`. Populate it in both preview (`worker.ts` `makeGetLayers`
via `sourceDescriptors.get(...).video.color`) and export (`export.ts` via the
source inspection's video track). Map `transfer` to the shader's
`inverseTransfer` enum (via `selectNormalizeTransfer`) and `fullRange` to the
range bit. `unknown` transfer defaults to sRGB to preserve existing behaviour.

Gamut matrix multiplication is **not** included — the shader's `applyMatrix`
stub remains identity. That is a separate, larger change tracked as a
follow-up.

### B14 — Phase 21 scope `~luma` comment is misleading

`scopes.wgsl:63-66` had a `Min: store as ~luma (lower is darker)` comment
that read as if the code bit-inverts the luma value. The actual logic is
straightforward `atomicMin` / `atomicMax` on the raw quantized luma; the
comment misled future readers about what the column tracks.

**Expected:** Replace the `~luma` wording with a plain-English "tracks the
darkest (minimum quantized luma) in the column" / "tracks the brightest
(maximum quantized luma) in the column".

> **Note**: an earlier draft of this bug also called out that
> `gpu.ts dispatchScopes` was a no-op heartbeat stub. PR #111
> ("Phase 21: wire scope dispatch to real GPU compute pipelines") landed on
> main before this fix-up rebased; the heartbeat is gone, and the histogram /
> waveform / parade / vectorscope pipelines now dispatch inside the single
> per-frame submission and copy back via staging buffers + `mapAsync`. The
> docstring update this spec originally planned is therefore subsumed by
> PR #111 and dropped here.

### B15 — Phase 13 `sourceTailHandle` returns 0 on unknown source duration

`timeline.ts:464` returns `0` when `sourceDurations.durationForSource(...)` is
undefined (offline / unresolved source). `maxTransitionDurationS` then collapses
to 0 and `revalidateTransitions` permanently deletes the transition on the next
project restore or undo/redo cycle, even though the user intentionally placed
it and re-linking would make it valid.

**Expected:** Return `Number.POSITIVE_INFINITY` for unknown source durations.
`Math.min(clip.duration, ..., +Infinity, ...)` correctly preserves the
transition until the source re-links.

### B16 — Phase 13 redundant `sortByStart` on already-sorted clips

`timeline.ts:452` calls `sortByStart(track.clips)` every time a transition is
validated, even though every mutator that touches `track.clips`
(`insertClip`, `moveClips`, `paste`, `trim`, `split`) maintains start-order.
That's O(n log n) per validation, per timeline edit.

**Expected:** Read `track.clips` directly. The adjacency check below already
enforces ordering invariants.

### B17 — `removeTransition` and `setTransition` have no unit tests

Both mutators have non-trivial behaviour (partial patching, duration clamping
against source handles, zero-clamp removal, no-op reference equality). None of
that is covered.

**Expected:** New `describe('removeTransition')` and `describe('setTransition')`
blocks asserting id filtering, no-op reference equality, partial patch + clamp,
and zero-clamp removal.

### B18 — Phase 6 `VideoSample` → `VideoFrame` ownership is undocumented

`export.ts:1140` constructs `new VideoSample(exportFrame, ...)` and never
explicitly closes `exportFrame`; release relies on `sample.close()` propagating
to the wrapped frame. Mediabunny's type docs say "near zero-cost wrapper"
strongly implying ownership transfer, but the contract is not asserted in our
code — a future Mediabunny refactor could break this silently.

**Expected:** Inline a comment citing the Mediabunny contract and explicitly
warning against adding a second `exportFrame.close()` after `sample.close()`
(which would double-close the underlying VideoFrame).

### B19 — Phase 22 `exportSettingsForProbe` treats caption-only projects as unexportable

`worker.ts:5240` returns `null` from `exportSettingsForProbe` when there is no
`videoHandle` and no title clips, even when burned-in captions could render
over the default canvas. `setupPlayback` already special-cases this case; the
export probe doesn't, so the UI shows "no exportable content" for projects
that `buildExportPlan` would actually accept.

**Expected:** Mirror the `hasBurnedInCaptions` check from `setupPlayback`.

### B20 — Phase 20 overwrite edit silently splits linked A/V pairs

`worker.ts handleOverwriteEdit` calls `overwriteEdit(timeline, targetTrackIds,
...)` without checking linked-group invariants. If an existing clip on a
targeted track gets trimmed/deleted by the overwrite region and is part of a
linked group whose partner sits on an untargeted track, the partner stays put.
The user gets silent A/V desync.

**Expected:** Before mutating, walk the to-be-modified existing clips, expand
each linked group, and require all members to live on a targeted track. If
any partner is on an untargeted track, reject with a project warning telling
the user to add that track to edit targets or unlink the pair.

### B21 — Phase 32a `skinSmoothBypass` not keyed to selected clip

`Inspector.tsx:483` creates `[skinSmoothBypass, setSkinSmoothBypass] =
createSignal(false)` at component-mount, with no reset hook. When the user
toggles bypass on clip A and then selects clip B, B inherits A's bypass
state — the `aria-pressed` and visual state are wrong, and the bypass that
was meant to A/B clip A's smoothing now silently applies to clip B.

**Expected:** `createEffect(on(() => props.selectedClip?.clipId, () =>
setSkinSmoothBypass(false), { defer: true }))` resets bypass on every
clip-selection change.

### B22 — Phase 32a skin smoothing slider renders in non-WebGPU tiers

The strength slider renders unconditionally. In `canvas2d` / `limited-webcodecs`
tiers the smoothing effect is dropped at render time; users can set a
non-zero strength, see no preview change, and export with their changes
silently absent.

**Expected:** A new optional `previewTierSupportsSkinSmooth?: boolean` prop.
When `false`, the slider is `disabled` and an inline note explains "Skin
Smoothing requires WebGPU support. The current preview tier can't render the
effect, and any strength you set won't appear in preview or export." Wiring
the prop to the actual tier is the App.tsx caller's job; the Inspector itself
just gates honestly on whatever boolean it gets.

### B23 — Phase 32a skin-mask debounce loses sibling-slider edits

Each per-slider debouncer reads `currentSkinMask()` fresh, which returns
upstream `props.selectedClip.skinMask`. The upstream value is updated
asynchronously by the worker echo; if slider A commits and then slider B
fires within ~one upstream-round-trip, slider B's debouncer reads the
pre-A snapshot, merges B's pending value, and writes a mask that drops A's
just-committed change.

**Expected:** Maintain a local `skinMaskDraft` keyed by selected `clipId`.
Reads of `currentSkinMask()` in the schedule/flush path go through the draft,
which is reset only on clip change. Each debouncer flush emits the cumulative
draft, not a pre-A snapshot.

### B24 — Phase 23 `window.confirm` can be silently suppressed

`App.tsx:1907` uses `window.confirm` for the "Replace current project?"
prompt on bundle import. Cross-origin iframes, lapsed user gestures, and
some popup-blocker contexts return `false` from `confirm` without ever
showing a dialog. The user sees a silent import cancel — they think the
import did nothing and try again.

**Expected:** Replace with a state-driven modal: a new
`bundleReplacePrompt` signal holds `{ jobId, message }`; the JSX renders a
`role="dialog"` modal-backdrop with Cancel / Replace buttons that dispatch
the existing `bundle-replace-decision` message. No reliance on
gesture-context for visibility.

### B25 — Phase 24 queue file picker lacks activation for jobs 2+

Multi-job queue export uses `showSaveFilePicker` to choose output files. The
first job runs from the user's "Run Queue" click — activation present. Every
subsequent job's `handleQueueJobDestination` is called from a background
completion callback with no active user gesture; `showSaveFilePicker` rejects
with `SecurityError`, which the existing catch treats identically to "user
cancelled" → `queue-job-skip`, and the job is silently dropped.

**Expected:** Detect `DOMException(name: 'SecurityError')` specifically.
Surface a status line ("Queue paused: pre-select all output files via Run
Queue") and dispatch a new `queue-pause` message so the worker stops
issuing further job requests instead of cascading skips. Pre-select-all flow
already exists (`preselectQueueOutputHandles`); this is the graceful-fallback
when it didn't run or was cancelled.

### B26 — Phase 25 diagnostic-snapshot uses fragile positional index

`diagnostic-snapshot.ts:125` reads `findings[1]!` to populate
`sharedArrayBuffer`. Any future prepend to the findings array silently
mis-routes the SAB finding to a different capability — no type error, no
test failure, just wrong diagnostic data.

**Expected:** Assign each finding to a named const (`isolationFinding`,
`sabFinding`, `webgpuFinding`, `webcodecsFinding`) and reference by name.

### B27 — Phase 40 stale `LanguageDetector` session never re-created

`translation-controller.ts:243-247` calls `detector!.detect(text).catch(() =>
[])`. When Chrome reclaims the cached `LanguageDetector` session (idle
timeout), all subsequent detects reject silently, the dominant-language pick
falls through to `oppositeLanguage(sourceLang)`, and the user cannot
auto-detect for the rest of the app session — they have to reload.

**Expected:** When the per-segment `.catch` fires, set a local `sessionLost`
flag. After the `Promise.all`, if `sessionLost`, null out `this.detector` so
the next `translate()` calls `DetectorApi.create()` fresh.

### B28 — Phase 40 empty-segments post a success-shaped message with empty trackId

`worker.ts handleAddTranslatedCaptionTrack` validates segments and, on
malformed / empty input, posts `translated-caption-track-created` with an
empty `trackId`. The UI handler keys off the type and shows "Translated
caption track created" — the user thinks success while no track was added.

**Expected:** A new distinct `translated-caption-track-error` protocol
message carrying `reason` (`'empty-segments' | 'malformed-segments'`) and
`message`. App.tsx routes it to an error state via the controller's new
`onTranslatedTrackError(reason, message)` port.

### B29 — Phase 40 invalid `eslint-disable` rule prefix

`LanguageToolsPanel.tsx:45` says `// eslint-disable-next-line eslint/no-unassigned-vars`.
There is no `eslint/` namespace for that rule; the disable line is a no-op.

**Expected:** Drop the prefix; comment becomes plain
`// eslint-disable-next-line no-unassigned-vars`. Also add an explanatory
sentence about SolidJS's JSX-driven ref assignment.

### B30 — Phase 47 spec gap: missing `Location` header on 201 is "retryable"

`requirements.md` R1.1 doesn't classify the failure mode where a server
returns `201 Created` but no `Location` header. The implementation maps it to
a generic retryable error, but without the session-resource URL there is no
session to PATCH or DELETE — the client retries until the user gives up.

**Expected:** R1.1 codifies this as a `protocol-error` failure reason and
explicitly excludes it from the retry policy.

### B31 — Phase 47 spec gap: ICE gathering timeout default unspecified

`requirements.md` R1.6 says "bounded by a timeout" but doesn't say what
value. Implementations have varied between 2.5 s (too tight on cellular /
VPN) and 30 s (sluggish on the happy path).

**Expected:** R1.6 specifies a 10-second default, overridable via
`WhipSessionDeps.gatherTimeoutMs`, with a one-line rationale.

### B32 — Phase 47 spec gap: synthetic program feed method not documented

`tasks.md` T10.2 says "Chromium publishes a synthetic program feed" but
doesn't describe how that feed is built. The CI harness uses
`HTMLCanvasElement.captureStream` + `MediaStreamAudioDestinationNode`; the
spec should capture that so anyone reading it doesn't burn time
re-engineering it.

**Expected:** T10.2 explicitly describes Canvas2D + `captureStream` + audio
context.

### B33 — Phase 38 in-app guide missing Look Packs and Animated Overlays pages

PR #73 added the user-facing Look Packs and Animated Overlays guidance to
`docs/USER-GUIDE.md` only. The in-app `/docs` route is bundled from
`src/features/docs/content/`, and that directory has no matching markdown.
Users who open the bundled guide see no documentation for these
user-visible features.

**Expected:** Create `look-packs.md` and `animated-overlays.md` in
`src/features/docs/content/`, register them in `docsManifest.ts`, and
mirror the `docs/USER-GUIDE.md` sections.

### B34 — `scripts/build-wasm.mjs` base64 wrapping is a no-op

The script chunks the base64 into 76-char strings and then `lines.join('')`
flattens them back into one giant line. The generated TS embeds an
unwrapped base64 blob — the chunking is dead code.

**Expected:** `lines.join('" +\n\t"')` so the chunks become adjacent string
literals separated by line breaks, matching the format the comment claims.

## Findings reviewed and intentionally excluded

For audit transparency, several reviewer comments were checked and **not**
acted on. The reasons:

- **Phase 6 worker.ts probe skip (PR #6, line 5176-5180):** Gemini suggested
  guarding on `!handle.videoSink` instead of `!handle.frameSource`. The
  current `!handle.frameSource` is equivalent for audio-only files (frameSource
  is null) and is the right level of abstraction; the codebase doesn't use
  `videoSink` as a public concept. No change.
- **Phase 11 (PR #11) sample-rate plan-time gate:** Codex flagged plan-time
  sample-rate mismatch as a P1. The codebase has since added a polyphase
  resampler (`audio-resample.ts`) that handles per-source rate conversion in
  `pcmWindowAt`. An explicit test
  (`allows mixed audible audio sample rates (resampler handles conversion)`)
  guards the current behaviour. The reviewer comment is no longer applicable;
  a brief comment in `buildExportPlan` documents why no gate is needed.
- **Phase 2 storage-texture-view caching:** Gemini suggested adding a
  cached `storageTextureView` field. The current code already caches via
  `storageAView` / `storageBView` / `storageCView` populated in
  `setPreviewSize`. The reviewer was reading the original PR diff, not
  current main. No change.
- **Phase 23 `loadStoredProject` skip-when-non-empty:** Codex P2 said
  `needsReplaceConfirmation` always pays the DB hit. Re-reading the function,
  the early return on `!ctx.currentProjectIsEmpty()` correctly avoids the
  `loadStoredProject` call when the project is non-empty. No change.
- **Phase 35 spec easing-set mismatch:** Gemini flagged a mismatch between
  the spec's easing types and `keyframes.ts`. Current `design.md` lists
  `'linear' | 'ease' | 'hold'`, matching `keyframes.ts`. The reviewer comment
  was filed against an earlier draft. No change.
- **Phase 35 spec `pcmAt` vs `pcmWindowAt`:** Same as above — current
  `tasks.md` uses `pcmWindowAt` throughout. No change.
- **Phase 35 OTIO `timeRemap` round-trip:** The OTIO import path does not
  exist yet (export-only). Verification deferred to whenever the import
  side ships.
- **Phase 71 worker.ts `timeRemapSourceDuration` clip.duration derivation:**
  The function already takes `sourceDurationS` from the snapshot; the field
  is populated correctly. No change.
- **Phase 71 worker.ts remap PCM single-timestamp:** This is a real issue
  but the fix requires iterating over LUT segments in `extractPcmForAsr` /
  `pcmAtForAudioCleanup` — both paths feed into ASR and Audio Cleanup, both
  LiteRT-dependent. Deferred to the ONNX migration so we don't fix code
  that's about to be rewritten.
