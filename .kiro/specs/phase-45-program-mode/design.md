# Design: Phase 45 — Program Mode (Live Scenes)

> Status: **Proposed** — spec only, not yet implemented.

## Goal

Drive the Phase 12 GPU compositor with live `MediaStreamTrack` sources to
produce a switchable-scene program output. Each source is independently
ISO-encoded to OPFS (Phase 41 crash-safe pipeline ×N under one session
manifest). Scene switches are hotkey-triggered, take effect within one
compositor frame, and are recorded as manifest events. Stopping the session
lands a fully re-editable multitrack project: N ISO tracks plus a layout
track that replays the live mix through the same Phase 12 compositor.

## Dependencies

- **Phase 41 (PR #64) — hard dependency.** The session orchestrator
  (`capture-session.ts`), per-track pipelines (`track-pipeline.ts`),
  fragmented writer (`fragmented-writer.ts`), writer worker
  (`writer-worker.ts`), and crash-safe NDJSON manifest (`chunk-manifest.ts`)
  are reused **unchanged**. Program mode adds: (1) a live-compose tap
  alongside the ISO encode path; (2) a `scene-switch` manifest record kind;
  (3) a layout track at landing. The contract this phase relies on:
  `CaptureManifestRecord`, `CaptureSourceSnapshot`, the `capture-add-source`
  / `capture-start` / `capture-stop` commands, and the `epochUs`
  epoch-alignment mechanism must be present and working.
- **Phase 12 — compositing + transforms.** The `compositeLayers` function
  in `src/engine/gpu.ts`, `FrameCompositeLayer`, `TextureCompositeLayer`,
  `TransformParams`, and `resolveAllAt` are the compositor contract this
  phase extends. No changes to those modules; live sources produce the same
  `CompositeLayer` union the timeline path already produces.
- **Phase 14 — title textures.** `TitleTextureCache` and
  `rasterizeTitleToCanvas` are reused for text sources; no changes.
- **Phase 15 — keyframes.** `TransformParamsSnapshot` and
  `sampleClipParamsAt` from `src/engine/keyframes.ts` are the basis for
  per-segment layout keyframe records on the landed layout track.
- **Phase 47 — encoder budget.** `src/engine/encoder-budget.ts`
  (`createEncoderBudget`, `EncoderLease`, `EncoderConsumer`) is the shared
  lease ledger. No changes; program mode adds a new `EncoderConsumer` value
  `'program-iso'` for video ISO leases.

## Non-goals

- **Streaming out (WHIP publish).** Phase 47 covers it. Program mode +
  publish coexistence is governed by the shared encoder budget (R3.5);
  no new compositor path is needed — `PublishFrameTap` hooks the existing
  program output.
- **Replay buffer.** Phase 46.
- **Audio mixing beyond existing Phase 16 buses.** Mic sources feed into
  the Phase 16 master bus monitor; landed audio is the ISO recording, not
  the monitor mix. No new mixer UI.
- **Virtual camera output.** Impossible without an OS-level driver; not
  achievable from a browser context.
- **Live mid-session text editing.** Text source content is fixed at
  session start. Interactive text editing is a Phase 14 editor-mode
  concern.
- **Cross-origin page compositing.** Canvas tainting blocks direct capture
  of cross-origin elements. Web content enters only via tab capture or
  same-origin Element Capture (`CropTarget`). No workaround is attempted.
- **Non-accelerated-tier fallback.** v1 is accelerated-tier-only
  (WebGPU-in-worker + MSTP + realtime encode ×N required). Reduced tiers
  see the feature disabled with reasons, never a degraded implementation.
- **Pause/resume within a session.** Phase 42 territory. v1 is start/stop.
- **Multiple simultaneous program sessions.** One program session at a time.

## Architecture

```
main thread                      pipeline worker                   writer worker
───────────                      ───────────────                   ─────────────
getDisplayMedia  ─track─────────► MSTP reader loop (per source)
getUserMedia     ─track─────────►  │
                                   │ VideoFrame
                  clone()──────────┤  │
                  │ <video srcObject> ├─ close() after encode()
                  │ (monitor tile)    │
                  │                  VideoEncoder (Phase 41, unchanged)
                  │                   │ EncodedVideoChunk
                  │                  FragmentedWriter ─chunk (ArrayBuffer)──► SyncAccessHandle
                  │                   │                                        manifest append
                  │                   │                                        chunk-ack ──────►
                  │                   │
                  │             LiveComposeTap (per source)
                  │               │ VideoFrame (clone of MSTP frame)
                  │               ▼
                  │           ProgramCompositor
                  │             resolveSceneAt(sceneId)   ← scene switch: uniform update only
                  │             compositeLayers(encoder, layers)  ← ONE queue.submit per frame
                  │             program VideoFrame  ──────────────────► PublishFrameTap (P47, if live)
                  │
scene-switch ─────────────────► ProgramSessionManager
 (hotkey / UI)                    records { kind:'scene-switch'; sceneId; atUs } in manifest
                                  updates sceneId signal (read by ProgramCompositor next tick)
                  │
stop ─────────────────────────► ProgramSessionManager.stop()
                                  finalize all ISO tracks (Phase 41 path)
                                  write manifest 'finalize'
                                  land: N ISO tracks + layout track  ──► timeline (one undo op)
```

**Why this runs entirely in the pipeline worker (not main).** The pipeline
worker already owns WebCodecs encoders, the GPU device, `compositeLayers`,
and MSTP reader loops from Phase 41. Keeping the compose tap in the same
worker eliminates cross-worker `VideoFrame` transfers for composition, which
would cost a clone and a `postMessage` per frame per source. Main thread
owns only: stream acquisition (gesture-gated APIs), scene-definition UI, and
the `<video srcObject>` monitor tiles.

## Frame ownership table

| Object | Produced by | Consumed/closed by | When |
|---|---|---|---|
| `VideoFrame` from MSTP reader | MSTP `readable` | ISO encode path | `encoder.encode(frame)` returns; or on pre-encode drop |
| Clone for compose | ISO path, before encode | `LiveComposeTap` | after `importExternalTexture(frame)` call in compositor |
| Clone for phase-47 tap | `ProgramCompositor` | `PublishFrameTap` | after write/drop per P47 discipline |

The clone-before-encode ordering: the reader loop calls `frame.clone()` to
produce the compose copy, then calls `encoder.encode(frame)` (the original),
then `frame.close()`. The clone is passed to `LiveComposeTap`; it is closed
by the compositor after `importExternalTexture` has been called on it within
that frame's `GPUCommandEncoder`. Total close count per MSTP frame: 2 (the
original + 1 compose clone). If the source is not visible in the current
scene (layer `visible: false`), the clone is closed immediately without
being passed to the compositor — never leaked.

