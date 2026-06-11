# Design: Phase 30 — Animated Caption Styles (花字)

> Status: **Proposed** — spec only, not yet implemented.

## Goal

Extend the Phase 22 caption track system with a production-quality visual
styling engine: glow, per-line background pills, and enter/exit animations (pop,
bounce, slide, typewriter), plus optional karaoke-style word highlighting when
per-word timestamps are present. Rendering reuses the Phase 14 GPU-cached title
raster path and Phase 15 keyframe interpolation utilities. Zero per-frame
Canvas2D work is added to the hot path; animation state is uniform-driven at
composite time. Ten or more built-in presets ship as code constants; custom
presets import/export as versioned `.json` files. Styled captions survive Phase
23 bundle round-trips. Preview/export parity is structural, not incidental.

## Why this approach

### Raster once, composite with uniforms

The core design constraint is AGENTS.md hard gate 2: no CPU pixel round-trips in
the accelerated path. The Phase 14 title raster cache already solves this for
static text: rasterize once (event-driven), cache the GPU texture, composite
zero-copy every frame. Phase 30 extends that contract to styled captions:

- **Glow and pills** are drawn in the Canvas2D raster pass (the cold edit path).
  Shadow blurs and rounded-rect fills are native Canvas2D operations — no new
  GPU shaders, no readbacks.
- **Enter/exit animations** (pop, bounce, slide) are transform and opacity curves
  applied at composite time via uniforms, not by re-rasterizing per frame. The
  Phase 15 keyframe interpolation utilities already provide the curve machinery.
- **Typewriter and karaoke** use a `cropRightFrac` uniform that UV-clips the
  cached raster left-to-right — one cheap uniform write per frame, not a
  re-rasterize. Karaoke re-rasterizes only on word-boundary crossings (at most
  once per word), which is infrequent relative to the frame rate.

This approach keeps the per-frame cost equivalent to the existing title layer
cost: one O(1) interpolation call and one uniform write per active segment.

### Glow via Canvas2D shadow layers (not WebGPU blur)

A WebGPU blur pass would require a separate render target and an additional
`queue.submit`, violating hard gate 4 (single submission per frame). Canvas2D
`shadowBlur` with zero offset produces a visually equivalent glow effect at zero
GPU cost — the blur happens during the event-driven raster, not the per-frame
compositor path. The trade-off is that very large blur radii (`> 40 px`) may
look slightly softer than a multi-tap Gaussian blur shader, which is acceptable
for the styled-caption use case.

### Preset versioning as typed JSON (not a binary format)

Preset files are human-readable JSON with a `captionStyleSchemaVersion: 1`
discriminant. No binary format, no CBOR, no schema registry — the JSON is the
schema. Hand-rolled validators match the pattern in `src/engine/project.ts`
(`isRecord / requiredString / finiteNumber`), keeping the dependency surface
at zero. Future preset schema changes bump the version number; a version-
mismatch error surfaces the offending version rather than silently ignoring
unknown fields.

### Phase 29 alignment (loose dependency)

Phase 29 (auto-captions ASR, PR open on `origin/phase-29-auto-captions`) emits
word-level timestamps; its integration uses Phase 22 `CaptionSegment` objects.
This phase adds `words?: ReadonlyArray<{ text; startS; endS }>` to
`CaptionSegment` using the same field shape Phase 29 needs to populate. The
validator tolerates absence, so existing segments are unaffected. Phase 29 can
land on either side of Phase 30 without a migration — it simply populates the
field this phase defines. No hard coupling; Phase 30 does not import Phase 29
modules.

## Non-goals

- Speech recognition or automatic caption generation (Phase 29).
- Vertical CJK text layout (`writing-mode: vertical-rl`).
- User-authored WGSL shaders or custom GPU effects.
- A cloud preset marketplace or server-side preset synchronization.
- Embedding styling metadata into SRT/VTT sidecar files.
- Per-character animation (letter-by-letter pop/bounce); only full-line and
  full-word granularity is supported.
- Font download or runtime font installation (fonts must be bundled or system).

## Architecture

