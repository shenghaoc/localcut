# Design: Phase 43 — Screencast Post Pack

> Status: **Proposed** — spec only, not yet implemented.

## Goal

Four complementary screencast-production tools on top of LocalCut's existing
compositing, keyframe, and title infrastructure:

1. **Zoom-n-pan presets** — parameterised entry/hold/exit templates that write
   real P15 transform keyframes the user can edit afterwards.
2. **DOM event log + auto-zoom proposals** — during own-tab Phase 41 sessions,
   capture-phase listeners record timestamped click/scroll events; a
   deterministic clustering pass then proposes keyframe pairs reviewable in a
   panel.
3. **Callout clips** — arrow, box, step, spotlight, blur-region overlays as
   source-less P14-style clips; spotlight and blur-region are WGSL passes in
   the existing single submission.
4. **Padded-background preset** — wallpaper/gradient behind the capture,
   rounded corners, drop shadow, inset margin; all realtime at 1080p on the
   accelerated tier.

None of these features require server-side processing, accounts, or telemetry.
All are gated by the Phase 8/26 capability tier; missing capability ⇒
explanation in the UI, never a crash.

## Dependencies

- **Phase 41 (PR #64)** — Capture Engine. This spec depends on Phase 41's OPFS
  session layout (`opfs:/capture/<sessionId>/`) and `CaptureManifestRecord`
  schema, the `CaptureSourceKind` discriminant for own-tab sessions, and the
  landing flow (`capture-landed` message and epoch timestamp alignment). The
  DOM event log is co-located with the Phase 41 session directory. If Phase 41
  drifts, only the `CaptureSessionEventLogger` (§ Components) needs updating.
- **Phase 42 (parallel spec)** — Element/Region Capture UX. Phase 43 is loosely
  coupled: it reads `CaptureSourceKind` to determine whether to install event
  listeners, but does not import Phase 42 modules directly. Phase 42's
  `preferCurrentTab` constraint path is the trigger for DOM event log
  installation.
- **Phases 12, 14, 15** — already shipped. Compositing (`CompositeLayer`,
  `TextureCompositeLayer`), title raster (`TitleTextureCache`,
  `rasterizeTitleToCanvas`), and keyframes (`sampleClipParamsAt`,
  `set-keyframes` command) are reused without modification.

## Non-goals

- **OS-level keystroke capture** — not attempted; browsers expose only sanitised
  synthetic keyboard events without raw OS interception.
- **Cross-application cursor effects** — arbitrary screen captures bake the
  cursor into pixels. No browser API exposes cursor coordinates from a foreign
  process's window.
- **GPU template-match cursor tracker** — explicitly deferred. A GPU
  template-match approach would scan each captured frame for a known cursor
  sprite, but it is fragile: cursor themes vary per OS/user/DPI, the cursor
  composited into capture pixels is anti-aliased at varying scales, and
  accessibility custom cursors are unbounded in appearance. The fragility
  outweighs the benefit; the feature is listed here as future work, not as a
  reduced-tier alternative. Implementation should not begin until a reliable
  cursor shape enumeration API (e.g., a future Accessibility Object Model
  extension) is standardised.
- **Phase 44 shortcut-key channel** — the `kind: 'key'` channel in the DOM
  event log schema is reserved and documented, but Phase 44 implements the
  opt-in capture and UI; this phase must not add any key-capture code.
- **Animated GIF/video wallpaper** — wallpaper resolves the first frame of the
  referenced source; per-frame wallpaper video would need a second video decode
  path competing with the primary clip. Revisit when a dedicated background
  track concept exists.
- **Cursor highlight, zoom-follow on non-own-tab captures** — structurally
  impossible without coordinates.

## Why this approach for each component

### Zoom presets → keyframes (not a separate zoom track)

Presets that write ordinary P15 keyframes mean the user inherits the entire
existing keyframe editor, undo/redo, export parity, and serialisation for free.
A dedicated "zoom preset track" would need its own editor widget, its own
serialisation path, and its own preview/export integration — all for the same
visual result. Writing keyframes is the strictly simpler design.

### DOM event log: capture-phase click plus passive wheel/scroll listeners

`addEventListener('click', handler, { capture: true })` fires before the
target element's handlers and cannot be cancelled by child listeners (unless
the child calls `stopImmediatePropagation` on the capture phase, which is
rare). This gives reliable coverage without wrapping the application's event
system. The `scroll` listener is passive (never calls `preventDefault`), so it
does not block the main thread's scroll handling. The listeners fire on main;
since the capture session's encode pipeline runs in the worker, the timestamp
alignment uses `performance.now()` converted to the Phase 41 µs epoch
(`epochUs + (performance.now() * 1000)`). The in-memory log is flushed once at
session stop — no per-event OPFS write.