## Scene-switch one-frame invariant

The `ProgramCompositor` holds a `currentSceneId: string` signal. Switching
scene updates only this signal. On the next compositor tick,
`resolveSceneAt(currentSceneId)` looks up the scene's layer definitions and
produces the `CompositeLayer[]` array passed to `compositeLayers`. The
layers reference the most recent `VideoFrame` clones already held by the
`LiveComposeTap` per source. **No pipeline rebuild, no texture reallocation,
no encoder restart occurs.** The compositor doesn't distinguish "first frame
after switch" from any other frame — only the layer-uniform values change.
This is the invariant the R9.1 acceptance test asserts.

The eased-transition variant (200 ms, optional): during the transition
window, the compositor computes `opacity = lerp(outgoing.opacity,
incoming.opacity, elapsed / 200)` for each layer. No additional textures or
passes; the lerp is applied to the `TransformParams.opacity` field before
calling `compositeLayers`. After 200 ms, the opacity values snap to the
target; the transition timer is cleared.

## Components

### `src/engine/program-session.ts` (new)

Session orchestrator for program mode. Extends Phase 41's session model:
acquires N `EncoderLease` objects up front (or blocks with budget error),
creates N `TrackPipeline` instances (reusing `track-pipeline.ts`), manages
the `ProgramCompositor`, writes `scene-switch` manifest records, and on stop
calls the landing routine.

```typescript
export interface ProgramSessionConfig {
  scenes: SceneDefinition[];
  initialSceneId: string;
  sources: ProgramSourceDescriptor[];   // per acquired MediaStreamTrack
  chunkTargetS: number;                 // default 2
  transitionMs: 0 | 200;               // 0 = instant (default)
}

export interface ProgramSourceDescriptor {
  sourceId: string;
  kind: 'webcam' | 'screen' | 'mic' | 'still' | 'title';
  label: string;
  track: MediaStreamTrack;             // transferred from main; null for still/title
  encoderConfig: VideoEncoderConfig | AudioEncoderConfig | null; // null for still/title
}

// Returned to the worker command handler
export interface ProgramSession {
  switchScene(sceneId: string): void;
  stop(): Promise<ProgramLandedResult>;
}

export interface ProgramLandedResult {
  sessionId: string;
  isoTrackIds: string[];    // one per video/audio source
  layoutTrackId: string;
}
```

