# Requirements: Phase 39 — Vertical and Platform Finishing

LocalCut gains first-class support for short-form vertical and square formats
(9:16, 1:1, 4:5) alongside the existing 16:9 landscape default. This phase
bundles four closely coupled capabilities: project-level aspect-ratio modes
that drive the compositor output and preview letterboxing; data-driven
safe-zone overlay guides for the occlusion areas of major short-form platforms;
a cover-frame picker that composites a thumbnail alongside the video in the
render queue; and per-platform export preset profiles that validate against the
existing Phase 17/18 capability probes and hook into Phase 36 loudness
normalisation when that phase lands.

Everything runs client-side and requires no new server infrastructure. Direct
upload or scheduled posting to any platform is explicitly out of scope.

---

## R1 — Project aspect-ratio modes

- **R1.1** `ProjectDoc` gains an optional field `projectFormat: { aspect:
  '16:9' | '9:16' | '1:1' | '4:5' }`. When absent on deserialization the
  value defaults to `'16:9'` without an error; the schema version is bumped
  to the next unused version above the current `PROJECT_SCHEMA_VERSION = 10`.
- **R1.2** The compositor output dimensions are derived from
  `projectFormat.aspect` at the start of every render frame and export job.
  The canonical output pixel dimensions for each aspect mode are:
  `'16:9'` → 1920 × 1080; `'9:16'` → 1080 × 1920; `'1:1'` → 1080 × 1080;
  `'4:5'` → 1080 × 1350. These are the base dimensions; the existing
  adaptive-preview ladder (`buildPreviewLadder`) derives reduced preview tiers
  from these base values.
- **R1.3** Changing the project aspect does not modify any clip's stored
  transform. Clips that were letterboxed via `computeFitRect` in 16:9 will
  re-letterbox against the new output aspect automatically, because the
  compositor always evaluates `computeFitRect(sourceW, sourceH, outW, outH,
  clip.fit)` at render time against the current output size.
- **R1.4** Changing the project aspect is an undoable worker command. The
  command type is `'set-project-format'` carrying `{ aspect: ProjectAspect }`;
  the worker applies it and posts an updated state snapshot; the undo/redo
  ledger (Phase 9) treats it as a reversible timeline mutation.
- **R1.5** The preview canvas in `src/ui/App.tsx` reflects the current project
  aspect by setting a CSS `aspect-ratio` custom property
  (`--preview-aspect: <w> / <h>`) derived from the output dimensions; the
  `.preview-canvas` and `.safe-area-overlay` CSS rules are updated to consume
  this custom property so the preview box changes shape without a page reload.
- **R1.6** The export dialog warns (non-blocking, inline) when the selected
  export preset's explicit `width`/`height` ratio does not match the current
  project aspect. Platform presets (R4) are automatically filtered to show
  aspect-matching options first; mismatched presets are still selectable with
  the warning visible.
- **R1.7** The aspect picker is accessible from the preview toolbar as a
  segmented-control labelled "Format". It is keyboard-navigable (arrow keys
  between segments) and each segment has an `aria-label` of the form
  `"Set project format to 9:16 (Vertical)"`.

---

## R2 — Data-driven safe-zone overlay guides

- **R2.1** A versioned JSON file `public/safe-zones/safe-zones.v1.json` ships
  with the application. Its schema is:
  ```
  {
    "safeZoneSchemaVersion": 1,
    "platforms": [
      {
        "id": string,           // machine-stable, e.g. "douyin"
        "label": string,        // human label, e.g. "Douyin"
        "aspect": "9:16" | "1:1" | "4:5" | "16:9",
        "zones": [
          {
            "id": string,       // stable within the platform
            "label": string,    // e.g. "Bottom UI bar"
            "rect": { "x": number, "y": number, "w": number, "h": number },
            "kind": "occluded" | "caution"
          }
        ]
      }
    ]
  }
  ```
  All `rect` fields are normalised 0–1 relative to the full output frame.
  Updating zone values requires only editing this JSON — no code change.
- **R2.2** `src/engine/safe-zones.ts` exports a hand-rolled validator
  `validateSafeZoneFile(json: unknown): SafeZoneFile | null` using the same
  `isRecord`/`requiredString`/`finiteNumber` pattern used in
  `src/engine/project.ts`. It returns `null` and logs a descriptive error on
  any schema violation; it does not throw. The exported types are:
  `SafeZoneFile`, `SafeZonePlatform`, `SafeZoneEntry`, `SafeZoneRect`.
