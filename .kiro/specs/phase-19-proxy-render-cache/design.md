# Design: Phase 19 - Proxy Workflow + Render Cache

> Status: **Planned** - worker-owned proxy generation, disposable browser-local derivative storage, and dependency-keyed render-cache chunks for responsive preview on weaker machines.

## Goal

Keep preview responsive as later phases add multi-track compositing, transitions, titles, LUTs, keyframes, and heavier audio/video work. Phase 19 adds local preview proxies and a render cache without changing the product contract: media compute stays in the user's browser, the main thread stays interactive, the accelerated path avoids CPU pixel readback, and export uses originals by default.

## Ownership model

```
SolidJS UI
  requests jobs, renders status, shows storage controls
  receives serialized ProxyAssetSnapshot / CacheUsageSnapshot / RenderCacheStatus
      ^
      | low-frequency protocol messages only
      v
Pipeline worker
  authoritative timeline, preview/export renderer, render-cache keying, invalidation
  creates render-cache chunks through the existing accelerated frame renderer
      ^
      | cache RPC: open/write/read/delete metadata and chunks
      v
Proxy/cache worker
  OPFS/IndexedDB cache store, proxy encode jobs, derivative manifests,
  thumbnail/filmstrip/waveform persistence, budget eviction
```

- `src/ui/` never writes cache files and never sees `File`, `VideoFrame`, `AudioData`, WebGPU handles, Mediabunny objects, OPFS handles, or adapter objects.
- `src/engine/worker.ts` remains the owner of the live timeline and the exact render path. Render-cache generation calls the same compositing/effects/title/LUT/keyframe code used by preview/export.
- A new dedicated worker owns long-running proxy/cache storage jobs so background writes and proxy encodes do not block the pipeline worker's interactive loop. If a browser cannot run a separate worker with the required APIs, fall back to a cooperative cache mode inside the pipeline worker with the same queue limits and status reporting.
- Cache data is disposable. The project document stores original source descriptors and relink metadata as source of truth; cache manifests are hints.

## New modules

| Module | Responsibility |
|--------|----------------|
| `src/engine/cache-types.ts` | `ProxyAsset`, `ProxyManifest`, `RenderCacheKey`, `RenderCacheEntry`, `CacheBudget`, cache snapshots |
| `src/engine/cache-key.ts` | canonical serialization and hashing for render/proxy keys |
| `src/engine/cache-invalidation.ts` | dependency index and affected-range invalidation helpers |
| `src/engine/cache-budget.ts` | usage accounting, eviction ranking, storage-pressure decisions |
| `src/engine/proxy-jobs.ts` | proxy candidate selection, job planning, priority, backpressure policy |
| `src/engine/proxy-cache-worker.ts` | dedicated worker entry for OPFS/IndexedDB cache, proxy encode, manifest repair, cleanup |
| `src/engine/cache-store.ts` | worker-side RPC facade over OPFS primary and IndexedDB Blob fallback |
| `src/engine/render-cache.ts` | render-cache lookup/generation hooks that call the existing accelerated renderer |
| `src/ui/CachePanel.tsx` | storage usage, budget controls, cleanup actions |
| `src/ui/proxy-status.ts` | UI projection of worker proxy/cache status messages |

The dedicated worker may import pure media adapter modules from `src/engine/media-adapters/` and pure scheduling/cache helpers. It must not import SolidJS or UI modules.

## Phase 18 integration

Phase 18 provides the source identity and timing foundation:

- `SourceInspection` tells Phase 19 whether a source is large, high-bitrate, VFR, rotated, codec-heavy, or likely to miss the preview budget.
- `SourceConformance` and `NormalizedSourceTiming` keep proxy timestamps mapped to normalized content seconds.
- Source fingerprints and conformance metadata are part of both `ProxyAsset` validation and `RenderCacheKey` dependencies.
- Relink or conformance mismatch invalidates derivatives for that source because the old proxy/cache may represent a different file with the same name.

