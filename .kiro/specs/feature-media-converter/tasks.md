# Tasks: Media Converter

> Status: **Active**. Tasks map to `requirements.md` and `design.md`. Tracks the
> work on `claude/app-media-converter-5d4355`.

## T1 — Shared types & format registry (R3, R8.1)

- [x] **T1.1** Add to `src/protocol.ts`: `ConvertFormatId`, `ConvertQuality`,
  `ConvertTargetSpec`, `ConvertInputInfo`, `ConvertWorkerCommand`,
  `ConvertWorkerState` (discriminated unions, `import type` only on the worker
  side so they erase at build).
- [x] **T1.2** Create `src/features/convert/convert-formats.ts`: UI-safe (no
  Mediabunny) `ConvertFormatDescriptor` registry `CONVERT_FORMATS` keyed by
  `ConvertFormatId`; `CONVERT_BASE_PATH = '/convert'`; `parseConvertPath`;
  `defaultFormatForInput(info)`; `outputFileName(input, formatId)`;
  `convertFormatById`.

## T2 — Engine: Mediabunny mapping & worker (R2.3, R3.4, R4, R5.2, R6)

- [x] **T2.1** Create `src/engine/convert/convert.ts`: `createOutputFormat(id)`
  (id → Mediabunny `OutputFormat`), `qualityFor(q)` (→ `QUALITY_*`),
  `PREFERRED_VIDEO_CODECS`/`PREFERRED_AUDIO_CODECS` per format,
  `probeInput(input)` → `ConvertInputInfo`, and `resolveCodecs(format, …)` using
  `getFirstEncodableVideo/AudioCodec` constrained to the format's supported
  codecs.
- [x] **T2.2** Create `src/engine/convert/convert-worker.ts`: dispatch
  `convert-probe` / `convert-start` / `convert-cancel`; build `Input` from
  `BlobSource`; build `Output` on `BufferTarget`; `Conversion.init` with resolved
  codecs (`video: { discard: true }` for audio-only targets); guard `isValid`
  (post `convert-failed` with discard reasons); wire `onProgress`; `execute()`;
  transfer the output `ArrayBuffer` on `convert-done`; map
  `ConversionCanceledError` → `convert-canceled`; hold a single
  `activeConversion`/`activeJobId`.

## T3 — UI bridge & ConvertPage (R1, R2, R4.4, R4.5, R5)

- [x] **T3.1** Create `src/ui/convert-bridge.ts`: `spawnConvertWorker(onState,
  onCrash)` mirroring `cleanup-bridge.ts` (`new Worker(new URL(
  '../engine/convert/convert-worker.ts', import.meta.url), { type: 'module' })`).
- [x] **T3.2** Create `src/features/convert/ConvertPage.tsx`: header
  (`Back to editor`, Escape close, guide link), drop zone + file picker
  (multiple), batch job list with per-job format select, quality select,
  Convert / Cancel / Retry, progress bar, and Save (showSaveFilePicker →
  writable, else anchor download); `createStore` job list; lazily spawn + tear
  down the worker; route `ConvertWorkerState` by `jobId`; sequential FIFO so one
  job converts at a time; "Convert all".
- [x] **T3.3** Add Convert-view styling to `src/global.css` using existing
  design tokens (no hard-coded colours): `.convert-page`, `.convert-dropzone`,
  `.convert-job`, progress bar, status chips.

## T4 — Routing & entry point (R1.1, R1.3, R1.4, R8.2)

- [x] **T4.1** `App.tsx`: import `ConvertPage`, `parseConvertPath`; add
  `convertOpen` signal seeded from the path; `openConvert`/`closeConvert` with
  `pushState` + focus restore; update the `popstate` handler to refresh both
  docs and convert routes; gate keyboard shortcuts and set the shell `inert` for
  either overlay; render the `<Show when={convertOpen()}>` block.
- [x] **T4.2** `toolbar-menus.ts`: add `{ id: 'convert', label: 'Convert media…' }`
  to the `Project` group; add `onConvert` to `CommandActionsBuildOptions` and a
  `Convert media` command action.
- [x] **T4.3** `Toolbar.tsx`: add `onOpenConvert?` prop; `case 'convert'` in
  `runMenuItem`; pass `onConvert` into `buildCommandActions`. Wire
  `onOpenConvert={() => openConvert()}` from `App.tsx`.

## T5 — Documentation (R7)

- [x] **T5.1** Add `src/features/docs/content/media-conversion.md` (what Convert
  does, supported formats, stream-copy vs transcode, on-device + offline, the
  in-memory output caveat, no-editing note).
- [x] **T5.2** Register the section in `docsManifest.ts` (slug
  `media-conversion`, after `exporting`) and link it from the ConvertPage empty
  state.

## T6 — Tests & gate (R8)

- [x] **T6.1** `src/engine/convert/convert.test.ts`: registry invariants
  (unique ids/extensions, kind correctness), `defaultFormatForInput`
  (video→mp4, audio-only→mp3), `outputFileName` (extension swap, no double-dot,
  extensionless input), `parseConvertPath` round-trip + rejection,
  every video format lists ≥1 preferred codec.
- [x] **T6.2** Extend `src/ui/toolbar-menus.test.ts`: `Project › Convert media…`
  present and not disabled; `Convert media` command action present and routes to
  `onConvert`.
- [x] **T6.3** `vp run check` green (format + lint + typecheck + Vitest + build);
  test count grows.

## T7 — Manual verification

- [ ] **T7.1** `Project › Convert media…` opens `/convert`; the editor is inert
  behind it; `Escape` / `Back to editor` / browser-back return with focus
  restored. Refreshing on `/convert` stays on the converter.
- [ ] **T7.2** Drop a video file → it probes and shows container/duration/tracks;
  default target is MP4. Convert → progresses to done; Save writes a playable
  file.
- [ ] **T7.3** Convert the same file to WebM (transcode) and to MP3 (audio
  extracted); verify the MP3 has no video and plays.
- [ ] **T7.4** Queue three jobs, "Convert all" runs them one at a time; cancel
  the middle one — the third still completes; retry the canceled one.
- [ ] **T7.5** In a non-cross-origin-isolated tab (limited tier), conversion
  still works (WebCodecs needs no COOP/COEP).
- [ ] **T7.6** An unreadable/garbage file becomes a failed job with a message,
  not a thrown error or a frozen page.
