# Design: Phase 33 — Smart Reframe

> Status: **Implemented (saliency-only v1)** — automatic crop-path generation
> via saliency tracking, producing editable Phase 15 transform keyframes,
> reviewed through a preview overlay and applied as a single undo step. Zero
> server infrastructure; dedicated, lazily-spawned analysis worker. BlazeFace
> face detection runs through the shared LiteRT.js runtime, but no face-model
> catalogue entry is bundled yet — wiring the `.tflite` model is deferred to
> task T15 (see *Third-party additions*), so the shipped build runs
> saliency-only (R2.6 / R8.2).

## Goal

Given a clip and a target aspect ratio, generate a set of `x`, `y`, `scale`
keyframe tracks that keep the primary subject centred in the output frame as
the camera or subject moves. The keyframes are standard Phase 15 entries —
the user can edit, delete, or extend them by hand after generation. The
system detects faces via a lightweight BlazeFace-class model (LiteRT.js),
falls back to a pure-DSP saliency estimator for faceless footage, and
uses a One Euro–smoothed IoU tracker to follow one subject across the clip.
Shot boundaries are detected by histogram difference and reset the tracker.

## Non-goals

- **Multi-subject simultaneous framing** — v1 tracks one subject. Compositing
  multiple faces into a single crop path is a future consideration.
- **Object-class tracking beyond faces / saliency** — no car, pet, or
  product tracking. Face detection + generic saliency covers the common
  creator use case (talking heads, presentations, B-roll with a clear
  subject).
- **Automatic cutting, reordering, or content-aware editing** — Smart
  Reframe generates transform keyframes only; it does not alter the
  timeline structure.
- **Real-time / live reframe** — analysis is offline (sequential scan of the
  source), not a live-camera feature.
- **Audio analysis** — subject detection is purely visual.
- **Server-side inference, cloud models, or API calls** — all computation
  is local (R0.1).

## Architecture: where things run

```
  main thread (SolidJS)              Smart Reframe worker             pipeline worker
  ┌───────────────────────┐          ┌──────────────────────────┐     ┌────────────────┐
  │ SmartReframePanel     │          │ ReframeAnalyzer           │     │ (unchanged)    │
  │  ├ target aspect      │  post    │  ├ FrameDecoder           │     │                │
  │  │ selector           │  Message │  │  (Mediabunny demux +   │     │ timeline model │
  │  ├ preview overlay    │ ──────►  │  │   VideoDecoder)        │     │ playback loop  │
  │  │ (CSS/SVG on        │  start   │  ├ FaceDetector (LiteRT)   │     │ compositing    │
  │  │  monitor)          │  ◄─────  │  ├ SaliencyEstimator     │     │ export         │
  │  ├ apply / discard    │  result  │  ├ SubjectTracker         │     └────────────────┘
  │  │ / adjust           │  (done)  │  ├ ShotBoundaryDetector   │
  │  └ velocity/accel     │          │  └ KeyframeGenerator      │
  │    params             │          └──────────────────────────┘
  └───────────┬───────────┘                    ▲
              │ replace-keyframe-tracks        │ get-source-file → source-file
              │ (apply: single undo, R7.5)     │ (pipeline worker resolves the
              ▼                                │  File from OPFS / a handle and
         pipeline worker                      │  the UI forwards it)
         (timeline mutation)                   │
                                               │
         source media ─────────────────────────┘
         (resolved by the pipeline worker)
```

The Smart Reframe worker is a **separate `Worker` instance** from the pipeline
worker (R0.2). The pipeline worker owns the media bytes, so the UI requests the
source `File` from it via a `get-source-file` command and forwards the returned
`File` to the Smart Reframe worker, which owns its own Mediabunny demux +
`VideoDecoder` instance for offline frame scanning. This is architecturally
analogous to how Phase 28's Audio Cleanup worker receives PCM windows from the
pipeline worker — dedicated inference workers are the established pattern.

