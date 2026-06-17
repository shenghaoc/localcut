# Tasks: Bugfix — merged-phase review-comment fix-up

> Status: **In review** (PR #112). Tasks map 1:1 to the bugs in `bugfix.md`
> and the design in `design.md`. All tasks landed in a single commit.

## T1 — Phase 38 film-look correctness (B1–B4)

- [x] **T1.1** `src/engine/effects.ts encodeFilmLooks`: pick ping-pong start
  slot from `currentSrc`'s storage slot identity (B1).
- [x] **T1.2** `src/engine/shaders/grain.f16.wgsl`,
  `halation.f16.wgsl`, `vignette.f16.wgsl`: replace scalar `f16(vec3f)` with
  `vec3<f16>(vec3f)` (B2).
- [x] **T1.3** `src/engine/shaders/halation.wgsl` + `halation.f16.wgsl`:
  change `radius: i32` → `f32`; add 16-tap golden-spiral Gaussian-weighted
  bright-pass blur (B3).
- [x] **T1.4** `src/engine/gpu.ts`: thread `renderTimeS` through
  `present()` → `compositeLayers()` → `processLayer()` → `encodeFilmLooks`
  for grain seeding; default 0 for back-compat (B4).
- [x] **T1.5** `src/engine/worker.ts:5113`: pass `timestamp` to
  `renderer.present(stack, timestamp)`.
- [x] **T1.6** `src/engine/gpu.ts renderLayeredForExport`: add
  `renderTimeS = timestamp` parameter; `renderBlackForExport` passes
  `timestamp`.
- [x] **T1.7** `src/engine/export.ts:1132`: pass `timelineTime` as the
  `renderTimeS` to `renderLayeredForExport`.

## T2 — Phase 38 Lottie + animated-image hardening (B5–B11)

- [x] **T2.1** `mediabunny-adapter.ts openImageFile`: probe
  `ImageDecoder.isTypeSupported(mimeType)` before constructing
  `AnimatedImageFrameSource` (B9).
- [x] **T2.2** `mediabunny-adapter.ts`: `await
  animatedSource.ensureInitialized()` before storing `frameRate` on the
  handle (B7); make `AnimatedImageFrameSource.ensureInitialized` public.
- [x] **T2.3** `animated-image-source.ts ensureInitialized`: per-frame
  duration decode + `toDurationSeconds` helper (B8).
- [x] **T2.4** `src/protocol.ts`: add
  `'animated-image-static-fallback'` to `SourceHealthWarningCodeSnapshot`.
- [x] **T2.5** `mediabunny-adapter.ts openImageFile` static branch: push the
  fallback warning when MIME is animated (B10).
- [x] **T2.6** `media-adapters/types.ts`: export `BlockedImportError` class
  carrying `warnings`, `inspection`, `conformance`.
- [x] **T2.7** `mediabunny-adapter.ts open`: throw `BlockedImportError`
  for `.lottie` zip instead of returning `null as MediaInputHandle` (B6).
- [x] **T2.8** `worker.ts` import catch: route `BlockedImportError` to
  `postSourceHealth` before falling through to the generic error toast.
- [x] **T2.9** `worker.ts placeAsset`: use `handle.duration` for animated
  images (Lottie + animated GIF/WebP/AVIF) rather than
  `STILL_DEFAULT_DURATION_S`; new local `isAnimatedImage` flag based on
  `handle.duration < STILL_MAX_DURATION_S` (B11).
- [x] **T2.10** `worker.ts` imports: re-export `STILL_MAX_DURATION_S` from
  `./media-io` (via `media-adapters/mediabunny-adapter`).
- [x] **T2.11** `src/ui/App.tsx`: add `application/json` + `.json` to
  `VIDEO_ACCEPT`, `VIDEO_PICKER_TYPES`, `MEDIA_FILE_PATTERN`, and
  `isImportableFile` (B5).

## T3 — Phase 38 look preset atomicity (B12)

- [x] **T3.1** `worker.ts handleImportLookPreset`: reject the import via
  `look-preset-error` if the user provided a `.cube` file and (a) no GPU
  renderer is available, or (b) the LUT parse throws. No partial commit.

## T4 — Phase 21 colour metadata wiring (B13)

- [x] **T4.1** `src/engine/gpu.ts FrameCompositeLayer`: add optional
  `colorMetadata?: ColorMetadata` with docstring describing the gamut-matrix
  limitation.
- [x] **T4.2** `gpu.ts encodeSourceNormalize`: derive
  `inverseTransfer`/`fullRange` from `layer.colorMetadata`, mapping
  `unknown` transfer to sRGB.
- [x] **T4.3** `gpu.ts` import: pull in `NormalizeTransfer` +
  `selectNormalizeTransfer` from `./colour`.
- [x] **T4.4** `worker.ts LayerMeta.frame`: add `colorMetadata?:
  ColorMetadata`. New helper `colorMetadataForSource(sourceId)`.
- [x] **T4.5** `worker.ts makeGetLayers`: populate `colorMetadata` on the
  decoded frame layer.
- [x] **T4.6** `worker.ts renderFrames`: forward
  `layer.meta.colorMetadata` into the pushed `CompositeLayer`.
- [x] **T4.7** `export.ts`: look up the video track inspection and call
  `colorMetadataFromHints` per frame layer push; add the import.

## T5 — Phase 21 scope comment (B14)

- [x] **T5.1** `shaders/scopes.wgsl:63-66`: replace the `~luma` comment
  with a plain-English "tracks the darkest / brightest quantized luma".
- [~] **T5.2** ~`gpu.ts dispatchScopes`: rewrite docstring to mark the stub
  INCOMPLETE.~ Subsumed by PR #111 (Phase 21 scope dispatch shipped to main
  before this fix-up rebased). No edit needed.

