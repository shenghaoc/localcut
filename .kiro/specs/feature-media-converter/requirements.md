# Requirements: Media Converter

> Status: **Active**. Adds a standalone, client-side media converter ("Convert"
> mode) that re-containers and transcodes dropped/picked files into a chosen
> output format, independent of the editing timeline. Tracks the work on
> `claude/app-media-converter-5d4355`.

## Motivation

The editor already decodes, encodes, and muxes media entirely in the browser,
but every output path runs through the timeline: to change a file's container
or codec a user must import it, place a clip, and run a full timeline export —
which clobbers the current project and routes the file through the GPU
compositor. Creators frequently just want "turn this `.mov` into an `.mp4`",
"extract the audio as `.mp3`", or "shrink this clip to a smaller `.webm`"
without touching their edit. A dedicated converter makes that a one-screen job
and reuses the browser's WebCodecs/Mediabunny stack, so it stays
client-compute, offline-capable, and free of server cost.

## R1 — A separate Convert surface

- **R1.1** Convert is a history-backed, full-screen view layered over the
  editor at the route `/convert`, mirroring the in-app User Guide (`/docs`): the
  editor shell stays mounted (worker, timeline, autosave keep running) and is
  made `inert` while Convert covers it.
- **R1.2** Opening Convert never mutates the editing project: it does not import
  into the media bin, place clips, or touch the pipeline worker / timeline.
- **R1.3** Convert is reachable from the `Project` menu (`Convert media…`) and
  from the command palette; closing it (`Back to editor`, `Escape`, or browser
  back) returns to the editor with focus restored to the launcher.
- **R1.4** A `/convert` deep link / refresh resolves to the Convert view via the
  existing SPA fallback; an unknown sub-path normalises to the editor.

## R2 — Input acquisition

- **R2.1** Users add one or more files by file picker (File System Access
  `showOpenFilePicker` with a drag-and-drop and `<input type=file>` fallback)
  **and** by dropping files onto the Convert drop zone.
- **R2.2** Each added file becomes a **conversion job** in a batch list; the
  same file can be added multiple times (e.g. to produce two formats).
- **R2.3** On add, the converter probes the input off the main thread and
  surfaces its container, duration, track presence (video/audio), resolution,
  and source codecs. A file Mediabunny cannot read is reported as a failed job
  with a clear message — it never throws into the page.

## R3 — Output selection

- **R3.1** Each job picks one target format from a fixed, feature-detected
  registry: video containers **MP4** (H.264/AAC), **WebM** (VP9/Opus),
  **MKV** (VP9/Opus), **MOV** (H.264/AAC); audio-only containers **MP3**,
  **WAV**, **OGG** (Opus). Audio-only targets on a video input extract the audio
  (video track discarded).
- **R3.2** A quality control (**High / Medium / Low**) maps to Mediabunny
  `Quality` presets; the converter never asks for a raw bitrate in the MVP.
- **R3.3** The default target for a new job is "same family, web-friendly":
  video inputs default to MP4, audio-only inputs default to MP3. The user can
  change it per job before converting.
- **R3.4** The output codec is chosen by the worker via Mediabunny encodability
  probing constrained to the format's supported codecs, so an option is never
  offered that the browser cannot actually encode; if no encodable codec exists
  the job fails honestly (surfacing Mediabunny's discard reason).

## R4 — Conversion execution

- **R4.1** Conversion runs in a dedicated, lazily-spawned **convert worker**,
  separate from the pipeline worker, using Mediabunny's high-level `Conversion`
  API. The main thread never decodes/encodes/muxes (architectural hard gate).
- **R4.2** When the source codec already satisfies the target container,
  Mediabunny stream-copies (remux, no re-encode); otherwise it transcodes.
  Either way is the library's decision — the converter does not force a
  transcode.
- **R4.3** Conversion does **not** require `crossOriginIsolated` (WebCodecs works
  without COOP/COEP), so Convert is available in the limited capability tier as
  well as the full-performance tier.
- **R4.4** Jobs in the batch run **sequentially** (one encoder pipeline at a
  time); each job reports live progress (fraction + processed input seconds).
- **R4.5** A running job can be canceled; a canceled or failed job can be retried
  (re-runs with the same target). Cancel/fail of one job never aborts the others.
- **R4.6** Trim and resolution/frame-rate overrides are **out of MVP scope**;
  the design leaves seams for them but the shipped converter is whole-file at
  source geometry.

## R5 — Output delivery

- **R5.1** On success the converter produces the output file and offers a save:
  File System Access `showSaveFilePicker` when available, otherwise an anchor
  download with the derived filename.
- **R5.2** The output filename derives from the input name with the target
  extension (e.g. `clip.mov` → `clip.mp4`); duplicate adds of the same input do
  not overwrite each other's downloads (the user chooses the destination).
- **R5.3** Completed jobs show output size and elapsed time; failed jobs show the
  reason.

## R6 — Resource safety

- **R6.1** The convert worker is spawned only when the Convert view is first
  opened (or a job starts), and terminated when appropriate; nothing
  Mediabunny/encoder-related enters the startup module graph.
- **R6.2** Canceling a job aborts the in-flight `Conversion` cleanly
  (`ConversionCanceledError` path) with no leaked decoders/encoders.
- **R6.3** No `VideoFrame`/`AudioData` is leaked or double-closed — the converter
  delegates frame ownership to Mediabunny's pipeline and adds no manual frame
  loop.

## R7 — Documentation

- **R7.1** A new in-app User Guide section (`media-conversion`) documents what
  Convert does, the supported formats, stream-copy vs transcode, the in-memory
  output caveat, and that it runs fully on-device.
- **R7.2** The section is registered in the docs manifest/nav and linked from the
  Convert view's empty state.

## R8 — Testing & gate

- **R8.1** Unit tests cover the pure converter logic: the format registry
  (ids/extensions/mime/kind), default-target selection per input shape, output
  filename derivation, and target→Mediabunny-format/codec mapping invariants.
- **R8.2** Unit tests cover the menu/route helpers: `Convert media…` is present
  in the `Project` menu and the command palette; `parseConvertPath` maps
  `/convert` ↔ the view and rejects other paths.
- **R8.3** `vp run check` (format + lint + typecheck + Vitest + production build)
  stays green; the test count grows.

## Non-goals

- No editing of the converted media (cut/effect/colour) — that is the editor.
- No batch ZIP, no folder-output automation, no render-queue persistence across
  reloads (the editor's Phase 24 render queue covers persistent timeline jobs).
- No arbitrary "any format to any format" beyond what WebCodecs + Mediabunny can
  decode/encode; unsupported inputs/targets fail honestly rather than via a WASM
  fallback transcoder.
- No trim/resize/fps controls in the MVP (R4.6).
- No server upload, telemetry, or cloud compute.
