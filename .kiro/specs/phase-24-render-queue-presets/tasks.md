# Tasks: Phase 24 — Render Queue + Export Presets

> Status: **Active**. Core data model, engine, worker integration, UI, and persistence landed. Manual verification pending.

## Export presets

- [x] **T1.1** Define `ExportPresetDoc` type in `src/protocol.ts`; add `exportPresets: ExportPresetDoc[]` to `ProjectDoc` in `src/engine/project.ts`; bump schema to v10 with additive migration from v9 (`exportPresets` defaults to `[]`).
- [x] **T1.2** Create `src/engine/export-presets.ts`: built-in preset definitions (1080p H.264 Quality, 1080p H.264 Fast, 720p VP9 Fast); CRUD functions (`createPreset`, `updatePreset`, `deletePreset`, `duplicatePreset`, `findPresetByName`); built-in merge logic (user presets shadow by name).
- [x] **T1.3** Implement `OutputNameTemplate` expansion: `expandOutputTemplate(template, context)` with `{project}`, `{preset}`, `{codec}`, `{date}`, `{time}`, `{range}`, `{index}` variables; `validateOutputTemplate(template)` rejects unknown variables. Add to `src/engine/export-presets.ts`.
- [x] **T1.4** Wire preset CRUD into `src/engine/worker.ts`: handle `preset-save`, `preset-delete` commands; broadcast updated preset list via `presets-state` message; schedule autosave.
- [x] **T1.5** Unit-test preset CRUD (create, rename, duplicate, delete, built-in shadowing) and round-trip serialization through `serializeProject`/`deserializeProject`.
- [x] **T1.6** Unit-test `expandOutputTemplate` with all variables, edge cases (missing project name → "Untitled", zero-padded index, range formatting), and `validateOutputTemplate` rejection of unknown variables.

## Queue data model

- [x] **T2.1** Define `JobRange`, `JobStatus`, `RenderQueueJob`, `RenderQueueState`, and `PersistedQueueJob` types in `src/protocol.ts`.
- [x] **T2.2** Create `src/engine/render-queue.ts`: pure functions for queue mutations — `enqueueJob`, `reorderJob`, `removeJob`, `cancelJob`, `retryJob`, `advanceQueue` (find next pending), `markJobRunning`, `markJobCompleted`, `markJobFailed`, `markJobCanceled`.
- [x] **T2.3** Implement `createJobsFromMarkers(markers, settings, presetId)`: given N sorted markers, produce N-1 jobs with marker-bounded `JobRange` values, each with resolved start/end seconds snapshotted from marker times.
- [x] **T2.4** Implement `resolveJobRange(jobRange): ExportRange | undefined` — converts any `JobRange` variant to the `ExportSettings.range` format consumed by `buildExportPlan`.
- [x] **T2.5** Add `renderQueueHistory: PersistedQueueJob[]` to `ProjectDoc`; implement `serializeQueueHistory` / `deserializeQueueHistory` with the 50-job cap (evict oldest completed first, then oldest failed).
- [x] **T2.6** Unit-test queue ordering: enqueue 3 jobs, reorder, remove, verify `advanceQueue` picks the first pending.
- [x] **T2.7** Unit-test cancel and retry: canceled job does not block next; retried job re-enters pending at the same position; old job stays in history.
- [x] **T2.8** Unit-test failure isolation: with `stopOnError: false`, a failed job allows `advanceQueue` to continue; with `stopOnError: true`, `advanceQueue` returns null.
- [x] **T2.9** Unit-test `createJobsFromMarkers`: 4 markers → 3 jobs with correct ranges; 1 marker → 0 jobs; 0 markers → 0 jobs.

## Queue protocol

- [x] **T3.1** Add queue-related `WorkerCommand` variants to `src/protocol.ts`: `queue-enqueue`, `queue-remove`, `queue-reorder`, `queue-start`, `queue-cancel-job`, `queue-cancel-all`, `queue-retry`, `queue-job-output`, `queue-job-skip`, `queue-set-stop-on-error`.
- [x] **T3.2** Add queue-related `WorkerStateMessage` variants: `queue-state` (full queue snapshot), `queue-job-destination` (request handle from UI), `queue-job-progress`, `queue-job-complete`, `queue-job-failed`, `queue-job-canceled`, `queue-complete`.

