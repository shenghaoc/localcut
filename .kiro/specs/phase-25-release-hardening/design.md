# Design: Phase 25 - Diagnostics, Recovery + Release Hardening

> Status: **Planned** - make capability truth, recovery behavior, performance budgets, and release gates visible and testable.

## Goal

Phase 25 turns the editor's "honest hardware adaptation" principle into a release-hardening system. Users and reviewers should be able to answer:

- What capability tier am I in, and why?
- What degraded modes are active?
- What failed recently, what did the app recover, and what can I do next?
- Are preview/export/audio/storage performance budgets still protecting the accelerated path?
- Which import -> edit -> export fixtures prove this release is ready?

This phase does not add new editing features. It makes existing and planned subsystems diagnosable, recoverable, and releasable without pretending all browsers have the same capabilities.

## Non-goals

- Telemetry, remote support uploads, accounts, cloud sync, or server-side media processing.
- Copying media bytes, file contents, raw project documents, raw file names, or paths into diagnostics.
- A generic "works on every browser" claim. Limited and blocked tiers remain explicit.
- Replacing Phase 9 persistence, Phase 19 cache/proxy policy, Phase 23 bundles, or Phase 24 render queue behavior.
- Adding per-frame diagnostics messages or hot-path instrumentation that changes accelerated playback/export behavior.

## Architecture overview

Diagnostics are a typed snapshot assembled from existing capability probes, worker counters, storage/cache summaries, export settings, and bounded recent errors.

```
Main thread UI
  - renders DiagnosticsPanel
  - owns clipboard copy and native picker prompts
  - keeps one volatile recovery checkpoint mirror
  - sends recovery-action requests

Pipeline worker
  - owns engine diagnostics, GPU state, export/import jobs
  - records errors and performance counters
  - emits low-frequency diagnostics snapshots
  - emits project recovery checkpoints after committed edits

Cache/proxy worker or cache store
  - reports storage usage, cache health, cleanup progress
  - owns cache writes/deletes and quota recovery

AudioWorklet
  - reports initialization status and underrun counters through worker/main summaries
```

The UI never receives media bytes, GPU handles, WebCodecs objects, audio buffers, OPFS handles, or raw file handles. Report generation uses the same `DiagnosticSnapshot` plus redaction helpers before any clipboard write.

## Core types

Types below are sketches for strict TypeScript interfaces. They should live in shared protocol-safe modules (`src/protocol.ts` for wire messages plus `src/diagnostics/*` for pure report/redaction helpers) and worker-only collectors under `src/engine/`.