Do not recompute source identity in the UI. Proxy/cache workers receive the source descriptor and a worker-owned `File`/handle from the existing import/persistence path.

## Data model

```typescript
export type ProxyAssetStatus =
  | 'queued'
  | 'generating'
  | 'ready'
  | 'stale'
  | 'failed'
  | 'deleted';

export interface ProxyAsset {
  readonly proxyId: string;
  readonly sourceId: string;
  readonly sourceFingerprint: string;
  readonly sourceConformanceHash: string;
  readonly settingsHash: string;
  readonly status: ProxyAssetStatus;
  readonly container: 'mp4' | 'webm';
  readonly videoCodec: 'h264' | 'vp9' | 'av1';
  readonly audioCodec: 'aac' | 'opus' | 'none';
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly videoBitrate: number;
  readonly durationS: number;
  readonly byteSize: number;
  readonly cachePath: string;
  readonly createdAt: number;
  readonly lastUsedAt: number;
  readonly diagnostics: readonly CacheDiagnostic[];
}

export interface ProxyManifest {
  readonly schemaVersion: 1;
  readonly cacheVersion: string;
  readonly projectId: string;
  readonly generatedAt: number;
  readonly assetsBySourceFingerprint: Readonly<Record<string, readonly ProxyAsset[]>>;
  readonly usage: CacheUsageSnapshot;
}
```

`settingsHash` covers proxy target size, fps, codec, bitrate, color/output policy, and any future proxy preset. A proxy is valid only when `sourceFingerprint`, `sourceConformanceHash`, and `settingsHash` all match.

```typescript
export interface RenderCacheKey {
  readonly schemaVersion: 1;
  readonly rendererVersion: string;
  readonly mode: 'preview' | 'export';
  readonly sourceMode: 'original' | 'proxy';
  readonly timelineRange: TimeRange;
  readonly frameRate: number;
  readonly outputSize: { readonly width: number; readonly height: number };
  readonly colorPipelineHash: string;
  readonly layerGraphHash: string;
  readonly sourceFingerprints: readonly SourceDependencyKey[];
  readonly clipDependencies: readonly ClipDependencyKey[];
  readonly transitionHashes: readonly string[];
  readonly titleTextureHashes: readonly string[];
  readonly lutHashes: readonly string[];
  readonly keyframeHashes: readonly string[];
  readonly exportSettingsHash?: string;
  readonly previewSettingsHash?: string;
}

export interface RenderCacheEntry {
  readonly entryId: string;
  readonly keyHash: string;
  readonly key: RenderCacheKey;
  readonly timelineRange: TimeRange;
  readonly frameRange: { readonly startFrame: number; readonly frameCount: number };
  readonly output: RenderCacheOutputDescriptor;
  readonly dependencies: RenderCacheDependencySummary;
  readonly chunkPath: string;
  readonly byteSize: number;
  readonly status: 'writing' | 'ready' | 'stale' | 'failed' | 'deleted';
  readonly createdAt: number;
  readonly lastUsedAt: number;
  readonly diagnostics: readonly CacheDiagnostic[];
}
```

`sourceMode` is load-bearing. A preview chunk rendered from proxies is not valid for default export. A proxy-derived export entry is valid only when the user starts an export with explicit proxy export enabled.

```typescript
export interface CacheBudget {
  readonly maxBytes: number;
  readonly minFreeBytes: number;
  readonly warnAtBytes: number;
  readonly evictAtBytes: number;
  readonly categorySoftLimits: {
    readonly proxies: number;
    readonly renderChunks: number;
    readonly thumbnails: number;
    readonly filmstrips: number;
    readonly waveforms: number;
  };
  readonly protectedRanges: readonly TimeRange[];
  readonly pinnedProxyIds: readonly string[];
}
```

