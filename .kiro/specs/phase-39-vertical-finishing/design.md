# Design: Phase 39 — Vertical and Platform Finishing

> Status: **Implemented** — this branch contains the Phase 39 implementation.

## Goal

Give short-form creators a first-class vertical workflow: a project that knows
it is 9:16, a compositor that renders to that shape, platform-branded safe-zone
overlays updated from JSON without code changes, a thumbnail that travels with
every export, and built-in export presets tuned for Douyin, Shorts, Reels, and
Xiaohongshu. All four features compose on the same code paths — the aspect mode
drives the compositor, the safe-zone overlay is a data-driven DOM overlay, the
cover export is a one-shot compositor run at the end of a render-queue job, and
platform presets are rows in the existing `BUILT_IN_PRESETS` array with an
additional `targetLufs` field.

## Non-goals

- **Direct upload or publish APIs** for any platform. Scheduling or posting is
  not in scope; this phase produces files, not network sessions.
- **Dynamic aspect transitions** (animated letterbox changes mid-timeline) — the
  project aspect is a static property; clips re-letterbox, they do not animate.
- **Per-clip aspect overrides** — the output aspect is a project-level setting.
  Per-clip fit modes (`fill`, `fit`, `letterbox`) are untouched.
- **Vertical capture or camera input** — Phase 41 handles capture; this phase
  only affects the compositor output and export pipeline.
- **Phase 36 loudness normalisation** — `targetLufs` is stored and round-tripped
  but the DSP path is owned by Phase 36. Until that phase lands, the field is
  inert and must not block preset selection.
- **Platform-format validation beyond codec/resolution** — LocalCut cannot
  guarantee bitrate reception or container compliance on any third-party CDN;
  the preset table values are best-practice defaults, not enforced maximums.

## Why these four features ship together

They share a single user story: a creator making a Douyin clip. They pick 9:16,
glance at the Douyin safe-zone overlay to keep text clear of the UI bar, set
a cover frame, and export with the Douyin platform preset. Each feature is
lightweight on its own; shipping them atomically ensures the UX is coherent
without coupling the code.

## Architecture

```
                   ┌─────────────────────────────────────┐
                   │   src/ui/App.tsx (main thread)       │
                   │                                      │
  user picks       │  [Format picker] → set-project-format│
  aspect/platform  │  [Platform zone picker]              │
  cover/preset     │  [Cover frame button]                │
                   │     └─ set-cover-frame command       │
                   └──────────────┬──────────────────────┘
                                  │ WorkerCommand (postMessage)
                   ┌──────────────▼──────────────────────┐
                   │   src/engine/worker.ts (pipeline     │
                   │   worker)                            │
                   │                                      │
                   │  handleSetProjectFormat              │
                   │    → mutates projectFormat in        │
                   │      worker state                    │
                   │    → calls setPreviewSize(outW, outH)│
                   │    → undo snapshot                   │
                   │                                      │
                   │  handleSetCoverFrame                 │
                   │    → mutates cover in worker state   │
                   │    → undo snapshot                   │
                   │                                      │
                   │  renderQueueRunJob (after video done)│
                   │    → exportCoverFrame() — one-shot   │
                   │      compositor + readback + JPEG    │
                   │    → writes <stem>.cover.jpg         │
                   └─────────────────────────────────────┘

                   ┌────────────────────────────────────┐
                   │  public/safe-zones/safe-zones.v1.json│
                   │  (static asset, updatable without   │
                   │  code change)                       │
                   │         ↓ fetch() at startup        │
                   │  src/engine/safe-zones.ts           │
                   │  validateSafeZoneFile()             │
                   │         ↓ signal to UI              │
                   │  SafeZoneOverlay.tsx                │
                   │  (DOM rects inside preview overlay) │
                   └────────────────────────────────────┘
```

## Component details

### `src/engine/project.ts` — `ProjectDoc` schema changes

```typescript
export type ProjectAspect = '16:9' | '9:16' | '1:1' | '4:5';

export interface ProjectFormat {
  aspect: ProjectAspect;
}

export interface CoverFrameDoc {
  timeS: number;
  titleClipId?: string | null;
}

export interface ProjectDoc {
  // ... existing fields unchanged ...
  projectFormat?: ProjectFormat;   // optional; default '16:9' on deserialize
  cover?: CoverFrameDoc;           // optional; absent means no cover
}
```

**Schema version:** bump `PROJECT_SCHEMA_VERSION` to the next unused version
above 10 (v11 is claimed by the open Phase 46 PR #63, so write "bump to the
next unused version" in code comments — the implementer checks the merged state
and uses the correct number). The deserializer handles the old version by
defaulting `projectFormat` to `{ aspect: '16:9' }` and `cover` to undefined.

