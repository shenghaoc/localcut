# Design: Phase 32b - Landmark-Driven Beauty

> Status: **Planned** - FaceMesh-class local inference through the shared ORT
> model platform, smoothed primary-face landmarks, and a WGSL mesh-warp beauty
> pass integrated with the existing worker-owned accelerated preview/export
> chain.

## Goal

Give creators a restrained, opt-in beauty correction pass that behaves like a
desktop NLE effect: subtle defaults, keyframable parameters, preview/export
parity, deterministic persistence, and honest capability gating. The feature
detects one primary face, infers dense landmarks at reduced cadence, smooths and
interpolates those landmarks, then drives a clip-local mesh warp for jaw, eyes,
nose, and mouth. The same landmarks also make the Phase 32a chroma skin mask
geometry-aware.

This is an editing effect, not an identity or demographic filter. A user must
add or enable the effect on a clip, and strength `0` is a bit-exact identity.

## ML Runtime Contract

Phase 32b uses the shared worker-owned ORT model platform:

- primary execution provider: ORT-WebGPU when the Phase 8/26 probe confirms
  WebGPU, cross-origin isolation, ORT runtime chunks, and the model contract;
- optional execution provider: ORT-WebNN only for detector/landmark models that
  have per-model support proof on the target browser/hardware;
- reduced/export-only execution provider: ORT-WASM only when tensors are small,
  bounded, and produced without full-frame CPU readback.

The OPFS model-cache and capability-probe contract remains unchanged:
manifest-declared assets, SHA-256 verification, versioned OPFS cache keys,
explicit download size/progress before fetch, and offline operation after the
first verified download. ORT runtime chunks and ONNX weights are loaded only
after explicit user action.

The accelerated path keeps `VideoFrame -> GPU ROI/preprocess -> ONNX detector
and landmark tensors -> smoothed landmarks -> WGSL beauty warp`. ORT owns the
inference session; it does not receive UI objects, DOM objects, raw media file
handles, or unbounded pixel buffers. Any reduced path consumes compact detector
or landmark tensors only and is visibly labelled as reduced/export-only.

## Non-goals

- **Makeup transfer** - no lipstick, foundation, eye shadow, or style transfer.
- **Face swap or identity alteration** - no replacing faces, changing identity,
  or deliberately making one person resemble another.
- **Age/gender filters** - no demographic inference or demographic appearance
  edits.
- **Body reshaping** - this phase is face landmarks only; no torso, limbs, or
  full-body mesh deformation.
- **Automatic "beautify" without user action** - the effect never runs just
  because a face is detected.
- **Multi-face editing in v1** - v1 edits the primary face only; per-face
  selection and multi-face keyframes are a future phase.
- **MediaPipe Tasks runtime** - do not add `@mediapipe/tasks-vision` for this
  feature.
- **TFLite or `.task` runtime assets** - no `.task` bundle dependency, no
  browser-side `.task` parsing, and no TFLite-specific model assumptions.
- **Direct cross-origin model fetches** - model URLs go through the shared model
  proxy prefixes or same-origin assets.
- **Whole-file analysis** - no buffering entire media files, decoded clips, or
  full landmark tracks when streaming frame access is available.

## Runtime Architecture

All media and ML data-plane work stays in the pipeline worker.

```
VideoFrame from decoder/cache
  -> importExternalTexture
  -> GPU ROI/preprocess pass (detector/landmark input tensors)
  -> ORT detector session on selected EP
  -> primary-face ROI selection
  -> ORT landmark session on selected EP
  -> landmark decode + primary-face smoothing/interpolation
  -> beauty warp uniform/storage buffers
  -> WGSL mesh-warp pass
  -> existing colour/transform/composite/export path
```

The accelerated path never reads back a full 1080p frame for ML. If ORT-WebGPU
cannot consume the GPU-preprocessed tensor path for a candidate model, that
model is rejected for accelerated preview until the implementation proves a
bounded transfer path. ORT-WASM is allowed only for explicit reduced/export-only
flows and must consume compact tensors, not full frames.

## Model Manifest And Assets

The v1 manifest is ONNX-first and declares multiple model assets:

- `detector` - face detection boxes/scores and optional sparse keypoints;
- `landmarks` - dense FaceMesh-class landmarks for one primary-face ROI;
- `blendshape` - optional expression coefficients, omitted in v1 unless a
  future phase adds expression controls.

Each asset has:

- `url`, `sizeBytes`, and `checksum` (`sha256-...`);
- `license`, `source`, `provider`, and `modelCard`;
- `format: 'onnx'`;
- an input contract and output contract with tensor names, shapes, data types,
  and semantic labels.

Allowed URLs are same-origin assets or shared model proxy paths:

- `/_model/hf/...`
- `/_model/gh/...`
- `/_model/gcs/...`
- `/models/...` or another same-origin static asset path