- **R2.3** The shipped JSON contains sensible occlusion-area estimates (marked
  as editorial estimates in `design.md`) for at least four platforms:
  **Douyin**, **Xiaohongshu (小红书)**, **YouTube Shorts**, and **Instagram
  Reels**. Each platform entry includes at minimum one `'occluded'` zone for
  the bottom UI bar / caption area and one `'caution'` zone for the overall
  recommended safe area.
- **R2.4** A Vitest unit test in
  `src/engine/safe-zones.test.ts` imports
  `public/safe-zones/safe-zones.v1.json` (resolved relative to the project
  root) and asserts that `validateSafeZoneFile` returns a non-null value. This
  test is the CI validation gate for the JSON — no separate CI step is needed.
  Additional cases: validator rejects missing `safeZoneSchemaVersion`, rejects
  `rect` values outside [0, 1], rejects unknown `kind` values, and returns
  null (not throws) on malformed input.
- **R2.5** The preview toolbar gains a platform picker: a `<select>` (or
  button-group with a dropdown for accessibility) listing platforms whose
  `aspect` matches the current project aspect, plus an "Off" option. Selecting
  a platform other than "Off" renders its zones as labeled translucent DOM
  `<div>` rects inside the existing `.safe-area-overlay` container (or a
  sibling container of the same type). `'occluded'` zones are rendered
  with `background: rgb(255 80 80 / 22%)` and a red dashed border;
  `'caution'` zones with `background: rgb(255 200 0 / 10%)` and a yellow
  dashed border. Each zone `<div>` carries an `aria-label` of its `label`
  field and `aria-hidden="false"` so screen readers announce it.
- **R2.6** When the project aspect changes (R1.4) the platform picker resets to
  "Off" if the currently selected platform's aspect no longer matches.
- **R2.7** The existing "Safe areas" button (which toggles the generic
  title/action guides) is preserved unchanged. Platform zone display is
  additive and independent — both can be active simultaneously.

---

## R3 — Cover-frame picker

- **R3.1** `ProjectDoc` gains an optional field
  `cover: { timeS: number; titleClipId?: string | null }`. `timeS` is the
  timeline time (seconds) at which to sample the cover frame.
  `titleClipId` is the `id` of an existing title clip (P14) whose composited
  raster is to be blended over the cover frame; `null` or absent means no
  title overlay.
- **R3.2** The Inspector panel (or preview toolbar) exposes a "Set Cover Frame"
  action. Activating it captures the current playhead position as
  `cover.timeS` and writes the value via an undoable worker command
  `'set-cover-frame'` carrying `{ timeS: number; titleClipId?: string | null }`.
  The worker applies the mutation and the UI reflects it immediately via the
  existing snapshot-and-mirror protocol.
- **R3.3** A cover thumbnail preview is shown in the Inspector: when
  `cover.timeS` is set the UI requests a thumbnail via the existing
  `request-thumbnails` protocol and renders it in a small `<img>`-like canvas
  beside the "Set Cover Frame" button, with aria-label "Cover frame preview".
- **R3.4** Cover image export: when a render-queue job (P24) completes and
  `ProjectDoc.cover` is set, the worker composites the output frame at
  `cover.timeS` through the normal accelerated pipeline (same compositor path
  as preview/export), then performs a **single-frame readback** using
  `copyTextureToBuffer` → `createImageBitmap` → `OffscreenCanvas.convertToBlob`
  at JPEG quality 0.9. The cover image is saved alongside the video file with
  the stem `<output-stem>.cover.jpg`. PNG is not offered; JPEG at 0.9 quality
  is the only format.
- **R3.5** The single-frame readback in R3.4 does not violate architectural
  hard gate 2 (no CPU pixel round-trips in the accelerated hot path) because
  it is a one-shot post-export operation, not a per-frame sustained loop. It
  is clearly labeled in code comments as `// Cover export: one-shot readback,
  not a sustained pixel loop — hard gate 2 exemption`.
- **R3.6** Cover images are stored in project bundles (P23) as a `BundleAsset`
  with `kind: 'cover'`. The `BundleAssetKind` union in
  `src/engine/project-bundle/types.ts` is extended with `'cover'`. The
  relative path inside the bundle directory is `cover/<stem>.cover.jpg`.
- **R3.7** If cover export fails (compositor error, codec error, file write
  error), the main video export result is unaffected. The queue job's
  completion summary includes a `coverExportError: string | null` field so the
  UI can surface a non-blocking warning.