**Validation helpers:** `parseProjectFormat` and `parseCoverFrame` follow the
same null-returning pattern as `parseExportSettings`. Unknown `aspect` strings
default to `'16:9'`.

### `src/protocol.ts` — new commands and state messages

Following the existing kebab-case `{domain}-{verb}` convention:

```typescript
// Commands (WorkerCommand union)
| { type: 'set-project-format'; aspect: ProjectAspect }
| { type: 'set-cover-frame'; timeS: number; titleClipId?: string | null }

// State messages (WorkerStateMessage union)
| { type: 'project-format-changed'; aspect: ProjectAspect }
| { type: 'cover-frame-changed'; cover: { timeS: number; titleClipId?: string | null } | null }
```

The `project-format-changed` message triggers `setPreviewSize` recalculation in
`App.tsx` (updating the `--preview-aspect` CSS custom property) and resets the
platform picker if the current platform's aspect no longer matches.

### Output dimension lookup

A pure helper `aspectOutputSize(aspect: ProjectAspect): { width: number; height: number }`
lives in `src/engine/project.ts` (or a small new `src/engine/aspect.ts`):

```typescript
const ASPECT_OUTPUT_SIZES: Record<ProjectAspect, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1':  { width: 1080, height: 1080 },
  '4:5':  { width: 1080, height: 1350 },
};
export function aspectOutputSize(aspect: ProjectAspect) { return ASPECT_OUTPUT_SIZES[aspect]; }
```

The worker calls `aspectOutputSize(projectFormat.aspect)` wherever it previously
used the hardcoded `{ width: 1920, height: 1080 }` — specifically in the
`TITLE_ONLY_CANVAS` fallback and in the adaptive preview ladder initialisation.
The existing `buildPreviewLadder(outW, outH)` is called with the project output
dimensions at import time and on every `set-project-format` command.

### Why `setPreviewSize` is the right hook

`src/engine/gpu.ts`'s `GpuRenderer.setPreviewSize(w, h)` and
`src/engine/compatibility/canvas-compositor.ts`'s `CanvasCompatibilityRenderer.setPreviewSize`
already resize the backing textures and `OffscreenCanvas`. The worker calls this
at import and on adaptive downgrade. Adding a call on `set-project-format` is
the minimal, tested path to change the output shape — no new texture or render
path is introduced.

### Preview CSS aspect-ratio

The `.preview-canvas` and `.safe-area-overlay` rules in `src/global.css`
currently hard-code `aspect-ratio: 16 / 9`. This is changed to read a CSS
custom property set on the preview container element:

```css
.preview-canvas {
  aspect-ratio: var(--preview-aspect, 16 / 9);
}
.safe-area-overlay {
  aspect-ratio: var(--preview-aspect, 16 / 9);
  /* height formula in the width: min() calc also updates to use the aspect variable */
}
```

`App.tsx` sets `style={{ '--preview-aspect': `${outW} / ${outH}` }}` on the
`.preview` container element in response to `project-format-changed`.

### `src/engine/safe-zones.ts`

```typescript
export interface SafeZoneRect { x: number; y: number; w: number; h: number; }
export interface SafeZoneEntry { id: string; label: string; rect: SafeZoneRect; kind: 'occluded' | 'caution'; }
export interface SafeZonePlatform { id: string; label: string; aspect: ProjectAspect; zones: SafeZoneEntry[]; }
export interface SafeZoneFile { safeZoneSchemaVersion: 1; platforms: SafeZonePlatform[]; }

export function validateSafeZoneFile(json: unknown): SafeZoneFile | null { /* hand-rolled */ }
```

The validator checks:
1. `safeZoneSchemaVersion === 1` (exact number, not cast).
2. `platforms` is a non-empty array.
3. Each platform has a non-empty string `id`, `label`, supported `aspect`
   (`16:9`, `9:16`, `1:1`, `4:5`), and non-empty `zones` array.
4. Each zone has `id`, `label`, `kind` ∈ `{'occluded', 'caution'}`, and `rect`
   with all four fields as finite numbers in [0, 1] (x+w ≤ 1, y+h ≤ 1).
Returns `null` without throwing on any violation.

### `public/safe-zones/safe-zones.v1.json` — shipped zone estimates

The following values are **editorial estimates** of typical UI occlusion based
on public platform documentation and visual measurement as of June 2026. They
are intentionally conservative (larger than strict minimum). Platform UI changes
can be addressed by updating this file without any code change.