`acquire` loop: iterate video sources in order; call
`budget.acquire('program-iso')` for each. If any call returns `null` before
all leases are obtained, release all already-acquired leases and throw a
`ProgramBudgetError` with the source count and budget maximum. Mic/audio
sources do not acquire video leases (R3.3).

### `src/engine/program-compositor.ts` (new)

Wraps `compositeLayers` (from `src/engine/gpu.ts`) with live-source frame
management. Holds a `Map<sourceId, VideoFrame | null>` of the most recent
frame clone per source. On each compositor tick, builds the `CompositeLayer[]`
from the current scene definition, calling `importExternalTexture` on live
frames and referencing cached `GPUTextureView` for still/title sources.

```typescript
export interface ProgramCompositorConfig {
  renderer: GpuRenderer;               // existing gpu.ts renderer instance
  scenes: SceneDefinition[];
}

export interface ProgramCompositor {
  updateFrame(sourceId: string, frame: VideoFrame): void;  // called by LiveComposeTap
  switchScene(sceneId: string, transitionMs: 0 | 200): void;
  /** Called once per render tick. Returns the composed frame for the publish tap. */
  renderTick(encoder: GPUCommandEncoder): void;
  dispose(): void;
}
```

`renderTick` must be called within the same `GPUCommandEncoder` scope as the
rest of the frame's GPU work; it does not call `queue.submit` — the single
submission is owned by the worker's render loop, exactly as Phase 12.

### `src/engine/live-compose-tap.ts` (new)

Per-source bridge from the MSTP reader loop to the `ProgramCompositor`.
Called by `TrackPipeline` immediately after `frame.clone()` and before
`encoder.encode(frame)`. Passes the clone to the compositor; if the
compositor has not yet rendered the previous clone from this source, the
older clone is closed (dropped) — latest-frame-wins per source, matching
the Phase 47 tap discipline.

```typescript
export interface LiveComposeTap {
  /** Hands a cloned VideoFrame to the compositor. The tap takes ownership. */
  onFrame(sourceId: string, frame: VideoFrame): void;
  dispose(): void;  // closes any held frame
}
```

### `src/engine/program-scenes.ts` (new)

Pure data module: scene definitions, persistence/validation, and the
`resolveSceneAt` query.

```typescript
export interface SceneDefinition {
  id: string;
  name: string;
  hotkey: '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | null;
  layers: SceneLayer[];
}

export interface SceneLayer {
  sourceRef: string;        // matches ProgramSourceDescriptor.sourceId
  transform: TransformParams;  // P12 fields; default: identity fill
  visible: boolean;            // default true
  zIndex: number;              // ascending = farther from viewer; compositor renders low-to-high
}

export interface SceneDoc {
  sceneSchemaVersion: 1;
  scenes: SceneDefinition[];
}

/** Resolves the ordered CompositeLayer descriptors for a scene at session time. */
export function resolveSceneAt(
  scenes: SceneDefinition[],
  sceneId: string,
  frames: ReadonlyMap<string, VideoFrame | null>,
  stills: ReadonlyMap<string, GPUTextureView>,
  sourceWidth: number,
  sourceHeight: number
): CompositeLayer[];

export function validateSceneDoc(value: unknown): SceneDoc | null;
export function hotkeyConflict(scenes: SceneDefinition[]): string | null;
```

### `src/engine/capture/chunk-manifest.ts` (extended)

Extend `CaptureManifestRecord` with a new variant (version-tolerant: parsers
skip unknown `kind` values):

```typescript
| { kind: 'scene-switch'; sceneId: string; atUs: number }
```

No change to the write-ordering contract. `parseManifest` is updated to
recognise and return `scene-switch` records; any record with an unrecognised
`kind` is skipped rather than aborting the parse.

### `src/engine/encoder-budget.ts` (extended)

Add `'program-iso'` to the `EncoderConsumer` union:

```typescript
export type EncoderConsumer = 'export' | 'iso-record' | 'whip-publish' | 'program-iso';
```

No other changes. The `budgetSessionsForProbe` and `createEncoderBudget`
functions are unchanged.

### `src/engine/capability-probe-v2.ts` (extended)

Add `programMode: FeatureSupport` to `CapabilityProbeResult`. Computed as:

```typescript
programMode = (
  recordingAvailable(probe)        // Phase 41 derivation (all capture probes + core-webgpu)
  && probe.webGPUCore !== 'unsupported'
) ? 'supported' : 'unsupported';
```

Add one `CapabilityMatrixPanel` row for "Program mode" following the
existing `finding` pattern in `src/engine/diagnostics.ts`.

