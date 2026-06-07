# Design: Phase 24 — Render Queue + Export Presets

> Status: **Planned** — saved presets, multi-job render queue, marker-based batch export; no cloud publishing.

## Goal

Turn export from a one-shot dialog into a repeatable, queueable workflow. Users save export configurations as named presets, enqueue multiple jobs (full-project, range, or marker-bounded), and let the queue run them sequentially while they continue editing. The existing single-export path (`export-start`) remains the fast default; the queue wraps it without duplicating the pipeline.

## Data model

### ExportPresetDoc

```
ExportPresetDoc {
  id: string               // stable UUID
  name: string             // user-facing label, unique within the project
  builtIn: boolean         // true for shipped defaults; user presets are false
  codec: ExportVideoCodec  // 'h264' | 'vp9' | 'av1'
  container: ExportContainer
  width: number
  height: number
  fps: number
  videoBitrate: number
  preset: ExportPreset     // 'quality' | 'fast'
  outputTemplate?: string  // e.g. "{project}_{preset}_{date}"
}
```

Presets intentionally exclude `range` and output handles — those belong to jobs. The `outputTemplate` is optional; when absent, the user picks a filename manually per job.

Built-in presets are hardcoded and merged at load time (user presets shadow them by name). They are not persisted in the project document.

### OutputNameTemplate

```
OutputNameTemplate — a string with `{variable}` placeholders:
  {project}  — project name or "Untitled"
  {preset}   — preset name
  {codec}    — codec label (H.264, VP9, AV1)
  {date}     — YYYY-MM-DD
  {time}     — HHmmss
  {range}    — "full" or "01m30s-02m00s"
  {index}    — 1-based job position in current queue run
```

`expandOutputTemplate(template, context): string` validates and expands; unknown variables cause a validation error at save time. The container extension (`.mp4`/`.webm`) is always appended automatically.

### JobRange

```
JobRange =
  | { mode: 'full' }
  | { mode: 'range'; startS: number; endS: number }
  | { mode: 'markers'; startMarkerId: string; endMarkerId: string;
      resolvedStartS: number; resolvedEndS: number }
```

Marker-bounded ranges snapshot the marker times at enqueue. If the markers move or are deleted before the job runs, the resolved times are used as-is — the job definition is immutable once enqueued.

All modes map to `ExportSettings.range` at run time: `full` → `undefined`, `range`/`markers` → `{ startS, endS }`.

### RenderQueueJob

```
RenderQueueJob {
  id: string
  presetId: string | null          // reference to ExportPresetDoc.id, or null for ad-hoc
  settings: ExportSettings         // fully resolved at enqueue; independent of the preset
  jobRange: JobRange
  outputTemplate: string | null
  outputFileName: string | null    // resolved after destination chosen
  status: JobStatus
  error: string | null
  progress: ExportProgress | null  // live during 'running'
  enqueuedAt: string               // ISO timestamp
  startedAt: string | null
  completedAt: string | null
  elapsedSeconds: number | null
  outputBytes: number | null       // populated on completion when available
}

JobStatus = 'pending' | 'choosing-destination' | 'running'
           | 'finalizing' | 'completed' | 'failed' | 'canceled'
```

The `settings` field is a snapshot taken at enqueue time — editing the preset afterward does not change queued jobs. This avoids a class of race conditions where a user modifies a preset while the queue is running.

### RenderQueueState

```
RenderQueueState {
  jobs: RenderQueueJob[]
  stopOnError: boolean              // default false
  activeJobId: string | null        // the currently running job, or null
}
```

## Queue lifecycle

```
                  enqueue
                    │
                    ▼
              ┌──────────┐
              │  pending  │◄──── retry
              └────┬─────┘
                   │ queue runner picks next
                   ▼
         ┌─────────────────────┐
         │ choosing-destination │──── user cancels ──► canceled
         └────────┬────────────┘
                  │ handle obtained
                  ▼
             ┌─────────┐
             │ running  │──── user cancels ──► canceled
             └────┬────┘      encode error ──► failed
                  │ encode done
                  ▼
           ┌────────────┐
           │ finalizing  │──── mux error ──► failed
           └─────┬──────┘
                 │ mux complete
                 ▼
           ┌───────────┐
           │ completed  │
           └───────────┘
```

### Queue runner

The queue runner is a loop in the worker that:

1. Finds the first `pending` job (by array order).
2. Posts `queue-job-destination { jobId }` to the UI to prompt for a file handle (or resolves from a directory handle + template).
3. Receives the handle via `queue-job-output { jobId, handle }` → transitions to `running`.
4. Calls the existing `exportTimeline()` with the job's settings and handle — the pipeline is reused, not duplicated.
5. Maps `ExportProgress` callbacks to `queue-job-progress { jobId, progress }` messages.
6. On completion: transitions to `completed`, records elapsed time / output size, picks the next job.
7. On failure: transitions to `failed`, records the error. If `stopOnError` is true, the runner pauses; otherwise it picks the next job.
8. On cancel: the `AbortController` fires, the export tears down cleanly (existing `ExportCancelledError` path), the job transitions to `canceled`, and the runner picks the next job.

Only one `AbortController` exists at a time — the sequential constraint is structural, not a flag.

