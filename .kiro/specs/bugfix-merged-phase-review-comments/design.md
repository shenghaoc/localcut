# Design: Bugfix — merged-phase review-comment fix-up

> Status: **In review** (PR #112).

This document spells out the concrete change for each bug in `bugfix.md`. Bugs
are grouped by file when they share an edit context so the design reflects
how the fix actually lands.

## D1 — Phase 38 film-look pipeline correctness

### D1.1 `src/engine/effects.ts` — `encodeFilmLooks` ping-pong start (B1)

```ts
const slots = [storage.a, storage.b, storage.c];
let currentSrc = srcView;
const srcSlotIdx =
  currentSrc === storage.a ? 0 :
  currentSrc === storage.b ? 1 :
  currentSrc === storage.c ? 2 : -1;
let bufIdx = srcSlotIdx >= 0 ? (srcSlotIdx + 1) % 3 : 0;
```

The loop body then reads `slots[bufIdx]` for `currentDst` and advances `bufIdx`
by 1 mod 3 per pass — same rotation as before, just starting at the slot
after `currentSrc`. External / non-storage srcViews fall through to `bufIdx
= 0` (`storage.a`), which never collides because the accumulator and
external views are separate textures.

### D1.2 f16 look shaders — vector constructors (B2)

In `grain.f16.wgsl`, `halation.f16.wgsl`, `vignette.f16.wgsl`: replace every
`f16(colour.rgb)` (and `f16(1.0) - f16(colour.rgb)` etc.) with
`vec3<f16>(colour.rgb)`. Lift the `vec3<f16>(colour.rgb)` into a local where
it's used more than once. Match the pattern from
`brightness-contrast.f16.wgsl`. The halation f16 also uses a separate
`brightPass(vec3<f16>, f16)` helper that does luminance + smoothstep in f16,
so the dot product stays in the half-precision domain.

### D1.3 `src/engine/shaders/halation.wgsl` + `halation.f16.wgsl` — radius blur (B3)

Change `radius: i32` to `radius: f32` in both struct decls. The JS already
packs `halationRadius` as a `Float32` (`packEffectUniform` uses a
`Float32Array`), so this aligns the bit interpretation.

Inside `main`, add a 16-tap golden-spiral sampling pattern scaled by the
radius:

```wgsl
let radius = max(u.radius, 1.0);
let sigma2 = max(radius * radius * 0.5, 1.0);
let maxXY = vec2i(i32(dims.x) - 1, i32(dims.y) - 1);
let center = vec2i(gid.xy);
var halo = brightPass(colour.rgb, u.threshold);
var totalWeight = 1.0;
for (var i: u32 = 0u; i < 16u; i = i + 1u) {
  let t = (f32(i) + 0.5) / 16.0;
  let angle = f32(i) * 2.39996323; // golden angle
  let r = radius * sqrt(t);        // even-area distribution
  let offset = vec2f(cos(angle), sin(angle)) * r;
  let coord = clamp(center + vec2i(round(offset)), vec2i(0), maxXY);
  let sample = textureLoad(src, coord, 0);
  let weight = exp(-(r * r) / sigma2);
  halo += brightPass(sample.rgb, u.threshold) * weight;
  totalWeight += weight;
}
halo = halo / totalWeight;
let glow = halo * vec3f(u.tintR, u.tintG, u.tintB);
let result = 1.0 - (1.0 - colour.rgb) * (1.0 - glow);
textureStore(dst, gid.xy, vec4f(result, colour.a));
```

This is single-pass; a future separable-blur upgrade would split into a
two-pass effect using the existing ping-pong slots. Out of scope for this
fix-up.

### D1.4 `src/engine/gpu.ts` + `effects.ts` — grain seed from timeline time (B4)

Add a `renderTimeS = 0` default parameter to `PreviewRenderer.present` and
`compositeLayers`:

```ts
present(layers: readonly CompositeLayer[], renderTimeS = 0): void { ... }
private compositeLayers(encoder, layers, renderTimeS = 0): GPUTextureView { ... }
```

Inside `processLayer`, call:

```ts
filmView = this.effectChain.encodeFilmLooks(encoder, stageView, storage,
  this.width, this.height, layer.effects, slot, renderTimeS);
```

instead of computing `frameTimeSeed = layer.frame.timestamp / 1e6`.

Callers:

- `worker.ts:5113`: `renderer.present(stack, timestamp)` — `timestamp` is the
  timeline time in seconds, the same parameter `PlaybackController` already
  passes to `renderFrames`.
- `gpu.ts renderLayeredForExport`: add an optional `renderTimeS = timestamp`
  parameter so existing callers default to output time. `export.ts:1132` is
  updated to pass `timelineTime` explicitly (which is `plan.rangeStartS +
  outputTimestamp`) — that keeps grain stable across in/out range edits of
  the same project.

## D2 — Phase 38 Lottie + animated-image hardening

### D2.1 Adapter — `ImageDecoder.isTypeSupported` + init (B7, B9)

In `mediabunny-adapter.ts openImageFile`:

```ts
const imageDecoderSupportsType =
  typeof ImageDecoder !== 'undefined' &&
  typeof ImageDecoder.isTypeSupported === 'function' &&
  (await ImageDecoder.isTypeSupported(mimeType).catch(() => false));
const isAnimated = ANIMATED_IMAGE_MIME_TYPES.has(mimeType) &&
  imageDecoder === 'supported' && imageDecoderSupportsType;
```

When `isAnimated`, `await animatedSource.ensureInitialized()` before reading
`effectiveFps` on the handle. `ensureInitialized` is made public on
`AnimatedImageFrameSource`.

### D2.2 Variable per-frame durations (B8)

In `animated-image-source.ts`, replace the "seed every entry with the first
duration" loop with a real per-frame decode:

```ts
const durations: number[] = new Array(this.frameCount);
durations[0] = toDurationSeconds(firstResult.image.duration);
firstResult.image.close();
for (let i = 1; i < this.frameCount; i++) {
  try {
    const result = await this.decoder.decode({ frameIndex: i });
    durations[i] = toDurationSeconds(result.image.duration);
    result.image.close();
  } catch {
    durations[i] = durations[i - 1] ?? 0.033;
  }
}
```

Helper `toDurationSeconds(durationMicros: number | null | undefined): number`
returns `durationMicros / 1_000_000` when truthy, else `0.033` (30 fps
fallback). Each frame image is closed immediately — no buffering.

### D2.3 Static-fallback warning (B10)

`src/protocol.ts`: extend the warning code union with
`'animated-image-static-fallback'`.

In `mediabunny-adapter.ts openImageFile` static branch:

```ts
const warnings: SourceHealthWarning[] = ANIMATED_IMAGE_MIME_TYPES.has(mimeType)
  ? [
      ...baseWarnings,
      {
        code: 'animated-image-static-fallback',
        severity: 'info',
        blocking: false,
        sourceId,
        message: `${file.name}: animated frames are unavailable in this browser; importing as a static still.`,
        details: { mimeType }
      }
    ]
  : [...baseWarnings];
```

Severity `info` so the import isn't gated; the existing UI surfaces it
through the source-health pipeline.

### D2.4 `.lottie` zip — structured `BlockedImportError` (B6)

New export from `media-adapters/types.ts`:

```ts
export class BlockedImportError extends Error {
  readonly warnings: readonly SourceHealthWarning[];
  readonly inspection: SourceInspection;
  readonly conformance: SourceConformance;
  constructor(message: string, details: { warnings; inspection; conformance }) {
    super(message);
    this.name = 'BlockedImportError';
    /* ... */
  }
}
```

`mediabunny-adapter.ts` `.lottie` branch throws this instead of returning
`{ handle: null as unknown as MediaInputHandle, ... }`.

`worker.ts` import catch:

```ts
if (e instanceof BlockedImportError) {
  postSourceHealth({
    sourceId: e.inspection.sourceId,
    fileName: e.inspection.fileName,
    status: 'blocked',
    warnings: e.warnings
  });
}
```

The existing `recordRecentError` + UI toast continue to fire as before.

### D2.5 Lottie clip duration (B11)

In `worker.ts placeAsset`:

```ts
const isAnimatedImage =
  handle.kind === 'image' && handle.duration > 0 && handle.duration < STILL_MAX_DURATION_S;
const clipDuration = handle.kind === 'image' && !isAnimatedImage
  ? STILL_DEFAULT_DURATION_S
  : handle.duration;
```

Still images report `duration === STILL_MAX_DURATION_S` (the sentinel that
lets the user trim freely). Animated content reports its real length. The
heuristic distinguishes them without a new field on the handle.

`STILL_MAX_DURATION_S` is re-exported from `media-io.ts`.

### D2.6 Import UI surfaces (B5)

`src/ui/App.tsx`:

```ts
const VIDEO_ACCEPT =
  '...,application/json,...,.json';
const VIDEO_PICKER_TYPES = [{
  description: 'Media files',
  accept: { /* ... */, 'application/json': ['.json'] }
}];
const MEDIA_FILE_PATTERN = /\.(mp4|mov|webm|png|jpe?g|webp|gif|bmp|avif|mp3|m4a|wav|ogg|json)$/i;
function isImportableFile(file) {
  return file.type.startsWith('video/') ||
         file.type.startsWith('image/') ||
         file.type.startsWith('audio/') ||
         file.type === 'application/json' ||
         MEDIA_FILE_PATTERN.test(file.name);
}
```

The mediabunny adapter already sniffs the first 512 bytes of any JSON for
the Lottie schema (`"v":` and `"layers"`); non-Lottie JSON falls through
to a generic import-rejected error.

## D3 — Phase 38 look preset atomicity (B12)

`worker.ts handleImportLookPreset`:

```ts
let lut: ClipLut | null = null;
if (cmd.lutFile) {
  if (!renderer) {
    post({
      type: 'look-preset-error',
      clipId: cmd.clipId,
      reason: 'LUT import requires the accelerated WebGPU renderer.'
    });
    return;
  }
  try {
    lut = await clipLutFromCubeFile(cmd.lutFile);
  } catch (error) {
    post({
      type: 'look-preset-error',
      clipId: cmd.clipId,
      reason: `Could not import LUT: ${errorMessage(error)}`
    });
    return;
  }
}
```

Then `commitTimelineMutation` applies preset params + LUT in one transaction,
matching the existing single-mutation history entry.

## D4 — Phase 21 source-normalize colour metadata (B13)

`src/engine/gpu.ts`:

- Add `colorMetadata?: ColorMetadata` to `FrameCompositeLayer`.
- In `encodeSourceNormalize`:
  ```ts
  const inverseTransfer =
    layer.colorMetadata && layer.colorMetadata.transfer !== 'unknown'
      ? selectNormalizeTransfer(layer.colorMetadata.transfer)
      : NormalizeTransfer.SRGB;
  const fullRange = layer.colorMetadata
    ? (layer.colorMetadata.fullRange ? 1 : 0)
    : 1;
  this.device.queue.writeBuffer(buffer, 0, new Uint32Array([inverseTransfer, fullRange]));
  ```
  `unknown` transfer falls back to sRGB (matches existing behaviour) rather
  than `IDENTITY` (which would treat the source as already-linear).

`src/engine/worker.ts`:

- Add `colorMetadata?: ColorMetadata` to `LayerMeta.frame`.
- New helper `colorMetadataForSource(sourceId)` reads
  `sourceDescriptors.get(...)?.video?.color` and runs `colorMetadataFromHints`.
- `makeGetLayers` populates `colorMetadata` on the decoded layer.
- The `renderFrames` callback forwards `layer.meta.colorMetadata` into the
  pushed `CompositeLayer`.

`src/engine/export.ts`:

- In the per-frame loop, look up the video track inspection and call
  `colorMetadataFromHints(videoTrack.color)` once per frame layer push.

## D5 — Phase 21 `~luma` comment (B14)

`shaders/scopes.wgsl:63-66`: replace the "`~luma`" comment with
"tracks the darkest (minimum quantized luma) in the column" / "tracks the
brightest (maximum quantized luma)" — the implementation is correct, the
comment was misleading.

The dispatch-stub docstring update originally planned here is dropped:
PR #111 landed the real scope compute dispatch (storage-buffer alloc,
two compute pipelines, staging-buffer readback, seqlock-guarded SAB writes)
on main before this fix-up rebased, so there's no stub left to document.