### Auto-zoom: deterministic clustering over GPU/ML

GPU/ML-based gaze prediction would require model weights, a WebNN or WebGPU
inference pass, and non-trivial accuracy validation. Deterministic clustering
on the already-recorded event log is transparent, auditable, always produces
the same proposals for the same input, and runs in < 100 ms for a 1-hour log.
The user sees and approves every proposal, so false positives have no cost
beyond a click.

### Callouts: P14 raster for arrow/box/step, WGSL for spotlight/blur

Arrow/box/step require Canvas2D vector primitives (arcs, strokes, text
measurements) that are straightforward in OffscreenCanvas. Re-implementing
them in WGSL would be complex and fragile. The P14 raster-then-cache path
already handles this exact pattern for title clips; callout clips reuse it
cleanly.

Spotlight and blur, however, need to operate on the composited pixel buffer
under them (darken surrounding area, blur a region of the underlying frame).
Canvas2D cannot read GPU texture data without a readback (hard gate violation).
WGSL passes operating in the compositor's texture space are the only option
that respects hard gate 2.

### Padded background: single WGSL pass with pre-cached shadow texture

Three separate compute passes (background, shadow, clip mask) could be
dispatched sequentially, but each dispatch in a separate `queue.submit` would
violate hard gate 4. Encoding all three as a single dispatch that reads a
pre-cached shadow texture keeps the frame within one submission. The shadow
texture (a 1-channel f16 texture of the blurred SDF rounded-rect mask) is
cheap to pre-compute on parameter change and eliminates a live per-frame
Gaussian, which would otherwise be the dominant cost at high shadow radii.

## Architecture

```
                         main thread
┌──────────────────────────────────────────────────────────────────────────────┐
│  ZoomPresetPanel.tsx    AutoZoomPanel.tsx    CalloutTool.tsx   BgPresetPanel │
│       │                       │ (cluster on panel open)    │         │       │
│  set-keyframes cmd     DomEventLog read                add-callout  set-bg  │
└────────────────────────────────────────────────────────────────────────────┬─┘
                                 │ WorkerCommand (postMessage)               │
┌────────────────────────────────▼──────────────────────────────────────────┐│
│                   pipeline worker (src/engine/worker.ts)                  ││
│                                                                           ││
│  CaptureSessionEventLogger  ──► events.json (OPFS, at session stop)      ││
│  (own-tab sessions only)                                                  ││
│                                                                           ││
│  sampleClipParamsAt()  ← existing P15 path (zoom keyframes sampled here) ││
│                                                                           ││
│  CalloutTextureCache   ← P14 pattern (arrow/box/step raster + cache)     ││
│                                                                           ││
│  EffectChainRunner                                                        ││
│   ├── … existing effects …                                                ││
│   ├── spotlight.wgsl  (new, registered in effects registry)              ││
│   └── blur-region.wgsl  (new, registered in effects registry)            ││
│                                                                           ││
│  PaddedBackgroundRenderer                                                 ││
│   └── padded-background.wgsl  (single pass per frame, shadow tex cached) ││
│                                                                           ││
│  gpu.ts present() ─────────────────────► single queue.submit             ││
└───────────────────────────────────────────────────────────────────────────┘│
                                                                              │
                  DOM event log (main thread, session-scoped)                 │
┌────────────────────────────────────────────────────────────────────────────▼┐
│  window: 'click' (capture phase), 'wheel' (passive); document: 'scroll'     │
│  → DomEventLogEntry[] (in memory) → events.json on session stop             │
└─────────────────────────────────────────────────────────────────────────────┘
```