### Retry

Retrying a `failed` or `canceled` job clones it into a new `pending` job at the same queue position. The old job stays in history. The output handle is discarded — the user re-picks the destination.

## Permission flow for output destinations

Two modes for obtaining `FileSystemFileHandle`:

1. **Per-job file picker** (default): when the queue runner reaches a job, the UI posts a `showSaveFilePicker` prompt. The user picks (or cancels, which transitions the job to `canceled`). This is the same flow as today's single export.

2. **Directory handle** (opt-in): the user grants a `FileSystemDirectoryHandle` once for the queue run. Each job resolves its filename from the `outputTemplate` and calls `directoryHandle.getFileHandle(name, { create: true })`. No per-job prompt needed. The directory handle is held in UI memory only — never persisted to IndexedDB (permissions expire across sessions).

The queue runner message protocol:

```
UI → Worker:  queue-start
Worker → UI:  queue-job-destination { jobId, suggestedName }
UI → Worker:  queue-job-output { jobId, handle }
              or queue-job-skip { jobId }          // user canceled the picker
Worker → UI:  queue-job-progress { jobId, progress }
Worker → UI:  queue-job-complete { jobId, fileName, elapsedS, outputBytes? }
Worker → UI:  queue-job-failed { jobId, error }
Worker → UI:  queue-job-canceled { jobId }
Worker → UI:  queue-complete { completedCount, failedCount, canceledCount }
```

## Preset storage

Presets are stored in a new `exportPresets: ExportPresetDoc[]` array on `ProjectDoc`. This bumps the schema version to 10. The migration from v9 is additive — existing `exportSettings` is preserved as `lastUsedSettings`; `exportPresets` defaults to `[]`.

Built-in presets are defined in `src/engine/export-presets.ts` and merged at runtime — they are not written to the project document. If a user saves a preset with the same name as a built-in, the user version wins.

## Queue state persistence

Persisted in `ProjectDoc`:

```
ProjectDoc (v10) {
  ...existing fields...
  exportPresets: ExportPresetDoc[]
  renderQueueHistory: PersistedQueueJob[]  // last 50, evict oldest completed first
}
```

`PersistedQueueJob` is `RenderQueueJob` minus `progress` and with `outputFileName` instead of a handle:

```
PersistedQueueJob {
  id, presetId, settings, jobRange, outputTemplate,
  outputFileName, status, error, enqueuedAt, startedAt,
  completedAt, elapsedSeconds, outputBytes
}
```

On reload, pending jobs from history re-enter the queue as `pending` (handles discarded). Running jobs found in history transition to `failed` with error "Export interrupted — browser was closed". Completed and failed jobs appear in the history view.

The 50-job cap evicts oldest completed jobs first, then oldest failed, preserving pending jobs.

## Modules

| Module | Work |
|--------|------|
| `src/engine/export-presets.ts` (new) | `ExportPresetDoc` type; built-in preset definitions; CRUD functions; template expansion + validation |
| `src/engine/render-queue.ts` (new) | `RenderQueueJob`, `RenderQueueState`, `JobRange` types; queue mutation functions (enqueue, reorder, remove, cancel, retry, advance); marker-to-jobs generation; persistence serialization |
| `src/engine/export.ts` | No changes — `exportTimeline` is called as-is by the queue runner |
| `src/engine/worker.ts` | Queue runner loop; new command handlers for queue protocol messages; schedule autosave on queue state changes |
| `src/engine/project.ts` | Schema v10 with `exportPresets` and `renderQueueHistory`; migration from v9; serialize/deserialize the new fields |
| `src/protocol.ts` | New types: `ExportPresetDoc`, `RenderQueueJob`, `JobRange`, `OutputNameTemplate`, `PersistedQueueJob`, `JobStatus`; new `WorkerCommand` and `WorkerStateMessage` variants for queue protocol |
| `src/ui/ExportDialog.tsx` | Preset selector (load/save/delete); "Add to Queue" button alongside "Export Now" |
| `src/ui/RenderQueuePanel.tsx` (new) | Queue list with drag-reorder; per-job status/progress/error; start/cancel/retry controls; aggregate progress; directory handle toggle |

## Integration with existing export

The existing `export-start` / `export-cancel` / `export-progress` / `export-complete` / `export-error` path is untouched for the single-export flow. The queue runner internally reuses `exportTimeline()` and maps its result/error/progress to queue-specific messages. This means:

- No duplication of the encode pipeline.
- Backpressure, ETA, throughput probe, and codec probing all work identically.
- The `AbortController` pattern is reused — the queue runner creates one per job and aborts it on cancel.

## Validation

- Preset round-trip: save, reload, apply, verify settings match.
- Queue: enqueue 3 jobs (full, range, marker-bounded), run, verify sequential execution and correct output files.
- Cancel job 2 mid-encode: job 3 still runs; no leaked frames or handles.
- Codec failure on one job: error recorded, next job proceeds (with `stopOnError` off) or queue pauses (with `stopOnError` on).
- Reload with pending jobs: they reappear; running job shows as failed.
- Template expansion produces valid filenames; duplicate names get a numeric suffix.
- Build and tests green; `crossOriginIsolated` unchanged.
