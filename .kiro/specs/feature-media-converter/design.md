# Design: Media Converter

> Status: **Active**. A standalone converter layered over the editor, powered by
> Mediabunny's high-level `Conversion` API in a dedicated worker. Reuses the
> browser's WebCodecs stack without touching the timeline.

## Why a separate worker, not the export pipeline

The timeline export path (`exportTimeline` in `src/engine/export.ts`) renders
the authoritative timeline frame-by-frame through the WebGPU compositor. Pointing
it at an arbitrary dropped file would require loading that file as a source +
clip, which mutates the user's project and pays the full compositor cost for what
is fundamentally a remux/transcode.

Mediabunny ships a `Conversion` class built exactly for file→file conversion: it
stream-copies encoded packets when the source codec fits the target container and
only transcodes (decode→encode via WebCodecs) when it must. It reports progress,
supports cancellation, and exposes `isValid` / `discardedTracks` for honest
failure. So Convert is a **separate, lazily-spawned worker** that owns a
`Conversion` per job — mirroring the existing "lazy, cancellable Audio Cleanup
worker separate from the pipeline worker" pattern (`cleanup-bridge.ts` +
`audio-cleanup/cleanup-ort-worker.ts`). It never imports the pipeline worker,
the renderer, or the timeline.

This also means Convert works **without `crossOriginIsolated`**: WebCodecs does
not need COOP/COEP (only `SharedArrayBuffer` does), so the converter is available
in the limited capability tier too.

## Module map

| Module | Thread | Responsibility |
|--------|--------|----------------|
| `src/features/convert/convert-formats.ts` | shared (UI-safe, **no** Mediabunny) | Target-format descriptor registry keyed by `ConvertFormatId`; route path constants (`/convert`); `parseConvertPath`; `defaultFormatForInput`; `outputFileName` |
| `src/protocol.ts` (additions) | shared types | `ConvertFormatId`, `ConvertQuality`, `ConvertTargetSpec`, `ConvertInputInfo`, `ConvertWorkerCommand`, `ConvertWorkerState` |
| `src/engine/convert/convert.ts` | worker | Mediabunny mapping: `createOutputFormat(id)`, `pickQuality(q)`, `probeInput(input)`, `buildConversion(file, target, onProgress)`; pure helpers re-exported from `convert-formats` |
| `src/engine/convert/convert-worker.ts` | worker | Worker entry: dispatch `convert-start` / `convert-cancel`; run one `Conversion` at a time; post progress/result/error; `BufferTarget` → transfer output `ArrayBuffer` back |
| `src/engine/convert/convert.test.ts` | node | Unit tests for the pure registry/helpers |
| `src/ui/convert-bridge.ts` | main | `spawnConvertWorker(onState, onCrash)` — mirrors `cleanup-bridge.ts` |
| `src/features/convert/ConvertPage.tsx` | main | The full-screen Convert view: drop zone + batch job list + per-job format/quality/convert/cancel/retry/save; owns the job store and the worker lifecycle |
| `src/features/docs/content/media-conversion.md` | content | User Guide section |

`convert-formats.ts` holds **only plain data** (ids, labels, extensions, mime,
`kind: 'video' | 'audio'`, preferred codec lists) so it is safe to import on the
main thread without pulling Mediabunny into the app bundle. The engine modules do
the Mediabunny work and are reached only through the `?worker`-instantiated
convert worker.

## Shared types (protocol.ts)