The auto-zoom clustering algorithm runs on the main thread synchronously at
panel open (not in the worker), since it is a pure data transform over the
in-memory event log and completes well within the latency budget (R3.4).

## Components

### `src/engine/event-log.ts` (new)

Owns the DOM event log data types, in-session capture, serialisation, and
OPFS persistence.

```typescript
/** One recorded DOM event during an own-tab capture session. */
export interface DomEventLogEntry {
  t: number;           // µs on Phase 41 capture clock (epochUs + performance.now()*1000)
  kind: 'click' | 'scroll'; // NOTE: 'key' channel reserved for Phase 44 opt-in extension
  x: number;           // normalised 0–1 viewport/scrollable-target position
  y: number;           // normalised 0–1 viewport/scrollable-target position
  deltaY?: number;     // wheel-originated scroll entries only
}

/** Versioned JSON written to OPFS as events.json at session stop. */
export interface DomEventLog {
  eventLogSchemaVersion: 1;
  sessionId: string;
  events: DomEventLogEntry[];
  // NOTE: 'key' channel reserved for Phase 44 opt-in shortcut-keys extension
}

/** Sidecar reference stored in ProjectDoc; the actual log stays in OPFS. */
export interface SessionEventLogRef {
  sessionId: string;
  sourceId: string;    // landed sourceId of the primary screen capture track
  opfsPath: string;    // e.g. "opfs:/capture/<sessionId>/events.json"
}

/** Main-thread capture-phase listener set, installed/removed by CaptureSessionManager. */
export class CaptureSessionEventLogger {
  constructor(private readonly epochUs: number) {}
  install(): void;           // adds click, wheel, and scroll listeners
  remove(): void;            // removes listeners; safe to call multiple times
  readonly entries: DomEventLogEntry[];
  async flush(sessionDir: FileSystemDirectoryHandle): Promise<void>; // writes events.json
}

export function normalizeDomEventLogEntry(raw: unknown): DomEventLogEntry | null;
export function parseDomEventLog(json: unknown): DomEventLog | null;
export function serializeDomEventLog(log: DomEventLog): string; // JSON.stringify
```

`CaptureSessionEventLogger` is instantiated on the main thread by the Phase 41
`CaptureSessionManager` for own-tab sessions only. The `flush()` method is
called once at session stop, before the tracks are landed. It writes
`events.json` to the session directory handle obtained from Phase 41's OPFS
session directory reference. Scroll position normalisation inspects the event
target first: a scrollable `HTMLElement` uses `scrollLeft / max(1, scrollWidth
- clientWidth)` and `scrollTop / max(1, scrollHeight - clientHeight)`; the
document fallback uses `window.scrollX / max(1, scrollWidth -
window.innerWidth)` and `window.scrollY / max(1, scrollHeight -
window.innerHeight)`. Missing scrollers and non-finite divisions clamp to `0`.
`deltaY` is recorded only from passive `wheel` events because `scroll` events
do not expose wheel deltas.

### `src/engine/auto-zoom.ts` (new)

Pure-logic clustering and proposal generation. No DOM, no OPFS, no GPU
dependencies — fully unit-testable in Node.