Analysis does not touch the pipeline worker's timeline model, GPU device, or
playback clock. The only bridge back is the `replace-keyframe-tracks` command
the UI sends after the user clicks "Apply", which overwrites the clip's `x`/`y`/
`scale` tracks in a single undo step (R7.5).

## Components

### `src/engine/reframe-analyzer.ts` (Smart Reframe worker entry)

The worker entry point. Receives a `ReframeCommand` (`start` / `cancel` /
`dispose`), orchestrates the pipeline:

```
source file → demux → decode at 2fps → for each frame:
  ├─ shot boundary detector (histogram delta)
  ├─ face detector (LiteRT) → bounding boxes
  │   └─ if zero faces → saliency estimator → centroid
  └─ subject tracker (IoU + One Euro)
→ keyframe generator (trajectory → x/y/scale tracks with motion bounds)
→ postMessage result back to main thread
```

All long-running operations are cancellable (R0.4). Cancel aborts the decode
loop, releases in-flight `VideoFrame`s (closed exactly once), and posts a
`cancelled` terminal state.

```typescript
// src/protocol.ts (extended)

interface ReframeStartCommand {
  type: 'reframe-start';
  clipId: string;
  sourceFile: File;                // the source media file
  sourceRotation: number;         // degrees, from Phase 18 conformance
  sourceWidth: number;
  sourceHeight: number;
  targetAspect: number;           // e.g. 9/16, 1, 4/5
  clipDuration: number;           // seconds
  inPoint: number;                // seconds, source offset
  analysisFps?: number;           // default 2
  velocityBound?: number;         // default 0.3 norm/s
  accelerationBound?: number;     // default 0.5 norm/s²
  shotBoundaryThreshold?: number; // default 0.5
}

type ReframeCommand =
  | ReframeStartCommand
  | { type: 'reframe-cancel' }
  | { type: 'reframe-dispose' };

type ReframeWorkerMessage =
  | { type: 'reframe-progress'; fraction: number; framesProcessed: number; totalFrames: number }
  | { type: 'reframe-result'; keyframes: ClipKeyframesSnapshot; stats: ReframeAnalysisStats }
  | { type: 'reframe-error'; reason: string }
  | { type: 'reframe-cancelled' };

interface ReframeAnalysisStats {
  framesAnalysed: number;
  facesDetected: number;
  saliencyFrames: number;
  shotBoundaries: number;
  keyframesGenerated: number;
  safeZoneCompliance: number;     // fraction 0..1
  mode: 'face' | 'saliency' | 'mixed';
}
```

### `src/engine/reframe/face-detector.ts`

Wraps LiteRT.js for BlazeFace-class face detection.

```typescript
interface FaceDetection {
  x: number;        // normalised [0,1] left
  y: number;        // normalised [0,1] top
  width: number;    // normalised
  height: number;   // normalised
  confidence: number;
}

interface FaceDetector {
  /** Run face detection on a downscaled ImageData. Async because LiteRT
   *  inference is asynchronous. */
  detect(imageData: ImageData): Promise<FaceDetection[]>;
  dispose(): void;
}

interface FaceDetectorFactory {
  create(modelUrl: string, manifest: ModelManifest): Promise<FaceDetector>;
}
```

- Model loaded once, cached for the worker session (R2.2).
- Inference on downscaled `ImageData` (longest edge ≤ 512 px, R2.3).
- Results mapped back to normalised source coordinates.
- The factory interface allows test injection with canned detections
  (R11.2).

### `src/engine/reframe/saliency-estimator.ts`

Pure DSP saliency — no ML model. Operates on the same downscaled
`ImageData`.

```typescript
interface SaliencyResult {
  centroidX: number;    // normalised [0,1]
  centroidY: number;    // normalised [0,1]
  confidence: number;   // 0..1, lower than face detections
}

interface SaliencyEstimator {
  estimate(imageData: ImageData): SaliencyResult;
}
```

Algorithm (all on the downscaled buffer, no GPU):