Direct `https://...` model URLs are rejected by manifest validation. This keeps
COOP/COEP behavior, digest verification, and cache identity under LocalCut's
control without adding accounts, telemetry, or server-side media processing.

## Model Candidates

The implementation evaluates ONNX FaceMesh/MediaPipe-derived artifacts such as
community FaceMesh ONNX exports and detector/landmark pairs that expose stable
contracts. A candidate can land only when design notes record:

- provenance and license compatibility for every ONNX asset;
- organisational backing or active maintenance for any new runtime library;
- tensor shapes, data types, output decode semantics, and landmark topology;
- measured support for ORT-WebGPU, and separate proof before enabling ORT-WebNN;
- exact download size and SHA-256 digest for every file.

The client must not depend on a MediaPipe `.task` bundle at runtime and must not
parse `.task` files in the browser.

## Primary-Face Tracking

Detection produces candidate boxes and sparse detector landmarks. Landmark
inference runs only for the chosen primary candidate:

```
primaryScore =
  detectionConfidence * 0.45
  + normalizedBoxArea * 0.25
  + centralityScore * 0.20
  + continuityWithPreviousPrimary * 0.10
```

The weights are constants in `primary-face.ts` and covered by unit tests. This
prevents the effect from jumping to a small background face while still allowing
handoff after a real scene change or when the main subject leaves frame.

Multi-face v1 decision: only one face receives deformation because the effect
parameters and keyframes are clip-level today. Applying one set of keyframes to
multiple faces would be surprising, and per-face identity tracking would require
a larger persistence model. The Inspector labels this plainly when more than
one candidate is detected.

## Cadence, Interpolation, And Smoothing

The scheduler derives a detection cadence from the project rate and measured
runtime cost:

- default 30 fps timeline: solve at most once every 3 frames (<=10 Hz);
- 60 fps timeline: solve at most once every 5-6 frames (<=10-12 Hz);
- under load: increase the interval until preview stays realtime, and report
  the actual cadence in diagnostics.

Each inference result is timestamped in timeline seconds. Rendered frames
between two inference results interpolate landmarks by timestamp, not by frame
index, so VFR sources and dropped inference frames do not drift. After
interpolation, each landmark coordinate passes through a one-euro filter with
configurable `minCutoff`, `beta`, and `dCutoff`. The filter state lives in
contiguous `Float32Array` buffers updated in a single loop, not as separate
per-coordinate class instances. Filter state is reset on scene cut, confidence
loss, or primary-face handoff; the warp strength ramps to identity over a short
fixed duration before accepting a new track.

The worker keeps a bounded ring:

```
LandmarkSample {
  t: number;
  faceId: string;
  confidence: number;
  landmarks: Float32Array; // topology-count * 3, normalized clip-local coords
}

history capacity: 4 samples
filter state: topology-count * 3 one-euro states
```

No unbounded landmark timeline is stored. Project files store effect settings,
not inferred face geometry.

## Warp Model

`beauty-warp.wgsl` consumes:

- source texture for the current clip layer;
- landmark storage buffer in clip-local normalized coordinates;
- a small static topology/control-region table;
- sampled keyframe params: `masterStrength`, `jawSlim`, `eyeEnlarge`,
  `noseWidth`, `mouth`;
- feather/falloff constants and model topology version.

The pass computes inverse warps so every output pixel samples the correct source
position. Each feature has a conservative region:

| Parameter | Region | Behavior |
|-----------|--------|----------|
| `jawSlim` | jawline to lower-cheek cage | Symmetric inward displacement with cheek feathering. |
| `eyeEnlarge` | per-eye elliptical cage | Small radial expansion around each eye, preserving eyelid landmarks. |
| `noseWidth` | nose bridge/alar landmarks | Horizontal scale around the nose centerline only. |
| `mouth` | lip contour cage | Subtle lip-spacing/proportion adjustment, not color or makeup. |

The `SUBTLE` preset is the default when the user adds the effect. Internally it
maps to small non-zero normalized values, while every slider still supports
`0`. A disabled effect, `masterStrength = 0`, or all sampled params equal to
zero skips the pass and returns the original texture path. That skip is the
preferred bit-exact identity implementation because it avoids resampling.

## Phase 32a Skin-Mask Integration

Phase 32a's chroma skin mask remains the base color classifier. Phase 32b adds a
geometry-aware mask buffer derived from the same smoothed landmarks:

- face oval inclusion reduces background false positives;
- eye and lip exclusion zones avoid grading sclera/teeth/lip color as skin;
- boundary feather follows the primary-face geometry;
- missing landmarks degrade to chroma-only with a reduced-quality label in the
  UI/Inspector only, never burned into exported video.