```typescript
export interface AutoZoomParams {
  clusterWindowS: number;         // default 2
  clusterDistanceNorm: number;    // default 0.15 (15 % of viewport diagonal)
  leadInMs: number;               // default 200 (zoom-in placed clusterStart − leadInMs)
  rampMs: number;                 // default 400 (zoom entry/exit duration)
  holdMs: number;                 // default 1500 (ms of no events before zoom-out)
  zoomScale: number;              // default 1.6
  overlapMergeThresholdMs: number; // default 50
}

export const DEFAULT_AUTO_ZOOM_PARAMS: AutoZoomParams;

export interface EventCluster {
  startUs: number;
  endUs: number;
  centroidX: number;   // normalised 0–1
  centroidY: number;
  eventCount: number;
}

export interface ZoomProposal {
  id: string;              // stable deterministic key (sha-256 of cluster range + centroid)
  cluster: EventCluster;
  zoomInAtUs: number;      // timeline µs for the first keyframe
  zoomOutAtUs: number;     // timeline µs for the zoom-out keyframe
  centroidX: number;
  centroidY: number;
  scale: number;
  status: 'pending' | 'applied' | 'skipped';
}

/**
 * Cluster entries into proposals. Pure function; deterministic given the same input.
 * Runs in O(n log n) time (sort by t, linear sweep). Must complete under 100 ms
 * for n = 216 000 (R3.4).
 */
export function clusterEvents(
  entries: DomEventLogEntry[],
  params: AutoZoomParams,
  clipStartUs: number,   // epoch offset of the clip's first frame (µs)
): ZoomProposal[];
```

The clustering algorithm:
1. Sort entries by `t` (O(n log n)).
2. Linear sweep: maintain an open cluster. An entry joins the open cluster if
   `entry.t − cluster.startUs ≤ clusterWindowS × 1e6` **and** Euclidean
   distance to the cluster's running centroid is ≤ `clusterDistanceNorm`.
   Otherwise, close the current cluster and open a new one.
3. For each closed cluster, generate a `ZoomProposal` with keyframe timing per
   the formula in R3.1.
4. Merge overlapping proposals: sort by `zoomInAtUs`; if two adjacent proposals
   overlap by more than `overlapMergeThresholdMs × 1000 µs`, move the earlier
   proposal's `zoomOutAtUs` to the later proposal's `zoomInAtUs`.
5. Assign stable IDs via a synchronous FNV-1a-derived hash over
   `clusterStartUs + ':' + centroidX.toFixed(4) + ':' +
   centroidY.toFixed(4)`, truncated to 16 hex chars. `clusterEvents` stays
   synchronous and never calls `crypto.subtle.digest`.

### `src/engine/callout.ts` (new)

Data types, hash, normalisation, serialisation, and rasterisation for callout
clips.

```typescript
export type CalloutKind = 'arrow' | 'box' | 'step' | 'spotlight' | 'blur';

export interface CalloutArrowGeometry {
  kind: 'arrow';
  x1: number; y1: number;   // normalised 0–1 (tail)
  x2: number; y2: number;   // normalised 0–1 (head)
}
export interface CalloutBoxGeometry {
  kind: 'box';
  x: number; y: number;     // normalised top-left
  w: number; h: number;     // normalised width/height
}
export interface CalloutStepGeometry {
  kind: 'step';
  cx: number; cy: number;   // normalised centre
  r: number;                // normalised radius
  number: number;           // step label, 1–99
}
/** Spotlight and blur: region driven by clip TransformParams (x,y,scale). */
export interface CalloutRegionGeometry {
  kind: 'spotlight' | 'blur';
  // actual region at runtime from sampleClipParamsAt → TransformParams.{x,y,scale}
}
export type CalloutGeometry =
  | CalloutArrowGeometry | CalloutBoxGeometry | CalloutStepGeometry
  | CalloutRegionGeometry;

export interface CalloutStyle {
  color: string;             // CSS hex, default '#FFD700'
  strokeWidth: number;       // px at 1080p, default 3
  fillOpacity: number;       // 0–1, default 0 (stroke-only for box; 0.15 for spotlight)
  fontSize: number;          // px at 1080p, step-number only, default 28
  arrowheadSize: number;     // px at 1080p, arrow only, default 14
  blurRadius: number;        // px at 1080p, blur only, default 12, max 48
  darkenStrength: number;    // 0–1, spotlight only, default 0.7
}

export interface CalloutPayload {
  calloutKind: CalloutKind;
  geometry: CalloutGeometry;
  style: CalloutStyle;
}

/** Stable hash of the callout's visual appearance for texture cache keying. */
export function calloutContentHash(payload: CalloutPayload): string;

export function normalizeCalloutPayload(
  partial: Partial<CalloutPayload> & { calloutKind: CalloutKind }
): CalloutPayload;

export function parseCalloutPayload(value: unknown): CalloutPayload | null;

/**
 * Rasterise arrow/box/step to a 1920×1080 OffscreenCanvas using Canvas2D.
 * Called on the cold path (style/geometry change), never per-frame.
 * Returns null for spotlight/blur (these are WGSL passes, not raster).
 */
export function rasterizeCallout(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  payload: CalloutPayload,
): void;
```