## D6 — Phase 13 transitions (B15, B16, B17)

`src/engine/timeline.ts`:

- `sourceTailHandle`:
  ```ts
  if (sourceDuration === undefined || !finite(sourceDuration))
    return Number.POSITIVE_INFINITY;
  ```
- `transitionBoundary`: drop `sortByStart`; use `track.clips` directly. A
  comment explains the invariant.

`src/engine/timeline.test.ts`:

- Import `removeTransition`, `setTransition`.
- New `describe('removeTransition')` with two tests: id-filters target,
  returns same reference on no-op.
- New `describe('setTransition')` with three tests: partial patch + clamp,
  zero-clamp removes, no-op reference equality.

## D7 — Phase 6 export documentation (B18)

`src/engine/export.ts:1187` inline comment:

```ts
// Ownership: VideoSample is documented in mediabunny.d.ts as a
// "near zero-cost wrapper" around the VideoFrame and `sample.close()`
// "releases held resources" — i.e. the wrapper takes ownership of
// exportFrame and disposes it during close. On construction failure
// the frame is still ours, so we close it explicitly below.
sample = new VideoSample(exportFrame, { timestamp: outputTimestamp, duration });
```

And before the `videoSource.add`:

```ts
// sample.close() releases the wrapped VideoFrame; do NOT also call
// exportFrame.close() here or VideoFrame.close() will throw
// InvalidStateError on double-close.
```