1. **Skin-tone mask** — convert RGB → YCbCr; threshold Cb ∈ [77, 127],
   Cr ∈ [133, 173] (standard skin-tone range). Morphological open/close
   to clean noise.
2. **Edge density** — Sobel magnitude on the luminance channel, binned
   into a coarse grid (e.g. 16×16 cells).
3. **Local contrast** — standard deviation of luminance per grid cell.
4. **Combined score** — weighted sum of skin mask density (0.5), edge
   density (0.3), local contrast (0.2) per cell. The highest-scoring
   cell's centre is the saliency centroid; confidence is the normalised
   score.

### `src/engine/reframe/subject-tracker.ts`

IoU-based association with One Euro smoothing.

```typescript
interface TrackedDetection {
  cx: number;         // normalised centre x
  cy: number;         // normalised centre y
  width: number;      // normalised width
  height: number;     // normalised height
  confidence: number;
  source: 'face' | 'saliency';
}

interface TrackerFrame {
  time: number;           // source time in seconds
  detection: TrackedDetection | null;  // null = no detection available
}

interface SubjectTracker {
  /** Feed one frame's detection (or null) with its source time.
   *  Returns the smoothed centroid. */
  update(frame: TrackerFrame): { cx: number; cy: number };
  /** Reset state (e.g., at shot boundary). */
  reset(): void;
  /** Get the full trajectory after all frames have been fed. */
  trajectory(): Array<{ time: number; cx: number; cy: number }>;
}
```

**IoU association** (R4.1): for each new detection, compute IoU with the
previous tracked box. If IoU ≥ threshold (0.3), it is the same subject.
If IoU < threshold but a detection exists, it is a new subject candidate;
accept only if the coast window (R4.2) has expired. Face detections are
preferred over saliency when both are present (R4.3 — higher confidence
weight).

**One Euro filter** (R4.3): applied to the tracked `(cx, cy)` centroid
after association. Parameters:
- `minCutoff`: 1.0 Hz (removes slow jitter)
- `beta`: 0.007 (tracks fast motion)
- `dcutoff`: 1.0 Hz (derivative filter cutoff)

The filter is a standard implementation (Casiez et al., 2012) — a
well-known, computationally trivial low-pass filter with adaptive
cutoff. No third-party library needed; ~60 lines of TypeScript.

### `src/engine/reframe/shot-boundary-detector.ts`

```typescript
interface ShotBoundaryDetector {
  /** Returns true if the current frame is a shot boundary. */
  isShotBoundary(prevHist: Float64Array, currHist: Float64Array): boolean;
}

/** Compute a normalised RGB histogram (8 bins per channel = 512 bins).
 *  Returns Float64Array of fractional bin probabilities (sum ≈ 1). */
function computeHistogram(imageData: ImageData): Float64Array;
```

Chi-squared distance between 512-bin normalised RGB histograms (8 bins
per channel). Threshold tuned empirically on a small fixture set; default
is 0.5 (R5.1). Pure arithmetic — no library.

### `src/engine/reframe/keyframe-generator.ts`

Converts a smoothed trajectory into Phase 15 keyframe tracks.

```typescript
interface KeyframeGenConfig {
  targetAspect: number;
  sourceAspect: number;
  sampleInterval: number;         // seconds, default 0.5
  velocityBound: number;          // norm/s, default 0.3
  accelerationBound: number;      // norm/s², default 0.5
}

interface KeyframeGenResult {
  keyframes: ClipKeyframesSnapshot;   // x, y, scale tracks
  safeZoneCompliance: number;         // fraction of frames in action-safe
}

function generateReframeKeyframes(
  trajectory: Array<{ time: number; cx: number; cy: number }>,
  config: KeyframeGenConfig
): KeyframeGenResult;
```

**Scale calculation** (R6.3):
The default `fit: 'fill'` already crops the source to match the output
aspect ratio. Smart Reframe's `scale` is an **additional user zoom**
above the fill crop — it starts at 1.0 (no extra zoom) and only
increases when tighter framing is needed. It never drops below 1.0.
```
scale = 1.0   // baseline — fill handles the aspect crop
// scale may increase above 1.0 for tighter framing
```