The raster callouts (`arrow`, `box`, `step`) plug into a new
`CalloutTextureCache` in `src/engine/callout-textures.ts` that follows the
exact same pattern as `TitleTextureCache` in `src/engine/titles.ts`:
`(clipId, calloutContentHash)` → `GPUTexture`. On style change the worker
calls `cache.invalidate(clipId)` and re-rasterises. The cache is consulted per
frame in the compositor; on a hit, the cached `GPUTextureView` becomes a
`TextureCompositeLayer` inside the single `queue.submit`. On a miss (first
render after invalidation), rasterise + upload + cache before returning the
view. The upload uses `copyExternalImageToTexture` (existing P14 pattern).

### `src/engine/callout-textures.ts` (new)

```typescript
export class CalloutTextureCache {
  constructor(private readonly device: GPUDevice) {}
  /** Returns a cached view for arrow/box/step callouts; never called for spotlight/blur. */
  get(
    clipId: string,
    payload: CalloutPayload,
    outputWidth: number,
    outputHeight: number,
  ): GPUTextureView;
  invalidate(clipId: string): void;
  dispose(): void;
}
```

### `src/engine/shaders/spotlight.wgsl` + `spotlight.f16.wgsl` (new)

WGSL compute shader registered in the `src/engine/effects.ts` registry as
`'spotlight'`.

Uniform layout:

```wgsl
struct SpotlightUniform {
  cx: f32;            // normalised 0–1
  cy: f32;
  rx: f32;            // normalised ellipse half-width
  ry: f32;            // normalised ellipse half-height
  darkenStrength: f32; // 0–1
  _pad: f32;
}
```

Per-pixel: compute `d = ((px−cx)/rx)² + ((py−cy)/ry)²`. If `d > 1.0`, multiply
RGB by `1 − darkenStrength`. Alpha unchanged. One dispatch covers the entire
output texture; workgroup size `(8, 8, 1)`.

### `src/engine/shaders/blur-region.wgsl` + `blur-region.f16.wgsl` (new)

WGSL compute shader registered in the effects registry as `'blur-region'`.

Uniform layout:

```wgsl
struct BlurRegionUniform {
  rx: f32; ry: f32; rw: f32; rh: f32; // normalised rect
  radius: f32;                          // Gaussian radius (px at output res)
  _pad: vec3<f32>;
}
```

Two-pass separable Gaussian within the rect:
1. Horizontal pass: reads from the input texture, writes a temporary `rgba8unorm`
   (or `rgba16float` for the f16 variant) texture. Pixels outside the rect
   are copied unchanged.
2. Vertical pass: reads from the temp texture, writes the output. Pixels outside
   the rect are copied from the original input.
Both passes are encoded as two compute dispatches within the same
`GPUCommandEncoder`, issued inside the single `queue.submit` (hard gate 4: both
dispatches belong to the same encoder; `submit` is called once per frame for
the entire compositor chain).

The temporary texture is acquired from a small frame-scoped pool (max 2
allocated simultaneously), kept alive until the submitted GPU work has
completed, then returned to the pool. This avoids per-frame allocation on the
GPU heap and avoids destroying resources before command execution completes.
Maximum effective radius clamped to 48 px; if `maxComputeWorkgroupSizeX < 64`,
clamped to 24 px with a visible Inspector label (R7.3).

### `src/engine/padded-background.ts` (new)