The mask is generated once per rendered frame from interpolated/smoothed
landmarks, so the beauty warp and skin grading use the same primary-face state.

## Project, Protocol, And UI

Project schema stores a `beauty` payload on clips:

```typescript
interface BeautyEffectParams {
  enabled: boolean;
  modelId: string; // ONNX manifest id
  modelVersion: string;
  preset: 'subtle' | 'custom';
  masterStrength: number;
  jawSlim: number;
  eyeEnlarge: number;
  noseWidth: number;
  mouth: number;
}
```

Phase 15 keyframes use keys such as `beauty.masterStrength` and
`beauty.jawSlim`; no new keyframe system is created. Bundle export/import writes
the params, keyframes, model id/version, and enabled/unloaded state in
`project.json`. It never writes OPFS model bytes, raw landmarks, or face images
into the bundle.

Protocol additions are structured-clone-safe:

```
UI -> Worker:
  load-beauty-model { manifestUrl, preferredExecutionProvider }
  set-beauty-effect { clipId, params }
  set-keyframe { clipId, key: 'beauty.*', t, value, easing }

Worker -> UI:
  beauty-model-status { phase, bytesLoaded, bytesTotal, executionProvider, cached }
  beauty-runtime-status { available, reason?, cadenceHz?, activeModel? }
```

`src/ui/Inspector.tsx` owns the Beauty section. It uses existing slider,
keyframe, reset, and capability status patterns; it does not receive media
objects, WebGPU handles, landmarks, or face images.

## Diagnostics

The Phase 25 diagnostics snapshot gains:

- `beauty.available`, unavailable reason, and selected ORT execution provider;
- model id/version, total model bytes, cached/not cached;
- detection cadence Hz and solved/skipped inference counts;
- average/p95 ORT inference time and warp pass time;
- primary-face confidence and handoff count, without coordinates.

Diagnostics must not include file names, image snippets, raw landmarks, or any
face-derived data that could reconstruct a person. Fixture-only developer tests
may log anonymized variance metrics.

## Testing Strategy

- **Unit (Vitest, mocked boundaries):** multi-asset ONNX manifest validation,
  digest-cache state machine with mocked OPFS streams, model download progress,
  detector output decoder contracts, landmark output decoder contracts,
  primary-face scoring, cadence scheduling, timestamp interpolation, one-euro
  filter response, confidence-loss identity ramp, param clamping, keyframe
  sampling, ProjectDoc/bundle round-trip, and protocol guards.
- **No-startup-load:** prove ORT runtime chunks and ONNX model files are not
  imported or fetched until explicit user action.
- **GPU/engine unit with mocks:** mesh-warp uniform packing, pass skip when
  effective strength is zero, command-submission accounting, bounded GPU
  resources, and close-exactly-once for detection/preprocess frames.
- **No large CI media fixtures:** tests use synthetic landmarks and small
  in-memory frame/handle mocks. The jitter acceptance fixture is manual or a
  small local-only asset documented outside normal CI.
- **Playwright only for UI-critical paths:** capability-gated Inspector
  controls, explicit Load model flow, progress/status display, keyframe button
  wiring, and reduced-tier messaging.
- **Manual GPU validation:** 1080p accelerated preview at chosen cadence, export
  parity, fixture-footage jitter bound, zero-strength identity export, model
  load from network then offline reload from OPFS cache.

## Third-party Additions

- **Runtime:** `onnxruntime-web` is allowed for this feature if not already
  available in the shared ORT platform. It is Microsoft-backed, actively
  developed, widely used for browser inference, and must be lazy-loaded only
  after explicit user action. The design accepts ORT's WebGPU ownership model
  only for compact preprocessed tensors; it must not force full-frame CPU
  readback.
- **Model assets:** ONNX FaceMesh/MediaPipe-derived detector and landmark
  candidates. The manifest must record model-card license compatibility and
  exact digest-pinned bytes before implementation.
- **Forbidden for this feature:** `@mediapipe/tasks-vision`, TFLite runtime
  dependencies, `.task` extraction/parsing libraries in the runtime bundle, and
  direct cross-origin model fetches.

## Validation

1. Load the model from a clean profile: UI shows exact total ONNX bytes, digest
   verification, selected ORT execution provider, and cached status.
2. Disconnect network and reload the PWA: the cached model loads from OPFS and
   the Beauty section remains available.
3. Apply `SUBTLE` to fixture footage: no visible landmark jitter; variance
   metrics stay within the documented bound.
4. Set master strength to `0` and export: output is bit-exact to the same export
   without the effect.
5. Preview 1080p footage on the accelerated tier: realtime playback holds at
   the selected cadence and diagnostics show inference/warp p95 values.
6. Import/export a Phase 23 bundle: beauty params, keyframes, and model id
   round-trip; model weights, face images, and raw landmarks are not embedded.