```json
{
  "safeZoneSchemaVersion": 1,
  "platforms": [
    {
      "id": "douyin",
      "label": "Douyin",
      "aspect": "9:16",
      "zones": [
        { "id": "douyin-bottom-bar", "label": "Bottom UI bar (share / comments / likes)", "rect": {"x": 0, "y": 0.75, "w": 1, "h": 0.25}, "kind": "occluded" },
        { "id": "douyin-right-column", "label": "Right interaction column", "rect": {"x": 0.78, "y": 0.20, "w": 0.22, "h": 0.55}, "kind": "occluded" },
        { "id": "douyin-safe", "label": "Recommended safe area", "rect": {"x": 0.05, "y": 0.08, "w": 0.70, "h": 0.64}, "kind": "caution" }
      ]
    },
    {
      "id": "xiaohongshu",
      "label": "Xiaohongshu (小红书)",
      "aspect": "9:16",
      "zones": [
        { "id": "xhs-bottom-bar", "label": "Bottom nav / caption area", "rect": {"x": 0, "y": 0.80, "w": 1, "h": 0.20}, "kind": "occluded" },
        { "id": "xhs-top-bar", "label": "Top status / back bar", "rect": {"x": 0, "y": 0, "w": 1, "h": 0.07}, "kind": "occluded" },
        { "id": "xhs-safe", "label": "Recommended safe area", "rect": {"x": 0.05, "y": 0.10, "w": 0.90, "h": 0.68}, "kind": "caution" }
      ]
    },
    {
      "id": "shorts",
      "label": "YouTube Shorts",
      "aspect": "9:16",
      "zones": [
        { "id": "shorts-bottom-bar", "label": "Bottom title / action bar", "rect": {"x": 0, "y": 0.72, "w": 1, "h": 0.28}, "kind": "occluded" },
        { "id": "shorts-right-column", "label": "Right action column", "rect": {"x": 0.80, "y": 0.20, "w": 0.20, "h": 0.52}, "kind": "occluded" },
        { "id": "shorts-safe", "label": "Recommended safe area", "rect": {"x": 0.05, "y": 0.06, "w": 0.70, "h": 0.65}, "kind": "caution" }
      ]
    },
    {
      "id": "reels",
      "label": "Instagram Reels",
      "aspect": "9:16",
      "zones": [
        { "id": "reels-bottom-bar", "label": "Bottom caption / action bar", "rect": {"x": 0, "y": 0.70, "w": 1, "h": 0.30}, "kind": "occluded" },
        { "id": "reels-right-column", "label": "Right like / comment / share column", "rect": {"x": 0.78, "y": 0.18, "w": 0.22, "h": 0.52}, "kind": "occluded" },
        { "id": "reels-safe", "label": "Recommended safe area", "rect": {"x": 0.05, "y": 0.08, "w": 0.68, "h": 0.60}, "kind": "caution" }
      ]
    }
  ]
}
```

### `src/ui/SafeZoneOverlay.tsx`

A new SolidJS component that owns platform-zone rendering. It receives:
```typescript
interface SafeZoneOverlayProps {
  platform: SafeZonePlatform | null;  // null = hidden
  outputWidth: number;
  outputHeight: number;
}
```
It renders a `<div class="safe-zone-overlay" aria-hidden="false">` containing
one `<div>` per zone, positioned with `left`, `top`, `width`, `height` as
percentages derived from `zone.rect`, styled by `zone.kind`:

- `occluded`: `background: rgb(255 80 80 / 22%)`, `border: 1px dashed rgb(255 80 80 / 70%)`.
- `caution`: `background: rgb(255 200 0 / 10%)`, `border: 1px dashed rgb(255 200 0 / 55%)`.

Each zone `<div>` carries `aria-label={zone.label}` and `title={zone.label}`.
The component has `onCleanup` (no subscriptions, so no-op but present for
pattern consistency). It is rendered inside the same `.preview` container as
`.safe-area-overlay`, at the same `z-index: 3`, `pointer-events: none`.

### Cover-frame export: `exportCoverFrame` in `src/engine/worker.ts`

```typescript
async function exportCoverFrame(
  cover: CoverFrameDoc,
  outputStem: string,
  outputDir: FileSystemDirectoryHandle
): Promise<{ ok: true } | { ok: false; error: string }>
```

Steps:
1. Seek the compositor to `cover.timeS` and render one frame (the same
   `renderFrame` path used during preview, with the active title cache).
2. `copyTextureToBuffer` from the compositor's output texture into a
   `GPUBuffer` with `MAP_READ | COPY_DST` usage.
3. Map the buffer, create an `ImageData`, then `createImageBitmap(imageData)`.
4. Stamp it onto an `OffscreenCanvas` of the output dimensions.
5. `await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })`.
6. Write the blob to `outputDir` as `<outputStem>.cover.jpg` using
   `FileSystemFileHandle.createWritable()`.

Comment at step 3: `// Cover export: one-shot readback, not a sustained pixel
loop — hard gate 2 exemption`.

If `cover.titleClipId` is set, the `TitleTextureCache` is consulted for the
clip's texture before the compositor render; the clip's transform is applied
via the normal compositing path. This is architecturally identical to how P14
title clips appear in exports.