```ts
export type ConvertFormatId =
  | 'mp4' | 'webm' | 'mkv' | 'mov'   // video containers
  | 'mp3' | 'wav' | 'ogg';          // audio-only containers

export type ConvertQuality = 'high' | 'medium' | 'low';

export interface ConvertTargetSpec {
  formatId: ConvertFormatId;
  quality: ConvertQuality;
}

export interface ConvertInputInfo {
  fileName: string;
  containerLabel: string;        // e.g. 'MP4', 'QuickTime', 'Matroska'
  durationSeconds: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number | null;
  height: number | null;
  videoCodec: string | null;     // Mediabunny codec id, e.g. 'avc'
  audioCodec: string | null;     // e.g. 'aac'
}

// UI → convert worker
export type ConvertWorkerCommand =
  | { type: 'convert-probe'; jobId: string; file: File }
  | { type: 'convert-start'; jobId: string; file: File; target: ConvertTargetSpec }
  | { type: 'convert-cancel'; jobId: string };

// convert worker → UI
export type ConvertWorkerState =
  | { type: 'convert-probed'; jobId: string; info: ConvertInputInfo }
  | { type: 'convert-probe-failed'; jobId: string; message: string }
  | { type: 'convert-progress'; jobId: string; fraction: number; processedSeconds: number }
  | {
      type: 'convert-done';
      jobId: string;
      output: ArrayBuffer;        // transferred
      fileName: string;
      mimeType: string;
      bytes: number;
      elapsedSeconds: number;
    }
  | { type: 'convert-failed'; jobId: string; message: string }
  | { type: 'convert-canceled'; jobId: string };
```

`jobId` is a UI-minted UUID so the page can correlate messages to rows; the
worker is otherwise stateless beyond the single in-flight `Conversion` it tracks
for cancellation.

## Format registry

`convert-formats.ts`:

```ts
interface ConvertFormatDescriptor {
  id: ConvertFormatId;
  label: string;                 // 'MP4 (H.264 · AAC)'
  shortLabel: string;            // 'MP4'
  extension: string;             // 'mp4'
  mimeType: string;              // 'video/mp4'
  kind: 'video' | 'audio';
}
```

The engine maps `ConvertFormatId` → a Mediabunny `OutputFormat` instance:

| id | OutputFormat | preferred video codecs | preferred audio codecs |
|----|--------------|------------------------|------------------------|
| `mp4` | `Mp4OutputFormat` | `['avc','hevc','av1','vp9']` | `['aac','opus']` |
| `mov` | `MovOutputFormat` | `['avc','hevc']` | `['aac']` |
| `webm` | `WebMOutputFormat` | `['vp9','av1','vp8']` | `['opus','vorbis']` |
| `mkv` | `MkvOutputFormat` | `['vp9','av1','avc']` | `['opus','aac']` |
| `mp3` | `Mp3OutputFormat` | — (audio only) | `['mp3']` |
| `wav` | `WavOutputFormat` | — | `['pcm-s16']` |
| `ogg` | `OggOutputFormat` | — | `['opus','vorbis']` |

For each track the worker resolves the actual codec with
`getFirstEncodableVideoCodec(format.getSupportedVideoCodecs(), …)` /
`getFirstEncodableAudioCodec(format.getSupportedAudioCodecs(), …)` so it always
picks a codec the **browser can encode** *and* the **container supports**. The
preferred-codecs column only orders the search. `quality` maps to
`QUALITY_HIGH | QUALITY_MEDIUM | QUALITY_LOW` and is passed as the track
`bitrate`.

## Conversion flow (worker)

```
convert-probe  → new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
               → read format + tracks → post convert-probed { info }

convert-start  → build Output(format, new BufferTarget())
               → Conversion.init({
                    input,
                    output,
                    video: hasVideoTarget ? { codec, bitrate } : { discard: true },
                    audio: { codec, bitrate },
                  })
               → if !conversion.isValid: post convert-failed with discard reasons
               → conversion.onProgress = (f, secs) => post convert-progress
               → await conversion.execute()
               → post convert-done { output: target.buffer, mimeType, bytes, elapsed } (transferred)

convert-cancel → conversion.cancel()  (execute() throws ConversionCanceledError → post convert-canceled)
```

Only one `Conversion` runs at a time; the worker holds a single
`activeConversion` + `activeJobId` for cancellation. Audio-only target formats
pass `video: { discard: true }`; video formats on an audio-only input simply have
no video track to convert (Mediabunny produces an audio-only file in that
container, or discards — reported via `discardedTracks`).

### Output target