## D8 — Phase 22 caption-only export gate (B19)

`worker.ts exportSettingsForProbe`:

```ts
const hasBurnedInCaptions = captionTracks.some(
  (track) => track.burnedIn && track.visible && track.segments.length > 0
);
if (!videoHandle && titleClips().length === 0 && !hasBurnedInCaptions) return null;
```

Mirrors the existing `setupPlayback` gate.

## D9 — Phase 20 overwrite linked-pair guard (B20)

`worker.ts handleOverwriteEdit`:

Before `commitTimelineMutation`, walk the incoming clip set, compute the
affected timeline region per targeted track, and check each existing
linked clip in that region. If any linked partner is on a non-targeted
track, call `postProjectWarning(...)` and return without mutating.

```ts
const targetSet = new Set(targetTrackIds);
const incomingByTrack = new Map<string, number>();
for (const item of cmd.clips) { /* track max duration per trackId */ }
for (const [trackId, dur] of incomingByTrack) {
  if (!targetSet.has(trackId)) continue;
  const track = timeline.find((t) => t.id === trackId);
  if (!track) continue;
  const regionStart = cmd.atTime;
  const regionEnd = cmd.atTime + dur;
  for (const existing of track.clips) {
    if (existing.start + existing.duration <= regionStart) continue;
    if (existing.start >= regionEnd) continue;
    if (!existing.linkedGroupId) continue;
    const linked = expandLinkedGroup(timeline, [{ trackId, clipId: existing.id }]);
    for (const ref of linked) {
      if (ref.trackId === trackId) continue;
      if (!targetSet.has(ref.trackId)) {
        postProjectWarning(`Overwrite would trim "${existing.id}" but its linked partner is on an untargeted track. Add that track to the edit targets, or unlink the pair, before retrying.`);
        return;
      }
    }
  }
}
```

