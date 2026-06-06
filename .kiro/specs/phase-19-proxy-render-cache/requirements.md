# Requirements: Phase 19 - Proxy Workflow + Render Cache

## R1 - Client-Side Proxy Generation

- **R1.1** Generate preview proxies entirely in the browser from user media using worker-owned media adapters and WebCodecs/WebGPU-capable paths where available; no server-side proxy generation, uploads, external APIs, telemetry, or cloud storage are allowed.
- **R1.2** Proxy generation runs off the main thread in a worker-owned job system. The SolidJS UI may request, pause, cancel, and inspect jobs, but it must not decode, encode, mux, scale, write cache files, or hold media adapter objects.
- **R1.3** Proxy candidates derive from Phase 18 `SourceInspection`, `SourceConformance`, source fingerprints, hardware throughput, and timeline usage: high-resolution sources, high-bitrate sources, heavy codecs, VFR media, or sources that repeatedly miss the preview budget.
- **R1.4** Proxy generation is opt-in or auto-suggested through an explicit project/user setting. Auto-suggested work must be visible, pausable, cancelable, and bounded.
- **R1.5** Proxies are preview derivatives only by default. Export uses original sources unless the user explicitly enables a proxy-export option for the export job.
- **R1.6** A proxy must carry enough conformance metadata to map proxy timestamps back to normalized source seconds without changing timeline semantics.

**Acceptance criteria:** enabling proxies on a large source creates a local preview derivative without uploading media or blocking the shell; the media bin and preview status clearly show when playback is using a proxy; starting export with default settings resolves originals, not proxies.

## R2 - Browser-Local Derivative Store

- **R2.1** Store proxy files, thumbnail bitmaps, filmstrip samples, waveform peaks, and render-cache chunks in OPFS through a cache abstraction, with an IndexedDB Blob store or equivalent browser-local fallback when OPFS is unavailable.
- **R2.2** Cache writes, metadata updates, compaction, and deletion run in a worker context. No cache file or blob writes happen on the main thread.
- **R2.3** Cache data is disposable. Losing OPFS/IndexedDB cache data must never corrupt the project document, timeline, source descriptors, relink metadata, or undo history.
- **R2.4** Project persistence may store cache manifest references and derivative status, but it must treat them as hints that can be missing, stale, or regenerated.
- **R2.5** Cache data must not include secrets, remote identifiers, uploaded URLs, or raw file names in paths where avoidable; user-facing names stay in serialized descriptors only.

**Acceptance criteria:** deleting the browser-local cache or having OPFS unavailable leaves the project editable and relinkable; derivatives show as missing/regenerating instead of corrupting project load.

## R3 - Proxy and Cache Data Types

- **R3.1** Define `ProxyAsset` as the worker-facing descriptor for one generated proxy, including source id, source fingerprint, conformance hash, proxy media format, dimensions, fps, bitrate, duration, byte size, cache path, status, created/last-used timestamps, and generation diagnostics.
- **R3.2** Define `ProxyManifest` as the cache-local manifest that maps source fingerprints to proxy assets and records schema version, cache version, project id, source conformance hash, generation settings, and category usage.
- **R3.3** Define `RenderCacheKey` as a canonical, stable key covering timeline range, frame rate, preview/export mode, source fingerprints, proxy/original source mode, effects, transforms, transitions, title texture hashes, LUT hashes, keyframes, output size, color/output settings, and cache schema version.
- **R3.4** Define `RenderCacheEntry` as the cache-local record for a rendered chunk, including key hash, timeline range, frame range, output descriptor, dependency summary, chunk path, byte size, status, created/last-used timestamps, and validation diagnostics.
- **R3.5** Define `CacheBudget` as the project/user budget policy for total bytes, per-category soft limits, minimum free-space reserve, warning threshold, eviction threshold, and protected active ranges.

**Acceptance criteria:** exported types are strict, readonly where practical, and contain no `any`; key serialization is deterministic across object insertion order and process restarts.

## R4 - Proxy Decode and Preview Routing

- **R4.1** Preview chooses proxies only when a valid proxy matches the source fingerprint and conformance hash for the requested normalized source range.
- **R4.2** Proxy preview must preserve edit timing: trim points, source offsets, VFR handling, rotation, and normalized timestamps still route through Phase 18 timestamp normalization.
- **R4.3** Proxy usage must be transparent and reversible: the user can disable proxy preview and immediately fall back to originals when hardware allows.
- **R4.4** Proxy decode may use lower resolution, reduced bitrate, or normalized fps only as a preview capability decision; it must not silently change project or export semantics.
- **R4.5** If a proxy becomes stale, missing, corrupt, or undecodable, preview falls back to original decode or a labeled limited preview state without crashing.

**Acceptance criteria:** preview and scrub use valid proxies when enabled; stale or missing proxies never produce wrong frames; turning proxies off returns to original-source preview.

## R5 - Render Cache Keying and Reuse

- **R5.1** Cache rendered chunks by canonical `RenderCacheKey`; a hit is valid only when every timeline, source, effect, transform, transition, title, LUT, keyframe, output-size, and source-mode dependency matches.
- **R5.2** Preview render cache and export render cache are separate modes. Export cache entries generated from proxies are usable only for explicit proxy export, never for default original-source export.
- **R5.3** Render cache chunks are produced by the same accelerated render path used for preview/export compositing. Do not introduce a second implementation of effects, transforms, transitions, titles, LUTs, or keyframe sampling.
- **R5.4** Render-cache reads and writes must not add CPU pixel readback to the premium hot path. Cache capture uses encoded video chunks, GPU-owned output frames, or browser-native transfer paths that preserve the no-`getImageData` rule.
- **R5.5** Cache entries include an engine/cache schema version so shader, color, title raster, LUT parser, or renderer changes can invalidate old chunks wholesale.