The worker writes to a Mediabunny `BufferTarget` and transfers the resulting
`ArrayBuffer` back to the page, which wraps it in a `Blob` and saves it. This
keeps the worker↔page contract a single transferable and avoids passing a
`FileSystemWritableFileStream` across the worker boundary. The trade-off — the
whole output is held in memory once — is acceptable for the alpha and documented;
a future `StreamTarget`-to-`FileSystemFileHandle` path (pick destination first,
stream to disk) is a clean follow-up that reuses the same registry.

## UI: ConvertPage

A `section.convert-page` mirroring `DocsPage` chrome: a header with
`Back to editor` + Escape-to-close, then a body with a drop zone and a job list.
Job state is a SolidJS `createStore`:

```ts
interface ConvertJob {
  id: string;
  fileName: string;
  file: File;                    // retained for (re)conversion
  info: ConvertInputInfo | null; // null until probed
  target: ConvertTargetSpec;
  status: 'probing' | 'ready' | 'converting' | 'done' | 'failed' | 'canceled' | 'unreadable';
  fraction: number;
  error: string | null;
  result: { fileName: string; mimeType: string; bytes: number; elapsedSeconds: number } | null;
  output: Blob | null;
}
```

The page lazily spawns the convert worker on mount via `spawnConvertWorker`,
routes `ConvertWorkerState` messages to the matching job by `jobId`, and
terminates the worker on cleanup. Adding files mints jobs (`status: 'probing'`)
and posts `convert-probe`; `probed` fills `info` and picks
`defaultFormatForInput(info)`. "Convert" posts `convert-start`; "Save" runs the
File System Access save / anchor-download with `job.output`.

Sequential execution: the page keeps a small FIFO so only one job is
`converting` at a time (the worker also enforces this structurally by holding a
single active conversion); "Convert all" enqueues every `ready` job.

## App routing

Mirror the `/docs` integration in `App.tsx`:

- `const [convertOpen, setConvertOpen] = createSignal(parseConvertPath(location.pathname))`.
- `openConvert()` / `closeConvert()` push `'/convert'` / `'/'` and restore focus
  (same `queueMicrotask` focus-restore dance as docs, since the shell `inert`
  flips synchronously).
- The existing `popstate` handler updates **both** `docsSlug` and `convertOpen`.
- The app shell is `inert` when `docsSlug() !== null || convertOpen()`; keyboard
  shortcuts are gated `enabled: () => docsSlug() === null && !convertOpen()`.
- `<Show when={convertOpen()}><ConvertPage onClose={closeConvert} /></Show>` is
  rendered next to the docs `<Show>`.

## Entry point

- `toolbar-menus.ts`: add `{ id: 'convert', label: 'Convert media…' }` to the
  `Project` menu group and a `Convert media` command action (`onConvert`).
- `Toolbar.tsx`: add `onOpenConvert` prop; dispatch `case 'convert'` in
  `runMenuItem`; pass `onConvert: () => props.onOpenConvert?.()` to
  `buildCommandActions`.
- `App.tsx`: `onOpenConvert={() => openConvert()}`.

## Deployment

The Cloudflare `not_found_handling: "single-page-application"` fallback already
serves `index.html` for any non-asset path, so `/convert` deep links and refresh
work with **no** wrangler change. `parseConvertPath` rejects non-`/convert`
paths so the editor and docs routing are unaffected.

## Validation

- Unit: format registry shape; `defaultFormatForInput` (video→mp4, audio→mp3);
  `outputFileName('clip.mov','mp4') === 'clip.mp4'`; codec-list invariants
  (every video format lists ≥1 codec its Mediabunny format supports).
- Unit: `parseConvertPath` round-trip; `Project › Convert media…` present; the
  `Convert media` command action present.
- Manual: drop an `.mov`, convert to MP4 (stream-copy when H.264), to WebM
  (transcode), extract MP3; cancel mid-transcode (others continue); convert in a
  non-isolated tab; convert an audio-only file to WAV.
- `vp run check` green; test count grows.