## D10 — Phase 32a Inspector skin-smoothing (B21, B22, B23)

`src/ui/Inspector.tsx`:

- Import `on` from `solid-js`.
- After `const [skinSmoothBypass, setSkinSmoothBypass] = createSignal(false)`,
  add:
  ```ts
  createEffect(on(
    () => props.selectedClip?.clipId,
    () => setSkinSmoothBypass(false),
    { defer: true }
  ));
  ```
- New optional prop `previewTierSupportsSkinSmooth?: boolean`. The strength
  slider's `disabled` attribute = `props.previewTierSupportsSkinSmooth === false`.
  When false, a `<Show>`-guarded `<p class="skin-smooth-tier-note">`
  explains the gating in human terms.
- Replace inline `currentSkinMask()` reads in flush/schedule paths with
  `getSkinMaskDraft()` that returns a per-clipId draft reset on selection
  change. The flushed payload is built from the draft, not from
  `currentSkinMask()`.

## D11 — Phase 23 bundle-replace modal (B24)

`src/ui/App.tsx`:

- New `[bundleReplacePrompt, setBundleReplacePrompt]` signal holding
  `{ jobId, message } | null`.
- The `'bundle-replace-prompt'` worker message routes to
  `setBundleReplacePrompt(...)` instead of `window.confirm`.
- JSX: a `<Show when={bundleReplacePrompt()}>` block renders a
  `role="dialog" aria-modal="true"` modal with Cancel and Replace buttons.
  Each button sends `{ type: 'bundle-replace-decision', jobId, action }`
  and clears the signal.