## T6 — Phase 13 transitions (B15–B17)

- [x] **T6.1** `timeline.ts sourceTailHandle`: return
  `Number.POSITIVE_INFINITY` for unresolved sources.
- [x] **T6.2** `timeline.ts transitionBoundary`: drop the redundant
  `sortByStart` call; comment the invariant.
- [x] **T6.3** `timeline.test.ts`: import `removeTransition`,
  `setTransition`.
- [x] **T6.4** `timeline.test.ts`: new `describe('removeTransition')` with
  id-filter + no-op reference equality tests.
- [x] **T6.5** `timeline.test.ts`: new `describe('setTransition')` with
  partial-patch + clamp, zero-clamp removal, and no-op reference equality
  tests. Use `'cross-dissolve'` (a valid `TransitionKind`) so the no-op
  test exercises the equality path correctly.

## T7 — Phase 6 export contract documentation (B18)

- [x] **T7.1** `export.ts`: inline a multi-line comment before
  `new VideoSample(exportFrame, ...)` citing the mediabunny ownership
  contract; add a warning comment before `videoSource.add(sample).finally(()
  => sample.close())` against adding a second explicit
  `exportFrame.close()`.

## T8 — Phase 22 caption-only export gate (B19)

- [x] **T8.1** `worker.ts exportSettingsForProbe`: add the
  `hasBurnedInCaptions` check mirroring `setupPlayback`.

## T9 — Phase 20 overwrite linked-pair guard (B20)

- [x] **T9.1** `worker.ts handleOverwriteEdit`: pre-validate that no
  affected linked group has a partner on an untargeted track; reject via
  `postProjectWarning` if so.

## T10 — Phase 32a Inspector skin smoothing UX (B21–B23)

- [x] **T10.1** `Inspector.tsx`: import `on` from `solid-js`; add
  `createEffect(on(() => props.selectedClip?.clipId, () =>
  setSkinSmoothBypass(false), { defer: true }))`.
- [x] **T10.2** `Inspector.tsx`: new optional
  `previewTierSupportsSkinSmooth?: boolean` prop on `InspectorProps`.
- [x] **T10.3** `Inspector.tsx`: disable the strength slider and render an
  inline note explaining the WebGPU dependency when the prop is `false`.
- [x] **T10.4** `Inspector.tsx`: introduce `skinMaskDraft` keyed by
  `clipId`; route flush + schedule through `getSkinMaskDraft()` instead of
  re-reading `currentSkinMask()` each time.

## T11 — Phase 23 bundle-replace modal (B24)

- [x] **T11.1** `App.tsx`: new `bundleReplacePrompt` signal carrying
  `{ jobId, message } | null`.
- [x] **T11.2** `App.tsx` `'bundle-replace-prompt'` case: set the signal
  instead of calling `window.confirm`.