The function returns `{ ok: false; error: string }` for any failure. The caller
(render-queue job completion handler) stores the error in a new
`coverExportError: string | null` field on `RenderQueueJob` and posts a
non-fatal warning state message to the UI.

For single-job queues, the UI must choose `showDirectoryPicker` instead of
`showSaveFilePicker` whenever `cover` is set, because a
`FileSystemFileHandle` cannot create a sibling `<stem>.cover.jpg`. The selected
directory is sent with the queue output handle so the worker can write both the
video and cover JPEG.

The same cover renderer exposes a `request-cover-thumbnail` worker command for
the UI preview and a bundle-export callback so portable project bundles can
include `cover/<stem>.cover.jpg` as a first-class asset.

### Platform preset codec-fallback helper

A new pure function in `src/engine/export-presets.ts`:

```typescript
export function resolvePlatformPresetCodec(
  preset: ExportPresetDoc,
  probe: CapabilityProbeResult
): { codec: ExportVideoCodec; container: ExportContainer } | { blocked: true; reason: string }
```

Algorithm (R4.3):
1. Call `exportConstraintsForProbe(probe)` — the existing helper.
2. If the preset's requested codec/container is supported, return it unchanged.
3. Otherwise try the alternate common web export pairing: H.264/MP4 for VP9
   presets, VP9/WebM for H.264 presets.
4. Else return `{ blocked: true, reason: "This device cannot encode H.264 or VP9. Platform preset unavailable." }`.

The UI displays the resolved codec (and a banner if it fell back) in the export
dialog before the user confirms.

### `src/engine/export-presets.ts` — platform preset additions

`targetLufs` is added as `targetLufs?: number` to the `ExportPresetDoc`
interface in `src/protocol.ts`. The `BUILT_IN_PRESETS` array in
`src/engine/export-presets.ts` is extended with the six rows in R4.2.
`mergePresetsWithBuiltIns` and `parseExportPresetDoc` are updated to pass
`targetLufs` through using `finiteNumber(value.targetLufs) ?? undefined`.

### Undo/redo integration

The worker's undo ledger (Phase 9) already handles all timeline mutations via
`pushUndoSnapshot`. The two new commands — `set-project-format` and
`set-cover-frame` — are handled identically to other undoable commands: the
worker pushes a snapshot of the full `ProjectDoc` state before applying the
mutation, so undo restores the previous aspect or cover frame.

## Third-party additions

**No new runtime dependencies.** The safe-zone JSON is fetched from
`${import.meta.env.BASE_URL}safe-zones/safe-zones.v1.json` so sub-path
deployments work. Validation is hand-rolled. Cover export uses
`OffscreenCanvas.convertToBlob`, a web platform primitive. No new libraries are
introduced.

## Validation

### Unit tests (Vitest, Node environment, co-located)

**`src/engine/safe-zones.test.ts`** (new file):
- Loads `public/safe-zones/safe-zones.v1.json` and asserts `validateSafeZoneFile` returns non-null.
- Rejects `safeZoneSchemaVersion` not equal to `1`.
- Rejects `rect` values where any component is < 0 or > 1, or where `x + w > 1` or `y + h > 1`.
- Rejects unknown `kind` string.
- Returns `null` (does not throw) when given `null`, a string, or a structurally invalid object.

**`src/engine/project.test.ts`** (extended):
- `projectFormat` round-trips through serialise/deserialise for all four aspect values.
- Missing `projectFormat` in a v10 document deserialises to `{ aspect: '16:9' }`.
- `cover` with `titleClipId: null` and `cover` with `titleClipId: 'clip-1'` both round-trip.
- Absent `cover` deserialises to `undefined`.
- Schema version in the serialised output equals the new bumped value.

**`src/engine/export-presets.test.ts`** (extended):
- All six platform presets are present in `BUILT_IN_PRESETS`; each has non-zero `width`, `height`, `fps`, `videoBitrate` and a valid `codec`/`container`.
- `targetLufs` survives serialise → parse round-trip (both present and absent).
- `resolvePlatformPresetCodec`: returns h264/mp4 when h264 is supported; falls back to vp9/webm when h264 is unsupported; returns `{ blocked: true }` when both are unsupported.

### Manual smoke tests

1. Create a new project, change format to 9:16 — preview box becomes portrait;
   existing clips re-letterbox; undo restores 16:9.
2. Select the Douyin platform in the safe-zone picker — coloured rects appear
   over the preview; switching back to "Off" removes them.
3. Set a cover frame, run a render-queue job — `<stem>.cover.jpg` appears
   alongside the video at the expected timestamp.
4. Select a Douyin preset on a device that only supports VP9 — the dialog shows
   the fallback banner; H.264+AAC device shows the preset without a banner.