`src/global.css`: append the modal-backdrop / dialog styles using the
existing CSS-var tokens.

## D12 — Phase 24 queue picker activation handling (B25)

`src/protocol.ts`: add `{ type: 'queue-pause' }` to the worker command
union.

`src/ui/App.tsx handleQueueJobDestination`:

```ts
} catch (error) {
  if (error instanceof DOMException && error.name === 'SecurityError') {
    setStatusLine('Queue paused: pre-select all output files via Run Queue before starting (job activation expired).');
    bridge?.send({ type: 'queue-job-skip', jobId });
    bridge?.send({ type: 'queue-pause' });
    return;
  }
  bridge?.send({ type: 'queue-job-skip', jobId });
}
```

`src/engine/worker.ts`: route `'queue-pause'` to `handleQueueCancelAll()`
(stops further job pumps; existing handler does the right cleanup).

## D13 — Phase 25 diagnostic-snapshot named consts (B26)

`src/ui/diagnostic-snapshot.ts`: extract each `finding(...)` call into a
named local (`isolationFinding`, `sabFinding`, `webgpuFinding`,
`webcodecsFinding`). The return object references `sabFinding` by name. The
`findings` array is composed from the four named consts.

## D14 — Phase 40 language tools (B27, B28, B29)

`src/ui/language-tools/translation-controller.ts`:

- `detect(...).catch(() => { sessionLost = true; return []; })`.
- After `Promise.all`, `if (sessionLost) this.detector = null;`.
- New `onTranslatedTrackError(reason, message)` method that calls
  `updateJob({ phase: 'error', error: message })` if a job is active and
  forwards to `this.ports.onTranslatedTrackError?.(...)`.
- New optional `onTranslatedTrackError` port on
  `TranslationControllerPorts`.

`src/protocol.ts`: add the new outbound message:

```ts
| {
    type: 'translated-caption-track-error';
    reason: 'empty-segments' | 'malformed-segments';
    message: string;
  }
```

`src/engine/worker.ts handleAddTranslatedCaptionTrack`: replace the two
"post success with empty trackId" branches with `'translated-caption-track-error'`
+ a descriptive message.

`src/ui/App.tsx`: handle the new message:

```ts
case 'translated-caption-track-error':
  translationController.onTranslatedTrackError?.(msg.reason, msg.message);
  setRuntimeIssue(msg.message);
  break;
```

`src/ui/LanguageToolsPanel.tsx`: replace the bogus comment with
`// eslint-disable-next-line no-unassigned-vars`.

## D15 — Phase 47 spec corrections (B30, B31, B32)

`.kiro/specs/phase-47-whip-publish/requirements.md` R1.1: append the
missing-`Location`-on-201 case as a non-retryable protocol error.

R1.6: specify the 10-second default and the `WhipSessionDeps.gatherTimeoutMs`
override, with rationale.

`.kiro/specs/phase-47-whip-publish/tasks.md` T10.2: describe the
`HTMLCanvasElement.captureStream` + `MediaStreamAudioDestinationNode`
synthetic-feed pattern.

## D16 — In-app guide content (B33)

New `src/features/docs/content/look-packs.md` and
`src/features/docs/content/animated-overlays.md` mirroring the
`docs/USER-GUIDE.md` sections, but written for in-app reading (no external
markdown comparisons, no PR-link footers).

`src/features/docs/docsManifest.ts`: import both raw markdowns and register
them in `DOC_SECTIONS` between "frame-interpolation" and "language-tools".

## D17 — `build-wasm.mjs` base64 wrapping (B34)

`scripts/build-wasm.mjs`:

```js
const wrapped = lines.join('" +\n\t"');
```

Adjacent string literals concatenate at parse time, so the bundled
constant has the same byte content as before; only the source layout changes.

## Out-of-scope follow-ups

- **Phase 21 source-normalize gamut matrix** — wired transfer + range only;
  matrix mult remains identity. Documented in-shader.
- (Phase 21 scope compute dispatch — shipped on main as PR #111 before this
  fix-up rebased; no longer a follow-up.)
- **OTIO `timeRemap` import round-trip** — OTIO is export-only today; deferred
  until import lands.
- **Litert-coupled findings** — Phase 71 remap PCM extraction and any other
  finding under ASR / Audio Cleanup / matting engines defer to the ONNX
  migration.
