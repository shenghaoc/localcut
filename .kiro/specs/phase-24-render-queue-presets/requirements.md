# Requirements: Phase 24 — Render Queue + Export Presets

## R1 — Saved Export Presets

- **R1.1** Users can save the current `ExportSettings` as a named preset; presets persist across sessions via the project document (Phase 9).
- **R1.2** A preset stores codec, container, resolution, frame rate, bitrate, speed preset, and an optional output filename template — but never a range or output handle.
- **R1.3** Presets can be renamed, duplicated, and deleted; the last-used preset is restored on dialog open.
- **R1.4** Built-in presets (e.g. "1080p H.264 Quality", "720p VP9 Fast") ship as read-only defaults; user presets override them by name.
- **R1.5** Applying a preset fills the export dialog controls; the user can tweak settings before enqueuing.
- **R1.6** Presets are validated against probed codec support at dialog-open; unsupported presets are visually flagged but not hidden, so users see what their browser cannot encode.

## R2 — Render Queue

- **R2.1** The render queue holds an ordered list of export jobs; the user can enqueue multiple jobs before starting the queue.
- **R2.2** Jobs execute sequentially — no parallel exports. The next job starts only after the current job completes, fails, or is canceled.
- **R2.3** Each job carries its own `ExportSettings`, output destination, and range specification independently of other jobs.
- **R2.4** The queue is visible in a dedicated panel or drawer showing job name, preset, range, status, and progress.
- **R2.5** Users can reorder pending jobs, remove pending jobs, and cancel the currently running job.
- **R2.6** "Export" (single job, immediate start) remains the primary flow; the queue is an opt-in power feature that does not replace the existing one-click export path.

## R3 — Job Range Modes

- **R3.1** A job can target the full project (no range), an explicit in/out range (seconds), or a marker-bounded range derived from two timeline markers by ID.
- **R3.2** Marker-bounded ranges resolve to absolute seconds at enqueue time; if markers are moved or deleted before the job runs, the resolved range is used as-is (snapshot semantics).
- **R3.3** A "Create jobs from markers" action generates one job per adjacent marker pair across the timeline, each inheriting the current preset.
- **R3.4** Range validation rejects zero-duration or negative ranges at enqueue time.

## R4 — Job Lifecycle + Error Handling

- **R4.1** Job states: `pending` → `choosing-destination` → `running` → `finalizing` → `completed`; with `failed` and `canceled` as terminal alternatives.
- **R4.2** A failed job records the error message; subsequent jobs continue unless the user has enabled "stop on first error".
- **R4.3** A canceled job stops encoding, closes all encoders/muxers/writable streams cleanly, and transitions to `canceled` without corrupting the output file or project state.
- **R4.4** Failed and canceled jobs can be retried; retry re-enters `pending` and re-prompts for an output destination if the previous handle is stale.
- **R4.5** Codec or browser capability failures are reported per-job with an actionable message (e.g. "AV1 not supported — change codec or use a Chromium-based browser"); they do not affect unrelated queued jobs.

## R5 — Output Destinations + Filename Templates

- **R5.1** Each job obtains its output `FileSystemFileHandle` via the File System Access API; the permission prompt occurs when the job transitions to `choosing-destination`.
- **R5.2** When a directory handle is available, the filename is derived from an `OutputNameTemplate` with variables: `{project}`, `{preset}`, `{codec}`, `{date}`, `{time}`, `{range}`, `{index}`.
- **R5.3** Templates validate at save time; invalid variable references are rejected.
- **R5.4** If the File System Access API is unavailable, export falls back to a download blob — same as today.

## R6 — Queue State Persistence

- **R6.1** Completed and failed job metadata (settings, range, status, error, timestamps) persist in the project document so users see history after reload.
- **R6.2** Pending jobs persist across reloads; their output handles are discarded (re-prompted on run) since `FileSystemFileHandle` permissions expire.
- **R6.3** Running jobs that are interrupted by a page unload transition to `failed` with a "browser closed" error on reload.
- **R6.4** Queue history is bounded (last 50 jobs) with oldest completed jobs evicted first.

## R7 — Progress + Reporting

- **R7.1** Per-job progress reuses the existing `ExportProgress` model (phase, percent, ETA, elapsed).
- **R7.2** Aggregate queue progress shows completed/total jobs and an estimated total remaining time.
- **R7.3** Completed jobs show elapsed time and output file size when available.

## R8 — Tests

- **R8.1** Unit-test queue ordering: enqueue, reorder, remove, and the sequential execution invariant.
- **R8.2** Unit-test cancel and retry transitions: canceled job does not block the next; retried job re-enters pending.
- **R8.3** Unit-test failure isolation: a failed job with "stop on error" disabled allows the next job to proceed; enabled stops the queue.
- **R8.4** Unit-test preset serialization, migration from schema version N to N+1, and round-trip fidelity.
- **R8.5** Unit-test `OutputNameTemplate` expansion with all variable combinations and edge cases (missing project name, zero-index).
- **R8.6** Unit-test marker-to-job generation: N markers produce N-1 jobs with correct ranges.
- **R8.7** Integration-test: enqueue a full-project job, a range job, and a marker-bounded job; run the queue; verify all three complete in order.
- **R8.8** Test that a canceled job leaves subsequent jobs runnable and the queue can resume.
- **R8.9** Test that an unsupported-codec failure on job 2 does not corrupt or skip job 3.
- **R8.10** `npm run build` and `npm test` green; test count grows.