**Position calculation** (R6.2 — note the negation to shift the layer
opposite the subject's offset, because the P12 transform model adds
x/y to the layer centre):
```
x = -subjectCx * scale    // subjectCx in [-0.5, 0.5] from centre
y = -subjectCy * scale    // subjectCy in [-0.5, 0.5] from centre
```

**Motion bounds** (R6.5, R6.6):
- Pass 1: clamp velocity. For each consecutive keyframe pair, compute
  `v = Δx / Δt`. If `|v| > velocityBound`, scale `Δx` down.
- Pass 2: clamp acceleration. For each consecutive triple, compute
  `a = Δv / Δt`. If `|a| > accelerationBound`, reduce `Δv`.
- Both passes iterate until convergence (typically 2–3 iterations).

**Safe zone validation** (R6.7):
- Action-safe rectangle: centre ± 0.45 of output (90 %).
- Compute subject output position for each keyframe.
- If compliance < 95 %, reduce scale by 1 % and recompute, up to a
  maximum 20 % reduction. The widened scale zooms out, bringing more
  of the frame into view and pulling the subject into the safe zone.
- **Scale is never reduced below 1.0** — if the subject cannot be
  brought into the safe zone at scale 1.0, the UI notes the limitation
  rather than introducing black bars (R6.7).

**Hold keyframes at shot boundaries** (R5.3): when a shot boundary falls
between two sample points, insert a keyframe with `easing: 'hold'` at
`T_cut - ε` (immediately before the cut) so the preceding interval does
not interpolate across the discontinuity. The keyframe at `T_cut` itself
uses `'linear'` easing to allow tracking in the new shot.

### `src/ui/SmartReframePanel.tsx`

The UI panel for triggering and reviewing Smart Reframe.

- Target aspect ratio selector (dropdown of supported ratios, R1.1).
- "Analyse" button (disabled when no clip selected or worker
  unavailable).
- Progress bar during analysis (fraction from `reframe-progress`).
- Review overlay toggle after analysis completes (R7.1).
- Apply / Discard / Adjust actions (R7.3).
- Adjust mode: sliders for velocity bound, acceleration bound, and
  analysis FPS; "Re-analyse" button.
- Safe zone compliance stat from `ReframeAnalysisStats`.
- Face detection mode indicator (face / saliency / mixed).
- Capability row integration (R8.1, R8.2).

### `src/ui/ReframeOverlay.tsx`

CSS/SVG overlay on the programme monitor (R7.2).

- Semi-transparent rectangle showing the target aspect ratio crop at
  the current playhead position.
- Dashed inner rectangle for the action-safe zone.
- The overlay reads the generated keyframes and samples them at the
  current time using the existing `sampleKeyframes()` function from
  `src/ui/keyframes.ts`.
- No GPU passes, no Canvas2D readback — pure CSS `clip-path` or SVG
  `<rect>` positioned via CSS transforms (R7.4).

### `src/engine/reframe/model-manifest.ts`

Model manifest for the LiteRT.js face-detection model, following the Phase
28/29 LiteRT manifest pattern (R0.7).

```typescript
interface ReframeModelManifest {
  id: string;
  version: string;
  license: string;
  source: string;              // upstream provenance URL
  model: { url: string; sizeBytes: number; checksum: string }; // checksum: "sha256-…"
  inputSize: number;           // square model input edge (e.g. 128)
  outputStride: number;        // floats per detection row (≥ 5)
  format: 'tflite';
}
```

Validation is a pure function: unknown fields tolerated, missing/invalid
required fields rejected with a specific reason. The model asset is downloaded
and digest-verified via the shared `src/engine/asr/asset-cache.ts`
(`loadVerifiedAsset` / `verifyAsset`), exactly like the Whisper and DTLN
models.

## Modules