### `src/engine/project.ts` (extended)

`ProjectDoc` gains `scenes?: SceneDoc | null`. Schema version bumped to the
next unused integer after Phase 46's reservation (Phase 46 claims v11;
program mode claims the next one — do not hardcode a number; write "bump
`PROJECT_SCHEMA_VERSION` to the next unused integer after v11"). Migration:
older schemas read with `scenes: null`.

`Timeline` gains a `'layout'` track type:

```typescript
// In timeline.ts
export interface TimelineTrack {
  id: string;
  type: 'video' | 'audio' | 'layout';  // 'layout' is new
  // ... existing fields
}
```

`LayoutClip` is a new clip kind placed on `'layout'` tracks:

```typescript
export interface LayoutClip {
  id: string;
  kind: 'layout';
  startTime: number;        // session epoch-relative µs, converted to timeline seconds at landing
  duration: number;         // seconds
  sceneId: string;
  /** Full SceneDefinition snapshot at this segment, stored as P15 keyframes at boundaries. */
  sceneSnapshot: SceneDefinition;
}
```

Layout tracks are skipped by `resolveAllAt` and `resolveAt` (which work on
`'video'` tracks only). A new `resolveLayoutAt(timeline, time): LayoutClip |
null` function returns the active layout clip for the compositor during
re-export.

### `src/engine/persistence.ts` (extended)

Add `PROGRAM_SOURCE_BINDINGS_STORE` (string constant) as a new app-scoped
IndexedDB object store (`DB_VERSION` bumped by 1). Provides
`loadProgramSourceBindings()` and `saveProgramSourceBindings(bindings)`.
The store holds a single record: `{ sourceId: string; kind: 'webcam' |
'mic'; deviceId: string; label: string }[]`.

### `src/protocol.ts` (extended)

Following existing kebab-case, structured-clone-safe conventions:

```typescript
// Commands (WorkerCommand union)
| { type: 'program-start'; config: ProgramSessionConfig }
| { type: 'program-stop' }
| { type: 'program-scene-switch'; sceneId: string; transitionMs: 0 | 200 }
| { type: 'program-update-scenes'; scenes: SceneDefinition[] }

// State messages (WorkerStateMessage union)
| { type: 'program-status';
    state: 'idle' | 'armed' | 'running' | 'stopping';
    elapsedUs: number;
    activeSceneId: string | null;
    sources: ProgramSourceStatusSnapshot[] }
| { type: 'program-error';
    code: ProgramErrorCode;
    detail: string }
| { type: 'program-landed';
    sessionId: string;
    isoTrackIds: string[];
    layoutTrackId: string }

export type ProgramErrorCode =
  | 'budget-exhausted'
  | 'source-failed'
  | 'compositor-error'
  | 'storage-quota';

export interface ProgramSourceStatusSnapshot {
  sourceId: string;
  kind: ProgramSourceDescriptor['kind'];
  label: string;
  state: 'active' | 'dropped' | 'failed';
  preEncodeDrops: number;
}
```

### `src/ui/ProgramPanel.tsx` (new)

Program mode UI panel:

- Source list: Add screen (one gesture per source), camera picker, mic
  picker, still import. Sources display muted `<video srcObject>` monitor
  tiles (browser-composited, never an engine readback path).
- Scene editor: add/remove/rename scenes, assign hotkeys, drag layers,
  apply per-layer transforms (numeric fields per the Phase 12 Inspector
  pattern). Changes before session start persist to `ProjectDoc.scenes`.
- Start/Stop controls: encoder budget display (current usage / max) before
  start; budget error displayed as text, never a crash.
- Status: elapsed time, active scene name, per-source drop counts.
- All controls keyboard-accessible, ARIA-labeled, focus-managed per the
  accessibility steering. No media objects or GPU handles escape to the UI.
  `onCleanup` for all subscriptions.

### `src/ui/ProgramMonitor.tsx` (new)

Full-resolution preview of the composited program output, displayed during
an active session. Receives frames via the existing pipeline worker canvas
output (the same `OffscreenCanvas` transfer path the preview already uses).
No new compositor path — the program compositor IS the preview compositor
during a session.

## Schema: `SceneDoc`

```json
{
  "sceneSchemaVersion": 1,
  "scenes": [
    {
      "id": "scene-uuid-1",
      "name": "Wide shot",
      "hotkey": "1",
      "layers": [
        {
          "sourceRef": "src-camera-1",
          "transform": { "x": 0, "y": 0, "scale": 1, "rotation": 0,
                         "opacity": 1, "anchorX": 0.5, "anchorY": 0.5, "fit": "fill" },
          "visible": true,
          "zIndex": 0
        }
      ]
    }
  ]
}
```