```typescript
export type PaddedBackgroundKind = 'solid' | 'gradient' | 'wallpaper';

export interface GradientStop {
  color: string;    // CSS hex
  pos: number;      // 0–1
}

export interface PaddedBackgroundParams {
  insetMargin: number;          // fraction of output height, default 0.08
  cornerRadius: number;         // px at 1080p, default 16
  shadowOpacity: number;        // 0–1, default 0.45
  shadowRadius: number;         // px at 1080p, default 24
  shadowOffsetY: number;        // px at 1080p, default 8
  background:
    | { kind: 'solid'; color: string }
    | { kind: 'gradient'; stops: GradientStop[]; angleDeg: number }
    | { kind: 'wallpaper'; sourceId: string };
}

export const DEFAULT_PADDED_BACKGROUND: PaddedBackgroundParams;

export function normalizePaddedBackground(
  partial: Partial<PaddedBackgroundParams>
): PaddedBackgroundParams;

export function parsePaddedBackground(value: unknown): PaddedBackgroundParams | null;

/** Derives a string key for the shadow texture cache. */
export function shadowCacheKey(params: PaddedBackgroundParams): string;
```

`PaddedBackgroundRenderer` in the same file manages the shadow texture cache
and wallpaper frame resolution.

```typescript
export class PaddedBackgroundRenderer {
  constructor(private readonly device: GPUDevice) {}
  /**
   * Returns the cached shadow texture for the given params, creating/updating
   * it if the cache key changed. The shadow texture is a 1-channel f16 texture
   * sized to the output dimensions.
   */
  getShadowTexture(
    params: PaddedBackgroundParams,
    outputWidth: number,
    outputHeight: number,
  ): GPUTexture;
  /**
   * Returns a cached wallpaper GPU texture, resolving the first frame from a
   * MediaInputHandle only when sourceId, output dimensions, or wallpaper params
   * change. Returns null if sourceId is not found or not a still/video source.
   */
  getWallpaperTexture(
    sourceId: string,
    handles: Map<string, MediaInputHandle>,
    outputWidth: number,
    outputHeight: number,
  ): Promise<GPUTexture | null>;
  dispose(): void;
}
```

### `src/engine/shaders/padded-background.wgsl` + `padded-background.f16.wgsl` (new)

Single compute pass. Uniform layout:

```wgsl
struct PaddedBgUniform {
  insetL: f32; insetT: f32; insetR: f32; insetB: f32; // normalised inset rect
  cornerRadius: f32;          // normalised (px/outputHeight)
  shadowOpacity: f32;
  shadowOffsetYN: f32;        // normalised
  bgKind: u32;                // 0=solid, 1=gradient, 2=wallpaper
  solidColor: vec4<f32>;      // bgKind=0
  gradAngleCos: f32;
  gradAngleSin: f32;
  gradStopCount: u32;
  _pad: u32;
  gradStops: array<vec4<f32>, 5>; // xyz=color, w=pos (max 5 stops)
  // wallpaper texture bound as a separate binding when bgKind=2
}
```

Execution order per thread (one thread per output pixel):

1. **Background**: if `bgKind == 0`, output `solidColor`; if `1`, sample the
   gradient at the projected position; if `2`, sample the wallpaper texture.
2. **Shadow**: read the pre-cached shadow texture at the thread's pixel
   position; composite the shadow (pre-multiplied, `shadowOpacity`) over the
   background.
3. **Clip**: compute the SDF distance to the inset rounded-rect. If inside (SDF
   < 0), sample the source frame texture; blend result over the current pixel
   using straight-alpha. If on the boundary (0 ≤ SDF ≤ 1 px), apply
   anti-aliasing via `smoothstep`.

The SDF rounded-rect function (2D): `d = length(max(abs(p − centre) − halfExtent + cornerRadius, 0)) − cornerRadius`.

### `src/protocol.ts` (extended)

Following existing kebab-case discriminated-union conventions:

