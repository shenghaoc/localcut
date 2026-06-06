# Design: Phase 18 — Media Conformance + Adapter Boundary

> Status: **Implemented in PR** — worker-side media adapter boundary and conformance layer are implemented while keeping Mediabunny as the primary import/export path.

## Goal

Make imported media predictable before it reaches timeline playback or export. Phase 18 adds adapter-neutral source inspection, health warnings, and one shared source timestamp normalization path for preview and export. It does not replace Mediabunny, add a fallback demuxer to the hot path, or move media work onto the main thread.

## Ownership model

```
SolidJS UI
  receives serialized SourceDescriptorSnapshot / MediaAssetSnapshot / SourceHealthReport
      ↑ low-frequency protocol messages
Pipeline worker
  timeline + playback + export + WebGPU + media adapters
      ↓ lazy adapter open
MediabunnyAdapter
  BlobSource + Input + primary tracks + sample sinks
```

- `src/ui/` never imports `src/engine/media-adapters/*` and never sees media objects.
- `src/engine/media-adapters/` contains adapter contracts and concrete adapter implementations.
- `src/engine/media-io.ts` becomes the compatibility facade that existing callers use while the concrete Mediabunny work moves behind `MediabunnyAdapter`.
- The accelerated decode/render/export path still consumes `MediaInputHandle` and Mediabunny-backed sample sources.

## New modules

| Module | Responsibility |
|--------|----------------|
| `src/engine/media-adapters/types.ts` | `MediaAdapter`, `SourceInspection`, `SourceConformance`, `SourceHealthWarning`, `NormalizedSourceTiming` |
| `src/engine/media-adapters/mediabunny-adapter.ts` | Current `openMediaFile` logic wrapped as the primary adapter; Mediabunny-specific inspection and sinks |
| `src/engine/media-adapters/registry.ts` | Adapter selection; default Mediabunny-first ordering; feature-flagged diagnostics |
| `src/engine/media-adapters/source-timing.ts` | `resolveSourceTimestamp()` and duration/source-bound helpers shared by preview and export |
| `src/engine/media-adapters/source-health.ts` | Warning generation from inspection/conformance data |
| `src/engine/media-adapters/web-demuxer-adapter.ts` | Optional future scaffold only if added; disabled by default and diagnostics-only |

## Adapter contract

```typescript
export type MediaAdapterId = 'mediabunny' | 'web-demuxer-diagnostics';

export interface MediaAdapter {
  readonly id: MediaAdapterId;
  readonly role: 'primary' | 'diagnostic';
  canInspect(file: File): boolean;
  inspect(input: MediaAdapterOpenInput): Promise<MediaAdapterInspectionResult>;
  open?(input: MediaAdapterOpenInput): Promise<PrimaryMediaAdapterOpenResult>;
}

export interface MediaAdapterOpenInput {
  sourceId: string;
  file: File;
}

export interface MediaAdapterInspectionResult {
  inspection: SourceInspection;
  warnings: readonly SourceHealthWarning[];
}

export interface PrimaryMediaAdapterOpenResult extends MediaAdapterInspectionResult {
  handle: MediaInputHandle;
  conformance: SourceConformance;
}
```

`MediabunnyAdapter` is the only `primary` adapter in this phase. Diagnostic adapters, when enabled later, implement `inspect()` only; they can return comparison warnings but cannot return the `MediaInputHandle` used for playback/export.

## Inspection and conformance types

```typescript
export interface SourceInspection {
  sourceId: string;
  adapterId: MediaAdapterId;
  fileName: string;
  byteSize: number;
  mimeType: string | null;
  container: 'mp4' | 'mov' | 'webm' | 'mp3' | 'ogg' | 'wav' | 'image' | 'unknown';
  durationS: number | null;
  tracks: readonly SourceTrackInspection[];
}

export type SourceTrackInspection =
  | SourceVideoTrackInspection
  | SourceAudioTrackInspection;

export interface SourceVideoTrackInspection {
  kind: 'video';
  trackId: string;
  codec: string | null;
  canDecode: boolean;
  startS: number;
  durationS: number | null;
  codedWidth: number;
  codedHeight: number;
  displayWidth: number;
  displayHeight: number;
  frameRate: number | null;
  frameRateMode: 'constant' | 'variable' | 'unknown';
  rotationDeg: number;
  color: SourceColorHints;
}

export interface SourceColorHints {
  primaries: string | null;
  transfer: string | null;
  matrix: string | null;
  fullRange: boolean | null;
}

export interface SourceAudioTrackInspection {
  kind: 'audio';
  trackId: string;
  codec: string | null;
  canDecode: boolean;
  startS: number;
  durationS: number | null;
  sampleRate: number;
  channels: number;
}
```

`SourceConformance` is derived from inspection and is what the editor uses:

```typescript
export interface SourceConformance {
  sourceId: string;
  adapterId: MediaAdapterId;
  kind: MediaKind;
  primaryVideoTrackId?: string;
  primaryAudioTrackId?: string;
  durationS: number;
  timing: NormalizedSourceTiming;
  health: 'ok' | 'warnings' | 'blocked';
}
```

Existing `MediaMetadata` can be derived from `SourceInspection` during the migration. The persisted descriptor should carry the conformance subset needed for restore/relink, not raw adapter objects.

## Normalized timing

Source clips use normalized content seconds. `clip.inPoint = 0` means the first usable content instant selected by conformance, even when container packet timestamps begin at a non-zero value.