- **R3.8** When `titleClipId` is specified in `cover`, the compositor uses the
  existing `TitleTextureCache` to composite the title clip's raster over the
  cover frame using the clip's stored position/scale/opacity transform — the
  same render path as normal preview at that timestamp.

---

## R4 — Platform export presets

- **R4.1** `ExportPresetDoc` (in `src/protocol.ts`) gains an optional field
  `targetLufs?: number`. This field is stored and round-tripped through
  serialization but is inert until Phase 36 lands; code that reads it must
  guard with `?? undefined` and must not crash when absent.
- **R4.2** The following built-in platform presets are shipped in
  `src/engine/export-presets.ts` alongside the existing built-in presets.
  All have `builtIn: true`:

  | id                              | name                        | w    | h    | fps | videoBitrate | codec | container | targetLufs |
  |---------------------------------|-----------------------------|------|------|-----|--------------|-------|-----------|------------|
  | `builtin-douyin-1080p30`        | Douyin 1080p 30fps          | 1080 | 1920 | 30  | 10_000_000   | h264  | mp4       | -14        |
  | `builtin-shorts-1080p30`        | YouTube Shorts 1080p 30fps  | 1080 | 1920 | 30  | 10_000_000   | h264  | mp4       | -14        |
  | `builtin-shorts-1080p60`        | YouTube Shorts 1080p 60fps  | 1080 | 1920 | 60  | 15_000_000   | h264  | mp4       | -14        |
  | `builtin-reels-1080p30`         | Instagram Reels 1080p 30fps | 1080 | 1920 | 30  | 10_000_000   | h264  | mp4       | -14        |
  | `builtin-xhs-1080p30`           | Xiaohongshu 1080p 30fps     | 1080 | 1350 | 30  | 8_000_000    | h264  | mp4       | -14        |
  | `builtin-xhs-square-1080p30`    | Xiaohongshu Square 30fps    | 1080 | 1080 | 30  | 6_000_000    | h264  | mp4       | -14        |

- **R4.3** When a platform preset is selected in the export dialog, the existing
  `exportConstraintsForProbe` helper from `src/engine/capability-probe-v2.ts`
  is called to determine whether the requested codec (H.264) is encodable. If
  H.264 encode is `'unsupported'`, the UI automatically tries VP9 as the
  fallback (`container: 'webm'`). If VP9 is also unsupported, the preset
  selection is blocked with an explicit message: "This device cannot encode
  H.264 or VP9. Platform preset unavailable." The fallback is always visible
  to the user — silent degradation is not permitted.
- **R4.4** When a user selects a platform preset whose aspect ratio does not
  match `projectFormat.aspect`, the export dialog shows the inline warning from
  R1.6: "Export dimensions (1080×1920) do not match project format (16:9).
  The output may appear letterboxed."
- **R4.5** `ExportPresetDoc` serialization and deserialization in
  `src/engine/export-presets.ts` and `src/engine/project.ts` round-trips
  `targetLufs` as `number | undefined`; the parser uses `finiteNumber` and
  treats absent/null as `undefined`.
- **R4.6** Unit tests cover: built-in platform preset list is non-empty and
  all fields are valid; `targetLufs` survives a serialization round-trip;
  codec fallback logic correctly degrades h264→vp9 with a message, and blocks
  when both are unsupported.

---

## R5 — Tests, documentation, and quality gate

- **R5.1** Unit tests (Vitest, Node environment, co-located with the files they
  test) cover:
  - `src/engine/safe-zones.test.ts`: JSON validation (R2.4 cases).
  - `src/engine/project.test.ts` (or adjacent): `projectFormat` round-trips
    through `serializeProject` / `deserializeProject`; missing `projectFormat`
    defaults to `'16:9'`; schema version is bumped correctly; `cover` field
    round-trips; `cover.titleClipId` survives null and absent.
  - `src/engine/export-presets.test.ts` (extended): platform presets present
    and valid; `targetLufs` round-trip; codec fallback cases (R4.3).
  - No large media fixtures; all worker-side logic is tested with synchronous
    stubs injected via the existing protocol-message test helpers.
- **R5.2** `docs/USER-GUIDE.md` is updated with: a "Project format" section
  explaining aspect modes and the aspect-change behaviour; a "Platform safe
  zones" section; a "Cover frame" section; a "Platform presets" section with
  the preset table and a note that `targetLufs` is stored but inactive until
  Phase 36.
- **R5.3** `npm run build` succeeds with strict TypeScript (no `any` escapes
  introduced by this phase). `npm test` is green and the test count grows by
  at least the cases enumerated in R5.1.