```
                         Edit path (cold — event-driven)
  ┌────────────────────────────────────────────────────────────────┐
  │ CaptionSegment text/style change                               │
  │   → resolveAnimPreset(presetId, customAnimCaptionPresets)      │
  │   → rasterizeTitleToCanvas(ctx, w, h, content)  [worker]      │
  │       extended: glow shadow passes + pill roundRect fills      │
  │   → copyExternalImageToTexture → GPUTexture                    │
  │       keyed by (trackId, segmentId, titleContentHash)          │
  └────────────────────────────────────────────────────────────────┘

                      Preview / export path (hot — per frame)
  ┌────────────────────────────────────────────────────────────────┐
  │ activeCaptionPayloadsAt(tracks, timeS)  [render.ts]            │
  │   → for each active burned-in segment:                         │
  │       preset = resolveAnimPreset(...)                          │
  │       uniforms = computeCaptionAnimUniforms(preset, seg, t)    │
  │         [pure, O(1), uses Phase 15 interpolation utils]        │
  │       karaoke: identify active word → use highlight raster     │
  │         if words present and highlightColor set                │
  │   → returns { textureView, transform, animUniforms }[]         │
  │                                                                │
  │ compositor.ts single queue.submit per frame                    │
  │   → caption layers: TextureCompositeLayer with                 │
  │       opacity, translate, scale (from animUniforms)            │
  │       uvCropMax = [cropRightFrac, 1.0] (typewriter/karaoke)    │
  └────────────────────────────────────────────────────────────────┘

                         Preset I/O (main thread)
  ┌────────────────────────────────────────────────────────────────┐
  │ CaptionStyleInspector.tsx                                      │
  │   Export → serializePreset → showSaveFilePicker / <a download> │
  │   Import → showOpenFilePicker → validateCaptionAnimPreset()    │
  │          → dispatch caption-import-custom-preset command       │
  │   Worker → stores in ProjectDoc.customAnimCaptionPresets       │
  └────────────────────────────────────────────────────────────────┘
```

All raster work stays in the pipeline worker. Main thread performs only preset
I/O (a handful of JSON reads/writes) and dispatches protocol commands.

## Components

### `src/engine/captions/anim-style.ts` (new)

Core type definitions and preset library.

```typescript
export const CAPTION_ANIM_SCHEMA_VERSION = 1;

export type CaptionAnimKind =
  | 'none' | 'pop' | 'bounce'
  | 'slide-up' | 'slide-down' | 'typewriter';

export interface CaptionPillConfig {
  paddingXPx: number;   // default 12
  paddingYPx: number;   // default 6
  radiusPx: number;     // default 8
  color: string;        // CSS color, default 'rgba(0,0,0,0.6)'
  opacity: number;      // [0,1], default 1
}

export interface CaptionAnimConfig {
  enter: CaptionAnimKind;  // default 'none'
  exit: CaptionAnimKind;   // default 'none'
  durationS: number;       // [0.05, 1.0], default 0.25
}

export interface CaptionAnimStylePreset {
  captionStyleSchemaVersion: 1;
  id: string;
  label: string;
  builtIn: boolean;
  anchor: CaptionAnchor;
  maxWidthPercent: number;  // [20, 100], default 80
  lineWrap: CaptionLineWrap;
  insetPx?: { x: number; y: number };
  titleStyle: Partial<TitleStyle>;
  glow?: { color: string; blurPx: number };  // blurPx [0, 80]
  pill?: CaptionPillConfig;
  animation?: CaptionAnimConfig;
  highlightColor?: string;  // CSS color; karaoke active-word color
}

export const ANIM_CAPTION_PRESETS: readonly CaptionAnimStylePreset[];
// 10 built-in entries, Object.freeze applied at module load.

export function resolveAnimPreset(
  presetId: string | null | undefined,
  customPresets: readonly CaptionAnimStylePreset[],
): CaptionAnimStylePreset;
// Looks up builtins then customPresets; falls back to ANIM_CAPTION_PRESETS[0].

export function validateCaptionAnimPreset(
  raw: unknown,
): { ok: true; value: CaptionAnimStylePreset } | { ok: false; field: string; message: string };
// Hand-rolled; isRecord / requiredString / finiteNumber pattern.
// Enforces captionStyleSchemaVersion === 1.
// Does NOT enforce id — caller assigns UUID on import.
```

### `src/engine/captions/animation-curves.ts` (new)

Pure per-frame uniform computation. No browser APIs; fully testable in Node.

```typescript
export interface CaptionAnimUniforms {
  opacity: number;
  translateXPx: number;
  translateYPx: number;
  scaleX: number;
  scaleY: number;
  cropRightFrac: number;  // [0, 1]; 1 = full width shown
}

export const CAPTION_ANIM_IDENTITY: CaptionAnimUniforms;
// { opacity:1, translateXPx:0, translateYPx:0, scaleX:1, scaleY:1, cropRightFrac:1 }

export function computeCaptionAnimUniforms(
  preset: CaptionAnimStylePreset,
  segStartS: number,
  segDurationS: number,
  currentTimeS: number,
): CaptionAnimUniforms;
// Uses Phase 15 lerp/easeInOut/easeOut from src/engine/keyframes/interpolation.ts.
// Clamps overlap when segDurationS < 2 × animation.durationS.
// Returns CAPTION_ANIM_IDENTITY when animation is absent or kind is 'none'.
```