```typescript
export interface NormalizedSourceTiming {
  normalizedStartS: number;
  durationS: number;
  video?: NormalizedTrackTiming;
  audio?: NormalizedTrackTiming;
  avOffsetS: number;
  frameRateMode: 'constant' | 'variable' | 'unknown';
}

export interface NormalizedTrackTiming {
  trackId: string;
  firstTimestampS: number;
  lastTimestampS: number | null;
  durationS: number | null;
}

export interface SourceTimestampResolution {
  normalizedSourceS: number;
  adapterTimestampS: number;
  available: boolean;
  fill: 'none' | 'before-track-start' | 'after-track-end' | 'outside-source';
}
```

`resolveSourceTimestamp({ clip, timelineTime, trackKind, timing })` lives in `source-timing.ts` and is the only place that converts timeline source seconds to adapter timestamps. Preview video decode, audio mix windows, thumbnails that sample by source time, and export all use it. This prevents non-zero track starts and audio/video offsets from diverging between preview and export.

## MediaInputHandle evolution

Keep the existing fields so playback/export do not break, and add conformance fields beside them:

```typescript
export interface MediaInputHandle {
  sourceId: string;
  kind: MediaKind;
  adapterId: MediaAdapterId;
  metadata: MediaMetadata;
  inspection: SourceInspection;
  conformance: SourceConformance;
  timing: NormalizedSourceTiming;
  warnings: readonly SourceHealthWarning[];
  frameSource: VideoFrameProvider | null;
  audioSource: SequentialAudioSource | null;
  // existing displayWidth/displayHeight/frameRate/duration/thumbnailAt/dispose stay
}
```

The handle remains worker-only. `sourceDescriptorFromHandle()` serializes the safe subset into `SourceDescriptorSnapshot`; `assetSnapshotFromDescriptor()` serializes the UI subset into `MediaAssetSnapshot`. Old project documents that lack the new fields are upgraded with conservative defaults: start at zero, unknown frame-rate mode, rotation `0`, and no stored health warnings.

## Health warnings

```typescript
export type SourceHealthWarningCode =
  | 'variable-frame-rate'
  | 'non-zero-track-start'
  | 'audio-video-offset'
  | 'rotation-metadata'
  | 'mixed-audio-sample-rates'
  | 'unsupported-video-codec'
  | 'unsupported-audio-codec'
  | 'corrupt-or-truncated-file'
  | 'missing-duration'
  | 'undecodable-track';

export interface SourceHealthWarning {
  code: SourceHealthWarningCode;
  severity: 'info' | 'warning' | 'error';
  blocking: boolean;
  sourceId: string;
  trackId?: string;
  message: string;
  details: Record<string, string | number | boolean | null>;
}

export interface SourceHealthReport {
  sourceId: string;
  fileName: string;
  status: 'ok' | 'warnings' | 'blocked';
  warnings: readonly SourceHealthWarning[];
}
```

Warning generation is deterministic from `SourceInspection`, `SourceConformance`, and project/export context. Severity rules:

- `info`: notable but handled, such as rotation metadata that is applied.
- `warning`: usable but may affect fidelity, such as VFR or non-zero starts.
- `error`: source or stream cannot be used, such as corrupt file or unsupported primary codec.

Warnings are source-scoped and track-scoped where possible. The worker sends them through either `media-assets` payload extensions or a dedicated `import-health`/`source-health` message. UI text should name the real problem: "Video starts 0.42s after audio" is useful; "unsupported media" is not.

## Diagnostic adapters

The registry can later instantiate a `WebDemuxerAdapter` or MP4Box-backed adapter only when a feature flag such as `ENABLE_EXPERIMENTAL_MEDIA_DIAGNOSTICS` is true. In Phase 18 that adapter is diagnostics-only:

- It can inspect headers/track tables and produce comparison warnings.
- It cannot create `frameSource`, `audioSource`, thumbnail sources, export inputs, or mux outputs.
- It is not consulted from playback, frame cache, audio pump, or export loops.

If the diagnostic adapter disagrees with Mediabunny, the app reports a warning and continues with Mediabunny unless the Mediabunny import itself is blocked.

## Fixture matrix

Document the matrix under a small fixture plan file, for example `test/fixtures/media/README.md` or `src/engine/media-adapters/fixtures.md`.

| Fixture | Purpose |
|---------|---------|
| Small MP4 | Baseline import, trim, preview, export |
| Small MOV | QTFF/MOV metadata and track starts |
| Small WebM | Non-MP4 container path |
| VFR screen recording | VFR warning and timestamp mapping |
| Rotated phone footage | Rotation metadata and display dimensions |
| Mixed sample rates | Import warning and export guard |
| Audio-only | Audio descriptor and timeline placement |
| Still image | Existing still path survives adapter facade |
| Long 4K media | Lazy reads, no full-buffer import |
| Corrupt/truncated file | Blocking health report without worker crash |

Generated fixtures should be tiny where possible. Long/4K assets can be descriptor-only or optional manual fixtures if storing them would bloat the repo.

## Validation

- Unit tests for `resolveSourceTimestamp()` covering zero start, non-zero video start, non-zero audio start, A/V offset, trim in/out, range export, and out-of-bounds gaps.
- Unit tests for warning generation from mocked inspections.
- Unit tests for descriptor serialization/matching with timing, rotation, and audio metadata.
- Integration smoke on a small fixture subset: import → trim → preview → export.
- Regression tests for non-zero track start and mixed sample-rate export behavior.
- Quality gate: `npm run build` and `npm test` stay green; test count grows for the new pure logic.