```typescript
// New ClipKindSnapshot value:
export type ClipKindSnapshot = 'video' | 'title' | 'callout';

// New TimelineClipSnapshot fields (all optional, absent on clips that don't use them):
//   callout?: CalloutPayload        (present iff kind === 'callout')
//   paddedBackground?: PaddedBackgroundParams

// New commands:
| { type: 'add-callout'; trackId: string; start: number; duration: number;
    payload: CalloutPayload }
| { type: 'set-callout'; trackId: string; clipId: string; payload: CalloutPayload }

// The zoom-n-pan preset panel uses the existing 'set-keyframes' command:
| { type: 'set-keyframes'; trackId: string; clipId: string;
    keyframes: ClipKeyframesSnapshot }   // already in protocol.ts
```

No new worker-to-main messages are needed for zoom presets (they confirm via the
existing `timeline-state` snapshot). Auto-zoom proposals are computed on the
main thread and do not cross the worker boundary until the user applies one
(`set-keyframes`). Callout add/set commands follow the same add/set pattern as
`add-title`/`set-title`.

### `src/engine/project.ts` (extended)

New fields on `ProjectDoc`:

```typescript
export interface SessionEventLogRef {
  sessionId: string;
  sourceId: string;         // landed sourceId of the primary screen capture track
  opfsPath: string;         // e.g. "capture/<sessionId>/events.json" (relative to OPFS root)
}

export interface ProjectDoc {
  // … existing fields …
  sessionEventLogs?: SessionEventLogRef[];
}
```

`TimelineClip` (internal) and `TimelineClipSnapshot` (protocol/serialised) gain:

```typescript
callout?: CalloutPayload;              // present iff kind === 'callout'
paddedBackground?: PaddedBackgroundParams;
```

Schema version: bump `PROJECT_SCHEMA_VERSION` to the next unused integer (v11
is claimed by the open Phase 46 PR #63; do not hardcode a number — the
implementer writes the next available value). The upgrade path follows the
existing `switch (schemaVersion)` ladder in `parseProjectDoc`: the new fields
are all optional, so older documents parse cleanly with the new validator; only
the schema version number changes.

### `src/ui/ZoomPresetPanel.tsx` (new)

Inspector section shown on video clips. Contains:
- Named preset buttons (R1.1).
- Editable fields: target scale, x, y, entry ramp (ms), hold (ms), exit ramp
  (ms).
- Apply button that dispatches `set-keyframes` with the computed keyframe
  sequence.
- Warning modal if existing keyframes are present in the target range (R1.5).

### `src/ui/AutoZoomPanel.tsx` (new)

Inspector section shown on clips with a `SessionEventLogRef`. Contains:
- Parameter fields (R3.1 defaults).
- "Re-cluster" button (re-runs `clusterEvents` with current params).
- Scrollable proposal list: timestamp, centroid %, Apply / Skip buttons.
- "No event log" placeholder when the clip has no `SessionEventLogRef` (R3.5).

The panel reads `events.json` from OPFS once (on panel open or source change)
via the main-thread OPFS API, caches it in a SolidJS signal, then passes the
entries to `clusterEvents` synchronously. Loading is async; the panel shows a
spinner during the OPFS read.

### `src/ui/CalloutTool.tsx` (new)

Toolbar callout tool button + placement overlay. When active:
- Shows a floating kind picker (`arrow` | `box` | `step` | `spotlight` | `blur`).
- Replaces the preview interaction mode with a drag-to-place canvas overlay
  (positioned absolutely over `PreviewCanvas`, pointer-events on).
- On drag-complete, dispatches `add-callout` with the drawn geometry
  normalised to 0–1 viewport coordinates.
- Focus-traps the kind picker per accessibility steering.

### `src/ui/PaddedBackgroundPanel.tsx` (new)

Inspector section on video clips. Contains:
- Toggle "Padded Background" checkbox.
- When enabled: background kind picker, colour/gradient/wallpaper controls,
  sliders for inset/corner/shadow params.
- Live preview updates via the existing 80 ms debounce + worker message
  pattern.

## `src/engine/timeline.ts` (extended)

`addCalloutClip(state, payload)` — creates a source-less clip with `kind:
'callout'`, `sourceId: ''`, `callout: payload`. Places it on a new or existing
overlay video track (same logic as `addTitleClip`). Returns the new clip's id.