Curve specifications per kind are defined above in R3.5. Each curve is a
sequence of `(normalizedT, value)` keyframes passed to the Phase 15
interpolator; the interpolator handles easing.

### `src/engine/captions/anim-style.ts` — built-in preset definitions

The 10 required presets (`"subtitle"` through `"slide-news"`) are defined as
object literals in this file. Key style decisions locked in:

| ID | Animation enter | Glow | Pill | Highlight |
|----|----------------|------|------|-----------|
| `"subtitle"` | none | none | none | no |
| `"lower-third"` | slide-up | none | charcoal pill | no |
| `"note"` | none | none | semi-transparent pill | no |
| `"bold-outline"` | none | none | none | no |
| `"neon-glow"` | none | cyan, 20px | none | no |
| `"karaoke"` | none | none | none | yellow |
| `"cinematic"` | pop (opacity only, scale = 1) | none | none | no |
| `"pop-card"` | pop | none | dark pill | no |
| `"bounce-card"` | bounce | none | none | no |
| `"slide-news"` | slide-up | none | charcoal pill | no |

### `src/engine/title.ts` (extended)

`rasterizeTitleToCanvas(ctx, width, height, content)` is extended to accept
additional fields via a new optional parameter or by widening `TitleContent`:

```typescript
export interface TitleRasterExtras {
  glow?: { color: string; blurPx: number };
  pill?: CaptionPillConfig;
}
```

The function signature becomes:
```typescript
export function rasterizeTitleToCanvas(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  content: TitleContent,
  extras?: TitleRasterExtras,
): void;
```

`titleContentHash(content, extras?)` is extended to include `extras` fields in
the hash string (NUL-separated, same pattern). Callers that do not use extras
pass `undefined`; the hash is backward-compatible (same output when extras is
absent).

### `src/engine/captions/render.ts` (extended)

`activeCaptionPayloadsAt` return type gains animation uniforms:

```typescript
export interface CaptionRasterPayload {
  trackId: string;
  segmentId: string;
  textureId: string;         // captionTextureId(trackId, segmentId [, 'highlight'])
  sourceWidth: number;
  sourceHeight: number;
  anchor: CaptionAnchor;
  insetPx: { x: number; y: number };
  maxWidthPercent: number;
  animUniforms: CaptionAnimUniforms;  // NEW — identity when no animation
}

export function activeCaptionPayloadsAt(
  tracks: readonly CaptionTrack[],
  timeS: number,
  customPresets: readonly CaptionAnimStylePreset[],
): CaptionRasterPayload[];
```

The karaoke path identifies the active word as the word where
`word.startS <= timeS < word.endS`; on word-boundary crossing the texture ID
switches to the highlight variant (e.g. `captionTextureId(trackId, segmentId, 'highlight')`),
which the `TitleTextureCache` manages as a separate slot.

### `src/engine/compositor.ts` (extended)

`TextureCompositeLayer` gains optional uniform fields used by caption layers:

```typescript
interface TextureCompositeLayer {
  kind: 'texture';
  view: GPUTextureView;
  sourceWidth: number;
  sourceHeight: number;
  transform: LayerTransform;
  uvCropMax?: [number, number];  // NEW — default [1.0, 1.0]
}
```

The WGSL composite shader is extended with a `uvCropMax: vec2f` uniform per
layer (or per-layer in the composite push-constant / uniform buffer). Caption
layers that use typewriter or karaoke pass `[cropRightFrac, 1.0]`; all other
layers pass `[1.0, 1.0]` (no change to existing layer behavior). This is
confined to the single existing `queue.submit` — hard gate 4 is not relaxed.

### `src/engine/project.ts` (extended)

```typescript
// PROJECT_SCHEMA_VERSION bumped: 10 → 11

export interface ProjectDoc {
  // ... existing fields ...
  customAnimCaptionPresets?: CaptionAnimStylePreset[];  // NEW optional
  captionTracks: CaptionTrack[];  // CaptionSegment.words field added (optional)
}
```

### `src/engine/captions/types.ts` (extended)

```typescript
export interface CaptionSegment {
  id: string;
  start: number;
  duration: number;
  text: string;
  style?: CaptionStyle | null;
  words?: ReadonlyArray<{ text: string; startS: number; endS: number }>;  // NEW
}
```

### `src/engine/persistence.ts` (extended)

Migration `10 → 11`:
```typescript
function migrateV10toV11(doc: Record<string, unknown>): void {
  if (!Array.isArray(doc['customAnimCaptionPresets'])) {
    doc['customAnimCaptionPresets'] = [];
  }
  // CaptionSegment.words: no action required — validator already tolerates absence.
}
```

Version guard is unchanged: documents at schema version > current are blocked
with a user-visible "newer version" notice.