Budget accounting uses manifest metadata plus `navigator.storage.estimate()`. The manifest is not trusted blindly; repair scans cache directories when entries reference missing files or orphaned files remain.

## Cache store

`CacheStore` hides OPFS vs fallback:

```typescript
export interface CacheStore {
  readManifest(projectId: string): Promise<ProxyManifest | null>;
  writeManifest(manifest: ProxyManifest): Promise<void>;
  writeChunk(path: string, data: ReadableStream<Uint8Array> | Blob): Promise<CacheWriteResult>;
  readChunk(path: string): Promise<Blob | null>;
  deletePaths(paths: readonly string[]): Promise<CacheDeleteResult>;
  estimate(): Promise<CacheStorageEstimate>;
}
```

- OPFS is primary for large binary chunks and proxy files.
- IndexedDB Blob fallback is acceptable when OPFS is unavailable, but the UI must label large proxy/render-cache features as reduced if quota or performance is limited.
- Writes use temp paths followed by manifest commit. If a tab closes mid-write, repair deletes temp files and stale `writing` entries on the next startup.

## Proxy workflow

### Candidate selection

`planProxyCandidates()` runs from worker-owned descriptors:

- Recommend proxies for sources above configured resolution/bitrate thresholds, heavy codecs, VFR sources, or sources whose measured preview decode/render throughput falls below the project timeline fps.
- Prefer sources used in the active timeline over unused bin assets.
- Respect user setting: disabled, ask, automatic when recommended, or selected sources only.

### Generation path

```
source File/handle + Phase 18 conformance
  -> proxy/cache worker opens source through MediaAdapter
  -> decode bounded frames/audio windows
  -> scale/convert in worker path
  -> VideoEncoder/AudioEncoder with encodeQueueSize backpressure
  -> Mediabunny mux to OPFS/IndexedDB cache path
  -> ProxyManifest commit
```

Scaling should prefer browser-native paths that avoid CPU pixel readback. If a lower-tier proxy path must use Canvas2D or CPU conversion, it is a compatibility proxy path, runs off-main-thread, and is labeled separately. It must not be wired into the premium preview/export hot path.

Proxy generation keeps at most:

- 1 active video encode job by default.
- 3 to 5 decoded frames ahead of the encoder.
- 1 pending mux/storage write segment beyond the encoder drain point.
- A bounded audio window queue.

Before decoding another frame, check `VideoEncoder.encodeQueueSize` and the storage writer backlog. Cancellation closes queued frames and aborts encoder/muxer/file handles.

### Priority

1. Active timeline range around playhead and user-requested sources.
2. Visible filmstrip range in the current timeline viewport.
3. Selected media-bin assets.
4. Background media-bin assets.

Transport/playback, pointer editing, active export, and cache cleanup preempt background proxy work.

## Render cache

Render cache stores chunked rendered output for repeated preview/export ranges. Chunks should be small enough to invalidate surgically, such as 1 to 4 seconds or GOP-aligned spans, with chunk size configurable after profiling.

### Lookup

For a requested range:

1. Build a `RenderCacheKey` from the current resolved timeline graph and output settings.
2. Hash the canonical key.
3. Query the cache manifest/dependency index.
4. Use the chunk only when status is `ready`, file exists, key hash matches, and dependency summary still matches.
5. On miss, render from the normal renderer and optionally write a new chunk.

Preview cache and export cache have different `mode` values. Preview cache can be lower resolution and proxy-backed. Default export keys use `sourceMode: 'original'`.

### Generation

Render-cache generation happens in the pipeline worker because it must call the existing accelerated renderer:

```
resolve timeline range
  -> sample keyframes once per frame
  -> decode originals or proxies based on sourceMode
  -> compositeLayers / transitions / titles / LUTs through the existing renderer
  -> capture output frames/chunks without CPU pixel readback
  -> send encoded chunk stream to cache worker for storage
```

Do not re-implement effects or transitions in `export.ts` or the cache worker. Render cache is a wrapper around the renderer, not a second renderer.