The `isTitleClip` guard is supplemented by `isCalloutClip(clip: TimelineClip):
boolean` = `clip.kind === 'callout'`. The `ClipKind` union becomes `'video' |
'title' | 'callout'`.

## Persistence / schema

- All new fields (`callout`, `paddedBackground`, `sessionEventLogs`) are
  optional. Older project documents parse without error (existing `switch`
  ladder in `parseProjectDoc`).
- Callout and paddedBackground payload values are serialised as plain JSON
  fields in `TimelineClipSnapshot`, which means they ride Phase 23 bundles
  automatically via `project.json`.
- `SessionEventLogRef.opfsPath` is a relative path into OPFS. On a different
  device the OPFS path will not exist; the event log is treated as absent
  (proposals panel shows "No event log available") without error.
- Event log data itself is never bundled (it is OPFS-local and informational
  only). A validation test asserts the bundle serialiser receives no
  `sessionEventLogs` raw data.

## Third-party additions

No new runtime dependencies. All components use existing browser APIs (WebGPU
compute, OffscreenCanvas 2D, OPFS) plus synchronous local hashing for stable
IDs/cache keys, and the existing project infrastructure (Mediabunny, SolidJS,
Vite). The WGSL shaders are authored inline (same pattern as existing shaders
in `src/engine/shaders/`).

## Validation

### Unit tests (Vitest, Node environment, co-located)

- **`src/engine/event-log.test.ts`**: entry normalisation (clamp x/y, require
  finite t, require valid kind); schema serialise/deserialise roundtrip;
  reserved `key` channel preserved on deserialise; `flush()` with mocked OPFS
  `FileSystemDirectoryHandle` writes a valid JSON file.
- **`src/engine/auto-zoom.test.ts`**: `clusterEvents` — zero events → empty
  array; single event → one proposal; two events inside 2 s and 15 %
  threshold → one cluster; two events outside threshold → two clusters;
  overlapping proposals merge at 50 ms boundary; determinism check (same input
  twice → same output); performance bound — 216 000 synthetic entries under
  100 ms (measured with `performance.now()` in the test; asserted `< 100`).
- **`src/engine/callout.test.ts`**: `calloutContentHash` invalidates on each
  individual `style` and `geometry` field change; `parseCalloutPayload` accepts
  valid and rejects missing/extra/wrong-type fields; `normalizeCalloutPayload`
  fills defaults; round-trip serialise → deserialise is bit-identical for all
  five callout kinds.
- **`src/engine/padded-background.test.ts`**: `PaddedBackgroundParams`
  round-trip; `shadowCacheKey` differs for differing `(shadowRadius,
  cornerRadius)` pairs; wallpaper `sourceId` validation (present sourceId →
  resolves; absent sourceId → returns `null` + console.warn).
- **`src/engine/project.test.ts`** (extended): project docs with `callout`,
  `paddedBackground`, and `sessionEventLogs` fields survive
  `serializeProject`/`parseProjectDoc` without data loss; older docs (fields
  absent) parse cleanly at the new schema version.
- **Protocol type guards** for `CalloutPayload`, `PaddedBackgroundParams`,
  `SessionEventLogRef`, and `ClipKindSnapshot: 'callout'`.

### Manual smoke (checklist in `docs/VERIFY_DEPLOYMENT.md`)

1. Apply `zoom-in-region` preset on an import clip → keyframes appear in
   editor → scrub confirms zoom → export and inspect output.
2. Record an own-tab session → land → open Auto-Zoom panel → apply 2
   proposals → skip 1 → undo apply → redo → scrub → export.
3. Place arrow callout, blur callout → export → open in a media player and
   confirm both overlays visible in the output.
4. Enable padded background with gradient, then with wallpaper → export at
   1080p → confirm rounded corners, shadow, and wallpaper; also verify no
   frame drops during playback on the accelerated tier.
5. Open on a lower capability tier → confirm all four Inspector sections
   show the "Requires WebGPU" tooltip and are non-interactive.