Project-portable fields (scene geometry, hotkeys, source refs) live in
`ProjectDoc.scenes`. Device-local fields (`deviceId` for each `sourceRef`)
live in `PROGRAM_SOURCE_BINDINGS_STORE`. This split means opening the same
project on a different machine keeps the scene layout but requires the user
to re-bind sources to local devices — correct behaviour, not a limitation.

## Layout track landing

After the session ends, `scene-switch` manifest records are read in order.
The algorithm:

1. Start with the `initialSceneId` at `epochUs` → first segment.
2. For each `{ kind: 'scene-switch'; sceneId; atUs }` record: close the
   previous segment at `atUs − epochUs`, open a new one with `sceneId`.
3. Close the last segment at the session `endUs − epochUs`.
4. For each segment, create a `LayoutClip` with the `SceneDefinition`
   snapshot (looked up from the session config) stored as `sceneSnapshot`.
   Boundary keyframes are written at segment start and end using
   `TransformParamsSnapshot` values from the scene layers.
5. Place all `LayoutClip`s on a new `TimelineTrack { type: 'layout' }`.

The layout track is created only if the session had at least one
`scene-switch` event OR the session ran with a defined scene. If
`initialSceneId` is undefined (session used no scenes), no layout track is
created; the ISO tracks land alone, exactly as Phase 41.

## Manifest extension example (NDJSON)

```
{"kind":"header","version":1,"sessionId":"…","startedAtIso":"…","epochUs":null,"sources":[…],"chunkTargetS":2}
{"kind":"epoch","epochUs":1716300000000000}
{"kind":"chunk","sourceId":"src-cam1","file":"video-src-cam1.mp4","byteOffset":0,"byteLength":204800,"fromUs":0,"toUs":2000000,"keyFrame":true,"preEncodeDrops":0}
{"kind":"scene-switch","sceneId":"scene-2","atUs":5300000}
{"kind":"scene-switch","sceneId":"scene-1","atUs":9800000}
{"kind":"source-ended","sourceId":"src-cam1","reason":"stop"}
{"kind":"finalize","endedAtIso":"…","reason":"user"}
```

A parser that does not know `"kind":"scene-switch"` skips those lines and
lands the ISO tracks without a layout track — version-tolerant by design.

## Capability gating summary

| Probe | Source | Critical for program mode? |
|---|---|---|
| `core-webgpu` tier | Phase 8/26 | yes |
| `mediaStreamTrackProcessor` | Phase 41 | yes |
| `videoEncodeRealtime` | Phase 41 | yes |
| `opfsSyncAccessHandle` | Phase 41 | yes |
| `transferableMediaStreamTrack` | Phase 41 | yes |
| `programMode` (derived) | this phase | gate for UI entry point |

Safari (Safari 26+ has WebGPU including workers) is blocked by missing
`MediaStreamTrackProcessor` in v1. Firefox is blocked by missing MSTP and
WebCodecs realtime encode. Both see the panel disabled with per-probe
reasons; no crash.

## Third-party additions

No new runtime dependencies. Compositing is the existing Phase 12 WebGPU
path; muxing is the existing Mediabunny fragmented-MP4 path; persistence is
IndexedDB + OPFS. No new third-party libraries meet the bar for addition —
none are needed.

## Validation

| Scenario | Expected result |
|---|---|
| 2-cam + screen + mic session, 3 scene switches, clean stop | 4 ISO tracks + layout track with 4 segments land; re-export matches the live mix |
| Scene switch while recording | Compositor uniform updates within 1 tick; no encoder restart; no pipeline rebuild (unit test: spy compositor) |
| 3 video sources on a budget-2 device | `program-error { code: 'budget-exhausted' }` before any source starts; budget ledger shows no leases acquired |
| Kill tab at minute 1, relaunch | Recovery dialog lists orphan; Import lands ISO tracks; layout track reconstructed from `scene-switch` records |
| Screen source with cross-origin content | Tab-capture path used; no canvas tainting; no CPU readback |
| Still image source | `TextureCompositeLayer` reused each frame; no MSTP; no encoder lease consumed |
| `programMode` derivation on Safari/Firefox probes | `'unsupported'`; panel disabled with reasons; rest of app unaffected |
| WHIP publish active + 2-source program session | Combined encoder count checked against budget before start; blocked with budget message if exceeded |
| `npm run build` / `npm test` | Green; test count grows |