**Acceptance criteria:** a cache hit exactly matches the current render dependencies; changing output size or source mode produces a different key; default export cannot reuse proxy-derived chunks.

## R6 - Range Invalidation

- **R6.1** Maintain a dependency index from cache entries to timeline ranges, source ids, source fingerprints, clips, tracks, effects, transforms, transitions, titles, LUTs, keyframes, export settings, and preview settings.
- **R6.2** Timeline edits invalidate only affected ranges where possible: split/trim/move/delete invalidates old and new clip spans; track reorder invalidates overlapping composite spans; transition edits invalidate the transition window; title/LUT/keyframe/effect/transform edits invalidate the edited clip range.
- **R6.3** Source relink, source fingerprint changes, conformance changes, proxy regeneration with different settings, or media health changes invalidate all dependent proxy and render-cache entries.
- **R6.4** Unknown or complex edits may conservatively invalidate a larger range, but must never leave stale cache visible.
- **R6.5** Invalidation must be deterministic and unit-tested with overlapping clips, transitions, titles, LUTs, and keyframed parameters.

**Acceptance criteria:** editing a title invalidates only that title's affected timeline range; relinking a source invalidates all dependent ranges; no stale rendered frames survive effect/title/LUT/keyframe changes.

## R7 - Job Scheduling, Backpressure, and Priority

- **R7.1** Background proxy, thumbnail, filmstrip, waveform, and render-cache jobs run through bounded queues with cancellation tokens, per-job progress, and explicit idle/active scheduling.
- **R7.2** At most one video proxy encode job runs per worker/device by default; it must respect `VideoEncoder.encodeQueueSize`, bounded decoded-frame queues, and storage-writer backpressure before decoding more frames.
- **R7.3** Render-cache generation yields to interactive preview, active export, transport, and timeline edits. It must never spin in an unbounded background loop.
- **R7.4** Scheduling priority is: active timeline range, visible filmstrip range, user-requested selected sources, then background bin assets.
- **R7.5** Jobs must close every `VideoFrame`/`AudioData` exactly once and release encoder, decoder, muxer, GPU, and file handles on completion, cancellation, error, and eviction.

**Acceptance criteria:** generating proxies for several sources does not starve playback or the UI; pausing/canceling jobs stops new decode/encode work and releases owned frames.

## R8 - Budgeting, Eviction, and Cleanup

- **R8.1** Use `navigator.storage.estimate()` plus cache manifests to report total usage, per-category usage, quota, and warning state.
- **R8.2** Enforce `CacheBudget` with LRU-plus-priority eviction: protect active timeline ranges, active export chunks, and in-flight writes; evict stale, failed, old render chunks, old thumbnails/filmstrips, waveform peaks, then proxies unless the user has pinned them.
- **R8.3** Eviction closes/disposes in-memory bitmap/frame handles and deletes cache files/chunks atomically enough that interrupted cleanup leaves either a valid entry or no entry.
- **R8.4** Provide user actions to delete render cache, delete proxies for selected sources, delete all generated media, repair missing manifest entries, and reset budget.
- **R8.5** Storage pressure or eviction failure surfaces a bounded, actionable warning in the UI and never crashes the worker.

**Acceptance criteria:** budget eviction lowers cache usage below the target without touching project data; cleanup actions are visible, cancellable where long-running, and safe to repeat.

## R9 - UI Status and User Controls

- **R9.1** Media bin items show proxy state: not generated, recommended, queued, generating with progress, ready, stale, failed, or disabled.
- **R9.2** Timeline/preview chrome shows when preview is using original media, proxy media, render cache, or limited fallback, including preview resolution when a proxy is active.
- **R9.3** A storage/cache panel reports usage by proxies, render cache, thumbnails/filmstrips, waveform peaks, and other cache metadata, plus budget and cleanup actions.
- **R9.4** Export dialog keeps "use original sources" as the default and requires an explicit user choice to use proxies for export, with visible fidelity wording.
- **R9.5** Status text is persistent and specific. Use `role="alert"` only for blocking storage/capability states or failed user-requested actions.

**Acceptance criteria:** users can tell why preview is fast or degraded, how much storage derivatives consume, and whether export will use originals or proxies before starting.

## R10 - Tests and Performance Validation

- **R10.1** Unit-test cache-key canonicalization, hash stability, dependency capture, and schema-version invalidation.
- **R10.2** Unit-test range invalidation for edits to clips, tracks, effects, transforms, transitions, title hashes, LUT hashes, keyframes, source fingerprints, and output settings.
- **R10.3** Unit-test budget accounting, LRU/priority eviction, storage-pressure handling, manifest repair, and pinned proxy protection.
- **R10.4** Integration-test proxy preview with default original-source export and explicit proxy export.
- **R10.5** Integration-test deleting OPFS/IndexedDB cache while the project remains loadable, editable, relinkable, and able to regenerate derivatives.
- **R10.6** Add a performance test or reproducible manual benchmark proving a large source with proxy generation enabled does not block the main thread or sustained preview interaction.

**Acceptance criteria:** `npm run build` and `npm test` pass; test count increases for cache-key, invalidation, and eviction logic; the performance benchmark records main-thread responsiveness while proxy generation runs.