## Queue runner (worker)

- [x] **T4.1** Implement the queue runner loop in `src/engine/worker.ts`: process `queue-start`, iterate pending jobs, post `queue-job-destination`, receive `queue-job-output`/`queue-job-skip`, call `exportTimeline()` with the job's settings and handle, map progress/completion/error to queue-specific messages.
- [x] **T4.2** Wire `AbortController` per job: `queue-cancel-job` aborts the current job only; `queue-cancel-all` aborts the current job and transitions all pending jobs to `canceled`.
- [x] **T4.3** Handle the `choosing-destination` → `canceled` transition when the user dismisses the file picker (via `queue-job-skip`).
- [x] **T4.4** Implement `stopOnError` gating: when a job fails and `stopOnError` is true, the runner pauses and posts `queue-state` with `activeJobId: null`; the user can retry the failed job or remove it and re-start the queue.
- [x] **T4.5** On job completion, record `elapsedSeconds` and `outputBytes` (from the `WritableStream` byte count when available); post `queue-job-complete`.
- [x] **T4.6** Schedule autosave after each job status transition; on `queue-complete`, persist the final queue history.

## UI — Export dialog preset integration

- [x] **T5.1** Add a preset selector to `ExportDialog.tsx`: dropdown of available presets (built-in + user); "Save as Preset" button; "Delete Preset" button for user presets.
- [x] **T5.2** Add an "Add to Queue" button alongside the existing "Export" button; "Add to Queue" enqueues the current settings as a `pending` job without immediately prompting for a file handle.
- [x] **T5.3** Add range mode selector: "Full Project", "Custom Range" (existing), "Between Markers" (dropdown of marker pairs derived from `timeline-state` markers).

## UI — Render queue panel

- [x] **T6.1** Create `src/ui/RenderQueuePanel.tsx`: scrollable job list showing job name (preset + range summary), status badge, and progress bar for the running job.
- [x] **T6.2** Implement "Remove" button on pending jobs; "Cancel" button on the running job; "Retry" button on failed/canceled jobs.
- [x] **T6.3** Add "Start Queue" / "Stop Queue" controls; aggregate progress display (N/M jobs).
- [ ] **T6.4** Add a "Choose Output Directory" option that obtains a `FileSystemDirectoryHandle` once and resolves filenames from templates — skipping per-job file pickers. Falls back to per-job picker if the API is unavailable.
- [x] **T6.5** Add a "Stop on Error" toggle; show per-job error messages inline with an actionable hint.
- [x] **T6.6** Show completed job summary: elapsed time, output filename.

## Queue state persistence

- [x] **T7.1** Wire `renderQueueHistory` into `serializeProject` / `deserializeProject` with the 50-job eviction cap.
- [x] **T7.2** On reload, restore pending jobs from history as `pending` (handles discarded); mark any previously `running` or `choosing-destination` jobs as `failed` with error "Export interrupted — browser was closed".
- [x] **T7.3** Unit-test persistence round-trip: serialize a queue with mixed statuses, deserialize, verify pending jobs restored, running jobs marked failed, history bounded.

## Verification

- [x] **T8.1** Unit-test: enqueue a full-project job, a range job, and a marker-bounded job in one queue; verify sequential execution order and correct `ExportSettings.range` per job.
- [x] **T8.2** Unit-test: cancel job 2 mid-run; verify job 3 still transitions to `running` and completes.
- [x] **T8.3** Unit-test: simulate an unsupported-codec error on job 2; verify job 2 is `failed` with the error message, job 3 proceeds to `completed` (with `stopOnError: false`).
- [x] **T8.4** Unit-test: with `stopOnError: true`, a failed job halts the runner; after retry, the queue resumes.
- [ ] **T8.5** Manual: save a preset, reload, verify it appears; apply it, enqueue, export, verify output matches preset settings.
- [ ] **T8.6** Manual: enqueue 3 marker-bounded jobs via "Create jobs from markers", start queue with a directory handle, verify 3 output files with template-derived names.
- [ ] **T8.7** Manual: cancel mid-queue, verify no leaked frames, handles released, subsequent jobs still runnable.
- [x] **T8.8** `npm run build` and `npm test` green; test count grows.