```typescript
export const DIAGNOSTIC_SNAPSHOT_SCHEMA_VERSION = 1;

export type CapabilityTier = 'accelerated' | 'limited' | 'blocked';

export type CapabilityStatus =
  | 'supported'
  | 'unsupported'
  | 'degraded'
  | 'unavailable'
  | 'unknown';

export interface CapabilityFinding {
  code: string;
  status: CapabilityStatus;
  message: string;
  action?: string;
}

export interface WebGpuCapability {
  status: 'ready' | 'unavailable' | 'requesting' | 'lost' | 'recovering' | 'failed';
  adapterName?: string;
  adapterType?: 'discrete' | 'integrated' | 'cpu' | 'unknown';
  requiredFeatures: readonly CapabilityFinding[];
  optionalFeatures: {
    readonly shaderF16: CapabilityFinding;
    readonly timestampQuery: CapabilityFinding;
    readonly subgroups: CapabilityFinding;
  };
  limitsSummary: {
    maxTextureDimension2D?: number;
    maxStorageBufferBindingSize?: number;
    maxComputeWorkgroupStorageSize?: number;
  };
  lastDeviceLost?: DeviceLostSummary;
}

export interface WebCodecsCapability {
  decoders: readonly CodecSupportSummary[];
  encoders: readonly CodecSupportSummary[];
}

export interface CodecSupportSummary {
  codec: string;
  container?: string;
  direction: 'decode' | 'encode';
  supported: boolean;
  smooth?: boolean;
  powerEfficient?: boolean;
  reason?: string;
}

export interface CapabilityReport {
  tier: CapabilityTier;
  tierReason: string;
  crossOriginIsolated: boolean;
  sharedArrayBuffer: CapabilityFinding;
  webGpu: WebGpuCapability;
  webCodecs: WebCodecsCapability;
  mediabunny: CapabilityFinding;
  audioWorklet: CapabilityFinding;
  fileSystemAccess: CapabilityFinding;
  opfs: CapabilityFinding;
  findings: readonly CapabilityFinding[];
}

export type DiagnosticSubsystem =
  | 'capability'
  | 'worker'
  | 'gpu'
  | 'audio'
  | 'storage'
  | 'import'
  | 'export'
  | 'cache'
  | 'timeline'
  | 'accessibility'
  | 'performance';

export type DiagnosticSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface RecentError {
  id: string;
  code: string;
  subsystem: DiagnosticSubsystem;
  severity: DiagnosticSeverity;
  occurredAt: string;
  message: string;
  redactedDetail?: string;
  affectedJobId?: string;
  affectedSourceAlias?: string;
  recoveryActionIds: readonly string[];
}

export interface RecentErrorLog {
  capacity: number;
  droppedCount: number;
  entries: readonly RecentError[];
}

export type RecoveryActionKind =
  | 'restart-worker'
  | 'retry-gpu-device'
  | 'switch-limited-preview'
  | 'retry-audio'
  | 'open-storage-cleanup'
  | 'request-storage-persistence'
  | 'relink-source'
  | 'retry-import'
  | 'retry-export'
  | 'cancel-job'
  | 'export-project-bundle'
  | 'reload-app';

export interface RecoveryAction {
  actionId: string;
  kind: RecoveryActionKind;
  label: string;
  description: string;
  enabled: boolean;
  destructive: boolean;
  requiresUserGesture: boolean;
  reasonDisabled?: string;
  relatedErrorIds: readonly string[];
}

export type BudgetMetric =
  | 'main-thread-blocking-ms'
  | 'worker-decode-queue-frames'
  | 'worker-decode-queue-ms'
  | 'gpu-submissions-per-frame'
  | 'dropped-preview-frame-rate'
  | 'export-throughput-fps'
  | 'memory-usage-bytes'
  | 'cache-usage-bytes'
  | 'audio-underruns-per-minute';

export interface PerformanceBudget {
  metric: BudgetMetric;
  label: string;
  unit: 'ms' | 'frames' | 'fps' | 'percent' | 'bytes' | 'count-per-minute';
  window: 'startup' | 'playback-60s' | 'scrub-10s' | 'export-job' | 'session' | 'manual';
  target: number;
  warningAt: number;
  breachAt: number;
  observed: number | null;
  status: 'ok' | 'warning' | 'breach' | 'not-measured';
  sampleCount: number;
  notes?: string;
}

export interface DiagnosticSnapshot {
  schemaVersion: typeof DIAGNOSTIC_SNAPSHOT_SCHEMA_VERSION;
  snapshotId: string;
  createdAt: string;
  appVersion: string;
  buildId?: string;
  browser: {
    userAgentFamily: string;
    userAgentVersion: string;
    platformFamily: string;
  };
  capability: CapabilityReport;
  storage: StorageDiagnosticSummary;
  proxyCache: ProxyCacheDiagnosticSummary;
  activeExportSettings: ExportSettingsSummary | null;
  performanceBudgets: readonly PerformanceBudget[];
  recentErrors: RecentErrorLog;
  recoveryActions: readonly RecoveryAction[];
}
```

### Privacy-safe report type

```typescript
export interface CopyableDiagnosticReport {
  reportSchemaVersion: 1;
  generatedAt: string;
  snapshotId: string;
  appVersion: string;
  browser: DiagnosticSnapshot['browser'];
  capability: CapabilityReport;
  storage: StorageDiagnosticSummary;
  proxyCache: ProxyCacheDiagnosticSummary;
  activeExportSettings: ExportSettingsSummary | null;
  performanceBudgets: readonly PerformanceBudget[];
  recentErrors: RecentErrorLog;
  safeSourceSummaries: readonly SafeSourceSummary[];
}

export interface SafeSourceSummary {
  sourceAlias: string; // e.g. source-1, stable only inside this report
  mediaKind: 'video' | 'audio' | 'image' | 'offline' | 'unknown';
  container?: string;
  codecs: readonly string[];
  dimensions?: { width: number; height: number };
  durationBucket: '<10s' | '10s-1m' | '1m-10m' | '10m-1h' | '>1h' | 'unknown';
  statusCodes: readonly string[];
}
```