| Module | Description |
|--------|-------------|
| `src/engine/reframe-analyzer.ts` | Smart Reframe worker entry; orchestrates decode → detect → track → generate. |
| `src/engine/reframe/face-detector.ts` | LiteRT.js wrapper for BlazeFace-class detection. |
| `src/engine/reframe/saliency-estimator.ts` | Pure-DSP saliency: skin-tone + edge density + local contrast. |
| `src/engine/reframe/subject-tracker.ts` | IoU association + One Euro smoothing; single-subject tracking. |
| `src/engine/reframe/shot-boundary-detector.ts` | Chi-squared histogram distance for cut detection. |
| `src/engine/reframe/keyframe-generator.ts` | Trajectory → Phase 15 keyframe tracks with motion bounds. |
| `src/engine/reframe/one-euro-filter.ts` | One Euro filter implementation (~60 lines). |
| `src/engine/reframe/model-manifest.ts` | Manifest validation for face detection model weights. |
| `src/ui/SmartReframePanel.tsx` | UI panel: aspect selector, progress, review actions. |
| `src/ui/ReframeOverlay.tsx` | CSS/SVG crop preview overlay on programme monitor. |
| `src/protocol.ts` | Extended with `ReframeCommand` / `ReframeWorkerMessage` types. |
| `src/engine/capability-probe-v2.ts` | Extended with Smart Reframe probes. |

## Third-party additions

- **None.** Face detection reuses **LiteRT.js (`@litertjs/core`)**, already a
  project dependency since the Phase 28 (DTLN audio cleanup) and Phase 29
  (Whisper ASR) migrations off ONNX. The face detector is a thin wrapper over
  the same runtime (`src/engine/asr/litert-loader.ts`), loads its model through
  the same digest-verified asset cache (`src/engine/asr/asset-cache.ts`) and
  trusted-host allowlist (`src/engine/asr/model-catalog.ts`), and runs the
  LiteRT WASM served same-origin from `public/litert/` (copied by
  `scripts/setup-litert-assets.mjs`, excluded from the PWA precache). No ONNX
  runtime is used — `onnxruntime-web` is **not** a dependency (its ~26 MB WASM
  cannot be precached by the PWA).

  **Model bundling deferred to task T15 — no face-model catalogue entry ships
  in the current build.** The LiteRT runtime wrapper, manifest verification,
  and the output decoder are implemented and unit-tested, so adding a
  digest-pinned `.tflite` model catalogue entry (T15.2) is an isolated change.
  Until then Smart Reframe runs saliency-only (R2.6 / R8.2) and the capability
  probe reports face detection as `unsupported`.
- The One Euro filter, saliency estimator, histogram detector, IoU tracker,
  and keyframe generator are all hand-written TypeScript (< 200 lines each).
  Mediabunny is already a project dependency.

## Validation

| Scenario | Expected result |
|----------|----------------|
| 16:9 → 9:16 with a centred face | Subject stays in action-safe zone ≥ 95 % of frames; scale ≈ 1.78. |
| 16:9 → 1:1 with a face on the left third | Crop shifts left; subject centred in output; velocity/accel within bounds. |
| 16:9 → 9:16 with no faces (B-roll) | Saliency mode activates; notice shown; reasonable crop path generated. |
| Clip with a hard cut at T=2s | Shot boundary detected; tracker resets; hold keyframe at T=2s; no cross-cut interpolation. |
| Very short clip (< 0.5 s) | Analysis completes; keyframes at start + end only; UI notes limited data. |
| Clip with existing keyframes | Warning shown; user must confirm replacement. |
| Rapid subject motion (whip pan) | Generated keyframes respect velocity/acceleration bounds; no whip artefacts. |
| Model load failure | Saliency-only mode with visible notice; feature remains functional. |
| Apply → undo | All generated keyframes removed in one undo step. |
| Project save/load | Keyframes persist as standard Phase 15 entries; no Smart Reframe–specific state in the file. |
| Deterministic fixture (16:9 → 9:16) | Keyframe snapshot matches expected values within tolerance. |