## Canonical keying

`stableRenderCacheKey()` sorts object keys, dependency arrays, and id-based lists deterministically before hashing. Include:

- Timeline range and frame numbers.
- Timeline schema/version and renderer/cache schema.
- Output width/height, fps, preview/export mode, and export settings.
- `sourceMode` plus original fingerprints or proxy asset hashes.
- Clip ids, in/out points, source ids, track ids, z-order, track mute/solo/visibility state.
- Effect parameters, transform parameters, opacity, blend/composite state.
- Transition kind, duration, placement, params, and resolved window.
- Title `contentHash`/texture hash covering text and every style field.
- LUT file/content hash and LUT strength.
- Keyframe track hashes and sampled parameter version.
- Color pipeline settings and shader/f16 variant selection.

Unknown future render inputs must be represented in the key before they affect pixels. If not, bump `rendererVersion` and invalidate old entries.

## Invalidation

Maintain a dependency index:

```
sourceId -> entries
clipId -> entries + timeline ranges
trackId -> entries + ranges
transitionId -> entries + ranges
titleHash/lutHash/keyframeTrackId -> entries
output settings hash -> entries
```

Edit invalidation rules:

| Edit | Invalidation |
|------|--------------|
| Split/trim/delete clip | Old and new affected clip ranges |
| Move clip | Old span, new span, and overlapping composite spans |
| Track reorder/visibility/mute affecting video | Overlapping ranges on old and new z-order |
| Effect/transform/opacity edit | Edited clip range |
| Transition add/remove/edit | Transition window plus adjacent blend headroom |
| Title text/style edit | Title clip range keyed by new title texture hash |
| LUT import/change | Clip range using the LUT |
| Keyframe add/move/delete | Affected parameter range; full clip if range cannot be narrowed |
| Source relink/fingerprint/conformance change | All dependent proxies and render entries |
| Export/preview output change | Key miss by settings hash; optional cleanup of old chunks |

When the edit shape is ambiguous, invalidate the whole timeline or whole source dependency set. It is acceptable to throw away good cache; it is not acceptable to show stale rendered frames.

## UI

- Media bin: proxy state badge, recommended reason, progress, failure detail, "Generate proxy", "Delete proxy", and "Pin proxy" actions.
- Preview/status bar: "Original", "Proxy 720p", "Render cache", or "Limited preview" state. Include preview resolution when proxy/cache is active.
- Timeline: cache warm/miss status can be subtle, but active background work should not distract from editing.
- Cache panel: usage by category, quota estimate, budget setting, pinned proxies, and cleanup actions.
- Export dialog: default is original-source export. Proxy export is an explicit checkbox or segmented option with visible fidelity wording and disabled state when required proxies are stale/missing.

Accessibility follows steering: native buttons/inputs, keyboard-reachable cleanup actions, persistent visible status, and `role="alert"` only for blocking failures such as quota exhaustion during a user-requested job.

## Failure handling

- Missing cache manifest: rebuild empty manifest and mark derivatives as not generated.
- Missing chunk/proxy file: mark entry deleted/stale and regenerate on demand.
- Corrupt proxy: mark failed, fall back to original preview, and offer regenerate.
- Quota exceeded: pause background jobs, run eviction, then resume only if under budget.
- OPFS unavailable: use IndexedDB fallback or disable large-cache features with a limited local-cache status.
- Worker crash/restart: incomplete `writing` entries are cleaned on startup; project remains loadable.

## Validation

- Unit tests: stable key hashing, dependency capture, invalidation ranges, budget eviction, manifest repair.
- Integration: proxy preview with default original export; explicit proxy export; delete cache and continue editing/regenerate.
- Performance: large-source proxy generation keeps main-thread interaction responsive, with no sustained main-thread long tasks attributable to media/cache work.
- Quality gate: `npm run build` and `npm test` green; no test count regression.