- [x] **T11.3** `App.tsx` JSX: render a `role="dialog" aria-modal="true"`
  modal-backdrop with Cancel + Replace buttons; both dispatch
  `'bundle-replace-decision'` and clear the signal.
- [x] **T11.4** `global.css`: append `.modal-backdrop` +
  `.bundle-replace-modal` styles using existing CSS-var tokens.

## T12 — Phase 24 queue picker activation handling (B25)

- [x] **T12.1** `protocol.ts`: add `{ type: 'queue-pause' }` to the
  worker command union.
- [x] **T12.2** `App.tsx handleQueueJobDestination`: detect
  `DOMException` with `name === 'SecurityError'`; set a status line,
  send `queue-job-skip`, send `queue-pause`.
- [x] **T12.3** `worker.ts` switch: route `'queue-pause'` to
  `handleQueueCancelAll()`.

## T13 — Phase 25 diagnostic-snapshot named consts (B26)

- [x] **T13.1** `diagnostic-snapshot.ts`: extract each finding into a
  named const; reference `sabFinding` directly in the return object.

## T14 — Phase 40 language tools (B27–B29)

- [x] **T14.1** `translation-controller.ts` auto-detect path: set local
  `sessionLost = true` from the per-segment `.catch`; after `Promise.all`,
  null out `this.detector` if `sessionLost`.
- [x] **T14.2** `protocol.ts`: add the
  `'translated-caption-track-error'` message.
- [x] **T14.3** `translation-controller.ts`: new
  `onTranslatedTrackError(reason, message)` method + matching port.
- [x] **T14.4** `worker.ts handleAddTranslatedCaptionTrack`: replace
  empty-segment / malformed-segment "success" posts with the new error
  message.
- [x] **T14.5** `App.tsx`: handle
  `'translated-caption-track-error'` → controller + `setRuntimeIssue`.
- [x] **T14.6** `LanguageToolsPanel.tsx`: replace the bogus
  `eslint/no-unassigned-vars` rule prefix with the correct
  `eslint-disable-next-line no-unassigned-vars`.

## T15 — Phase 47 spec corrections (B30–B32)

- [x] **T15.1** `phase-47-whip-publish/requirements.md` R1.1: codify the
  missing-`Location`-on-201 case as a non-retryable `protocol-error`.
- [x] **T15.2** R1.6: specify the 10-second ICE gather timeout default
  and `WhipSessionDeps.gatherTimeoutMs` override.
- [x] **T15.3** `phase-47-whip-publish/tasks.md` T10.2: describe the
  Canvas2D `captureStream` + `MediaStreamAudioDestinationNode` synthetic
  feed.

## T16 — In-app guide content (B33)

- [x] **T16.1** `src/features/docs/content/look-packs.md`: mirror the
  USER-GUIDE Look Packs section.
- [x] **T16.2** `src/features/docs/content/animated-overlays.md`: mirror
  the USER-GUIDE Animated Overlays section.
- [x] **T16.3** `src/features/docs/docsManifest.ts`: import the two
  markdowns and register them in `DOC_SECTIONS`.

## T17 — `build-wasm.mjs` base64 wrapping (B34)

- [x] **T17.1** `scripts/build-wasm.mjs`: `lines.join('" +\n\t"')` so the
  generated TS embeds adjacent string literals.

## T18 — Gate

- [x] **T18.1** `pnpm run check` green (format + lint + typecheck + 2010
  tests + production build).
- [x] **T18.2** Test count grows by at least 4 (the new transition
  tests).

## Out-of-scope follow-ups (deferred to separate work)

- **Phase 21 scope compute dispatch** — _shipped_ on main as PR #111
  before this fix-up rebased. The originally-planned docstring-stub update
  in this spec is now a no-op (the stub is gone).
- **Phase 21 source-normalize gamut matrix** — wired transfer + range only.
  Matrix multiplication remains identity; the shader comment documents the
  limitation.
- **OTIO `timeRemap` round-trip** — OTIO is export-only currently; deferred
  until the import path lands.
- **Litert-coupled findings** (Phase 71 remap PCM extraction for
  ASR / Audio Cleanup, etc.) — deferred to the ONNX migration so we don't
  fix code about to be rewritten.