### `src/protocol.ts` (extended)

New commands for preset management follow existing `{domain}-{verb}` pattern:

```typescript
type CaptionAnimCommand =
  | { type: 'caption-import-custom-preset'; preset: CaptionAnimStylePreset }
  | { type: 'caption-delete-custom-preset'; presetId: string }
  | { type: 'caption-set-anim-style'; trackId: string; segmentId?: string; presetId: string }
  | { type: 'caption-set-words'; trackId: string; segmentId: string;
      words: ReadonlyArray<{ text: string; startS: number; endS: number }> | null };

type CaptionAnimStateMessage =
  | { type: 'caption-custom-presets-updated'; presets: readonly CaptionAnimStylePreset[] };
```

Existing `set-caption-style` command is unchanged; the new `caption-set-anim-style`
addresses preset-ID–level assignment.

### `src/ui/CaptionStyleInspector.tsx` (new or merged into `src/ui/Inspector.tsx`)

A panel section rendered when a caption track or segment is selected. Shows:
- Preset picker (grid of labeled swatches — one per preset in
  `ANIM_CAPTION_PRESETS` plus custom presets, sorted built-ins first).
- Per-field overrides for `titleStyle`, `glow`, `pill`, `animation`.
- "Export preset" and "Import preset" buttons (R4.1, R4.2).
- "Save as preset" (saves current overrides as a new custom preset).
- Reduced-tier notice for burn-in when WebGPU is unavailable.

Follows UI-standards steering: dark professional aesthetic, keyboard accessible,
ARIA labels on all controls, no media objects or GPU handles in UI code,
`onCleanup` for any subscriptions.

## Protocol extensions summary

```typescript
// src/protocol.ts additions (follow existing WorkerCommand / WorkerStateMessage unions)

// WorkerCommand additions:
| { type: 'caption-import-custom-preset'; preset: CaptionAnimStylePreset }
| { type: 'caption-delete-custom-preset'; presetId: string }
| { type: 'caption-set-anim-style'; trackId: string; segmentId?: string; presetId: string }
| { type: 'caption-set-words'; trackId: string; segmentId: string;
    words: ReadonlyArray<{ text: string; startS: number; endS: number }> | null }

// WorkerStateMessage additions:
| { type: 'caption-custom-presets-updated'; presets: readonly CaptionAnimStylePreset[] }
```

## Persistence and schema notes

- `PROJECT_SCHEMA_VERSION`: `10 → 11` (in `src/engine/project.ts`).
- `BUNDLE_SCHEMA_VERSION` is **not** bumped — bundle structure is unchanged;
  the new fields ride in `project.json`.
- `customAnimCaptionPresets` in `ProjectDoc`: optional array; migration inserts
  `[]` when absent. Field is serialized into the bundle's `project.json` by the
  existing bundle serializer with no additional logic.
- `CaptionSegment.words`: optional; validator accepts undefined or a valid
  array. No migration writes words onto existing segments.
- Preset files exported by the user are **not** bundle assets and are never
  listed in `manifest.json`.

## Third-party additions

No new runtime dependencies. Glow, pills, and animations use Canvas2D and the
existing WebGPU compositor path respectively. Phase 15 interpolation utilities
are already in the repo. No new npm packages are introduced.

## Validation

- **Unit (Vitest, Node environment, co-located):**
  - `src/engine/captions/anim-style.test.ts` — preset validation, defaults,
    import guard (forced `builtIn: false`, new UUID), version rejection.
  - `src/engine/captions/animation-curves.test.ts` — `computeCaptionAnimUniforms`
    for all 6 kinds at t=0/0.5/1; overlap clamping; identity for 'none'.
  - `src/engine/captions/render.test.ts` (extended) — `activeCaptionPayloadsAt`
    returns non-identity uniforms inside enter window; identity outside; karaoke
    cropUV advances across word boundaries.
  - `src/engine/title.test.ts` (extended) — `titleContentHash` distinguishes
    glow and pill field changes; stable for identical inputs.
  - `src/engine/persistence.test.ts` (extended) — v10→v11 migration; v11
    round-trip; existing caption segments survive.
  - `src/engine/captions/types.test.ts` (extended) — `words` validator: valid,
    absent, overlapping, out-of-segment-range.
- **No new Playwright tests.** All acceptance criteria are provable by unit
  tests + the existing preview/export integration paths; no UI-critical flow
  requires a real browser for this phase.
- **Manual smoke (R7.1, R9.4):** import SRT, assign `"neon-glow"` preset,
  enable burn-in, scrub preview to verify glow renders, play timeline to verify
  enter animation, export MP4 and confirm burned-in frame matches preview;
  assign `"karaoke"` to a segment without words and confirm no error and
  full-line rendering.