The report deliberately omits raw `ProjectDoc`, clip names, marker text, title text, captions, LUT contents, full source fingerprints, full paths, raw file names, media bytes, thumbnail bytes, waveform samples, and object handles. A source fingerprint may be represented only as `present: true` or a short non-identifying category such as `fingerprintAlgorithm: 'sha-256'`; do not copy digest prefixes by default.

## Redaction rules

`buildCopyableDiagnosticReport(snapshot, projectSummary)` performs deterministic redaction before clipboard writes:

1. Replace source ids with report-local aliases (`source-1`, `source-2`) and clip ids with counts only unless a specific error needs an alias.
2. Strip path-like substrings from browser error messages (`/`, `\`, drive letters, `file://`, `blob:` URLs, quoted file names).
3. Drop text-bearing content from titles, captions, markers, notes, transcript-like metadata, and LUT contents.
4. Drop all binary and typed-array fields.
5. Drop full source fingerprints and cache keys that include source fingerprints.
6. Keep stable technical codes, capability statuses, durations as buckets, dimensions, codecs, containers, export settings, budget status, and recovery action kinds.

Unit tests should use adversarial fixtures with file names embedded in DOMException strings, title text, caption text, LUT payload, media-byte-like arrays, and path-shaped metadata.

## GPU device-lost handling

The accelerated worker registers `device.lost` immediately after device creation.

```
create device
  -> register device.lost handler
  -> if lost:
       1. mark WebGPU status = lost
       2. stop preview loop and active GPU submissions
       3. fail active export with retryable reason when output correctness is not guaranteed
       4. close/release in-flight VideoFrame and GPU-owned resources exactly once
       5. emit RecentError(code='gpu.device_lost')
       6. attempt bounded device re-request when reason is recoverable
       7. rebuild pipelines, shaders, bind groups, timestamp query state
       8. resume preview from current timeline time if project state is valid
       9. otherwise switch to labeled limited preview/export state
```

Recovery attempts use bounded backoff. A user-triggered **Retry GPU** action can reset the backoff after the app has been idle. Device loss during export must not produce a silently partial output; the export queue item becomes failed/retryable with the same export settings preserved.

`DeviceLostSummary` records the browser-provided reason/message after redaction, recovery attempt count, last attempt timestamp, and current fallback mode.

## Worker restart and project recovery

Worker failure is detected through `Worker.onerror`, `messageerror`, an explicit fatal worker message, or a missed low-frequency heartbeat while an operation is active. The heartbeat is not per-frame and must not replace SAB/rAF clock reads.

Recovery checkpoint:

```typescript
export interface ProjectRecoveryCheckpoint {
  projectRevision: number;
  createdAt: string;
  projectDoc: ProjectDoc; // serialized only, no media bytes or handles
  sourceStatuses: readonly SourceRecoveryStatus[];
  activeExportSettings: ExportSettingsSummary | null;
}
```

Checkpoint flow:

1. Worker commits a timeline/project mutation.
2. Worker increments `projectRevision`.
3. Worker emits a bounded `project-recovery-checkpoint` snapshot at mutation frequency, not playback frequency.
4. Main keeps only the newest volatile checkpoint and last acknowledged revision.
5. Worker continues to own durable autosave to IndexedDB.

Restart flow:

```
worker crash/fatal/unresponsive
  -> freeze command queue and show "Recovering engine..."
  -> terminate old worker if still present
  -> remount PreviewCanvas with a new canvas generation so transferControlToOffscreen can run again
  -> create fresh worker and SABs
  -> init worker with latest volatile checkpoint or request IndexedDB autosave restore
  -> re-probe capabilities and GPU/audio
  -> re-bind sources from persisted handles/blobs where available
  -> mark unavailable sources offline with re-pick actions
  -> replay no unacknowledged destructive commands automatically
  -> resume editable shell
```

If the latest command was not acknowledged, the UI reports that the last action may need to be repeated. The app must not guess by replaying unacknowledged edits that could duplicate a cut, delete, or export job.

## Audio initialization failure

Audio failures include missing `AudioContext`, `audioWorklet.addModule()` failure, SAB/ring-buffer setup failure, user gesture restrictions, and runtime underruns.

Behavior:

- Keep the editor mounted and timeline editable.
- Show an audio-limited capability finding with a specific code (`audio.worklet_module_failed`, `audio.context_blocked_by_gesture`, etc.).
- Offer **Retry audio** after user gesture when relevant.
- Preview may continue muted or with video-only scrub when explicit and labeled.
- Export requiring audio mix either retries audio/mix init or fails with a retryable export reason; it must not silently export missing audio unless the user chose video-only export.

## Storage quota and cleanup UI

Quota errors are handled as storage pressure, not project corruption.

`StorageDiagnosticSummary` reports:

- `navigator.storage.estimate()` usage/quota when available.
- OPFS support and availability.
- IndexedDB availability.
- project document/autosave health.
- cache/proxy category totals.
- pending/failed cleanup jobs.
- whether persistent storage has been granted.

Cleanup UI:

- **Delete render cache** - disposable; never deletes project data.
- **Delete thumbnails/filmstrips** - disposable; regenerates on demand.
- **Delete waveform peaks** - disposable; regenerates on demand.
- **Delete unpinned proxies** - preview-only; originals remain authoritative.
- **Delete all generated media** - deletes proxies/cache, never source media or ProjectDoc.
- **Repair cache manifest** - removes missing/orphaned/stale writing entries.
- **Request persistent storage** - calls `navigator.storage.persist()` where supported.
- **Export project bundle** - recovery option when autosave is at risk and Phase 23 is available.

When quota blocks autosave of the project document itself, diagnostics escalates to `critical` and the UI must explain that the current in-memory project should be exported or caches should be cleared before closing the tab.

## Import/export/permission recovery

Failed import:

- Keep current project loaded until a new project passes validation or the user confirms replacement.
- Show per-source integrity/capability reasons.
- Offer retry/re-pick actions where safe.

Failed export:

- Preserve export settings and queue item.
- Record the failing stage (`prepare`, `decode`, `render`, `encode`, `mux`, `write`, `device-lost`, `permission-lost`).
- Offer retry when the failure is recoverable.
- Never silently change codec, resolution, fps, source mode, proxy/original policy, or audio inclusion.

Permission loss:

- Detect denied/expired `FileSystemHandle` access.
- Mark affected sources/offline output targets as needing permission.
- Offer re-pick or choose new output location.
- Do not bind a new file without descriptor/fingerprint checks from the relevant phase.

## Performance budgets

Default release budgets are conservative and can be tuned per hardware class. Budget status should be visible in diagnostics and included in readiness evidence.

| Metric | Default target | Warning | Breach | Notes |
|--------|----------------|---------|--------|-------|
| Main-thread blocking | no sustained tasks > 50 ms during import/playback/export UI operations | any task > 75 ms | repeated task > 100 ms or user-visible freeze | measured with PerformanceObserver where available plus manual fixture evidence |
| Worker decode queue | 3-5 frames or <= 250 ms queued | > 5 frames or > 300 ms | unbounded growth or > 500 ms | protects memory/backpressure |
| GPU submissions per accelerated frame | exactly 1 | > 1 in debug counter | > 1 in release validation | hard gate for accelerated renderer |
| Dropped preview frames | <= 5% over 60 s playback on supported fixture | > 10% | > 20% | hardware-specific; report capability tier |
| Export throughput | no > 20% regression from baseline fixture | 20-35% regression | > 35% regression | compare same browser/hardware class |
| Memory/cache usage | under configured cache budget and min-free-space reserve | warning threshold crossed | quota or eviction failure | project data protected |
| Audio underruns | 0 sustained underruns in steady playback | > 2/min | > 10/min or audible gaps | AudioWorklet counter, not UI guess |

Instrumentation rules:

- No per-frame `postMessage` just for diagnostics.
- GPU submission counters live in the renderer where submissions already happen.
- Decode/encode queue counters live beside queues.
- Audio underrun counters are aggregated before UI updates.
- Main-thread blocking observer samples coarse events only.

## Fixture matrix

Required CI fixtures should be tiny, deterministic, and checked in or generated by documented scripts. Optional hardware fixtures may be larger and manual.

| Fixture | Required | Scenario | Expected validation |
|---------|----------|----------|---------------------|
| `mp4-h264-aac-2s` | yes where encoder/decoder supported | import video+audio, split/trim, export MP4 | timed output, audio/video duration within tolerance |
| `webm-vp9-opus-2s` | capability-dependent | alternate container/codec import/export path | skip with explicit codec reason if unsupported |
| `image-png-jpeg-stills` | yes | still import, title overlay, transform/composite export | output includes still duration and title-safe composite path |
| `audio-only-short` | yes | audio-only source, waveform/mix/export path | no preview crash; export/mix status correct |
| `rotated-or-vfr-short` | optional/manual if generation support is absent | conformance/timestamp/rotation recovery | normalized timing and diagnostics reason when unsupported |
| `offline-source-project` | yes | lost permission/relink flow | project loads editable; source offline with re-pick action |
| `quota-exceeded-cache` | mocked CI | cache/proxy write failure | cleanup actions and project preservation |
| `gpu-device-lost` | mocked CI plus manual where possible | device loss mid-preview/export | retry/fallback state and no partial silent export |
| `worker-crash` | mocked CI | crash after committed edit | restart from checkpoint/autosave |
| `export-failure` | mocked CI | encoder/mux/write failure | queue item failed/retryable with settings preserved |

Fixture documentation belongs in `tests/fixtures/media/README.md` or the nearest existing test fixture location. It must state generation commands, expected capability skips, and which tests are mandatory for release.

## CI and test strategy

Unit tests (`npm test`):

- report redaction and safe source aliasing.
- diagnostic snapshot normalization.
- recent error log capacity/dedup/severity behavior.
- recovery state machine for worker restart, GPU loss, audio init failure, quota exceeded, permission loss, failed import, and failed export.
- performance budget math and threshold classification.
- shortcut conflict registry.

Integration tests:

- import -> edit -> export fixture matrix with capability-aware skips.
- worker crash/restart using a fake `WorkerFactory`.
- GPU unavailable/device lost using mocked WebGPU adapter/device.
- quota exceeded using mocked OPFS/IndexedDB cache store.
- export retry preserving settings.

Performance regression tests where practical:

- GPU submission count counter asserts one submit per accelerated frame in mocked renderer tests.
- queue-bound tests assert decode/encode queues do not grow beyond configured limits.
- export throughput benchmark records baseline on supported local hardware; CI may compare pure mocked timing while manual release validation records hardware evidence.

Manual release validation:

- Chromium full-performance run at `http://localhost:5173` with COOP/COEP and accelerated tier.
- Non-isolated run proves limited capability tier instead of blank app.
- Keyboard-only walkthrough.
- Diagnostics copy/paste inspection for privacy.
- Import -> edit -> export fixture smoke.

## Accessibility checklist

The audit covers timeline, dialogs, inspector, toolbar, diagnostics panel, capability panel, and export queue.

- Native controls for buttons, inputs, toggles, menus, sliders, and dialogs where possible.
- Icon-only buttons have `aria-label`.
- Timeline scrub track has slider semantics and keyboard equivalent.
- Clip items expose names/positions through labels without leaking text into diagnostics reports.
- Dialogs trap focus, restore focus to trigger, and close with `Escape` only when safe.
- Export-in-progress dialogs do not close with `Escape` unless cancellation is explicit.
- Blocking capability/recovery states use `role="alert"` sparingly; passive status uses visible text.
- Diagnostics copy button is keyboard reachable and announces success/failure through a non-disruptive live region.
- Focus rings are visible through `:focus-visible`.
- Contrast meets repo UI standards.
- Reduced motion preference is respected for non-functional transitions.
- Keyboard-only path covers import, timeline edit, inspector adjustment, diagnostics copy, export queue retry/cancel, and recovery actions.

## Keyboard conflict policy

Introduce or update a shortcut registry so conflicts are detectable.

```typescript
export type ShortcutScope =
  | 'global'
  | 'timeline'
  | 'preview'
  | 'inspector'
  | 'dialog'
  | 'export-queue'
  | 'text-entry';

export interface KeyboardShortcutDefinition {
  id: string;
  scope: ShortcutScope;
  keys: string;
  label: string;
  when: string;
  preventDefault: boolean;
  browserReserved: boolean;
}
```

Policy:

1. Browser-reserved shortcuts are not overridden.
2. Text inputs, textareas, editable title/caption fields, and contenteditable areas receive normal text editing shortcuts unless a shortcut is explicitly scoped to text entry.
3. Dialog scope wins over global/timeline while a modal is open.
4. Inspector numeric inputs own arrow keys while focused; timeline nudge shortcuts apply only when timeline focus is active.
5. `Escape` means close/cancel in dialogs, exit mode in timeline, or clear transient UI in global scope; never all at once.
6. Duplicate key chords in overlapping scopes fail a registry test unless the `when` predicates are mutually exclusive.

## Modules

| Module | Responsibility |
|--------|----------------|
| `src/diagnostics/types.ts` | Shared snapshot/report/recovery/budget types if not kept in `src/protocol.ts` |
| `src/diagnostics/redaction.ts` | Pure copyable report builder and redaction helpers |
| `src/engine/diagnostics.ts` | Worker-side snapshot collector and subsystem status aggregation |
| `src/engine/recovery.ts` | Worker restart state, recovery action handling, checkpoint validation |
| `src/engine/performance-budgets.ts` | Budget definitions and status classification |
| `src/engine/gpu.ts` | Device-lost summary, retry, and diagnostics fields |
| `src/engine/worker.ts` | Diagnostics commands/states, checkpoints, heartbeat, fatal handling |
| `src/protocol.ts` | Structured-clone-safe diagnostic/recovery messages |
| `src/ui/DiagnosticsPanel.tsx` | Panel UI and copy report action |
| `src/ui/StorageCleanupDialog.tsx` | Quota/cache cleanup actions |
| `src/ui/RecoveryBanner.tsx` | Specific recovery status and actions |
| `src/ui/shortcuts.ts` | Shortcut registry and conflict helpers |

## Protocol sketch

```typescript
// main -> worker
| { type: 'request-diagnostic-snapshot'; requestId: string }
| { type: 'run-recovery-action'; actionId: string; kind: RecoveryActionKind }
| { type: 'set-performance-budget'; metric: BudgetMetric; target: number; warningAt: number; breachAt: number }
| { type: 'run-storage-cleanup'; cleanup: StorageCleanupKind; jobId: string }

// worker -> main
| { type: 'diagnostic-snapshot'; requestId?: string; snapshot: DiagnosticSnapshot }
| { type: 'recent-error'; error: RecentError }
| { type: 'recovery-state'; state: 'idle' | 'recovering' | 'failed'; actions: readonly RecoveryAction[] }
| { type: 'project-recovery-checkpoint'; checkpoint: ProjectRecoveryCheckpoint }
| { type: 'storage-cleanup-progress'; jobId: string; progress: CleanupProgress }
```

Snapshot messages are request/response or low-frequency state updates. They are never emitted per frame.

## UI expectations

- Diagnostics panel uses the existing dark professional-tool aesthetic and fits as a drawer/panel, not a marketing page.
- Persistent chrome continues to show the active capability tier; diagnostics provides detail and copyable report.
- Each degraded finding has a short specific label and a longer explanation/action.
- Recent errors are grouped by subsystem and capped.
- Recovery actions are buttons with disabled reasons when unavailable.
- Storage cleanup separates disposable cache/proxy data from project/source data.
- Copy report action shows exactly what will be copied and confirms success through accessible status text.

## Release readiness gates

| Gate | Evidence | Blocks |
|------|----------|--------|
| Build/typecheck | `npm run build` | release |
| Unit tests | `npm test`, no test count regression for non-trivial logic | release |
| Diagnostics completeness | accelerated, limited, blocked snapshots reviewed | release |
| Privacy redaction | redaction unit tests and manual copied-report inspection | release |
| Recovery coverage | simulated worker crash, GPU loss, audio failure, quota, import/export failure, permission loss | release |
| Fixture matrix | required import -> edit -> export fixtures pass or skip with explicit capability reason | release |
| Accelerated invariants | one GPU submit per accelerated frame, no CPU pixel readback, bounded queues | release/accelerated tier |
| COOP/COEP | dev and production headers preserve `crossOriginIsolated` for full tier | release |
| Accessibility | keyboard-only audit and blocking a11y fixes complete | release |
| Manual smoke | Chromium full tier and non-isolated limited tier verified | release |
