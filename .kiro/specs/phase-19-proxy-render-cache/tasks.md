# Tasks: Phase 19 - Proxy Workflow + Render Cache

> Status: **Planned**. Keep tasks small and landable; each implementation slice should preserve the project source-of-truth rule and keep media/cache work off the main thread.

## Cache foundations

- [ ] **T1.1** Add `src/engine/cache-types.ts` defining `ProxyAsset`, `ProxyManifest`, `RenderCacheKey`, `RenderCacheEntry`, `CacheBudget`, `CacheUsageSnapshot`, `TimeRange`, `RenderCacheOutputDescriptor`, `RenderCacheDependencySummary`, `CacheDiagnostic`, `SourceDependencyKey`, `ClipDependencyKey`, and cache diagnostic/status unions.
  - Acceptance: exported types are strict, readonly where practical, contain no `any`, and encode proxy/original source mode explicitly.
- [ ] **T1.2** Add `src/engine/cache-key.ts` with canonical serialization and hashing helpers for `RenderCacheKey` and proxy settings.
  - Acceptance: tests prove stable hashes across object insertion order, array ordering rules, schema-version changes, output-size changes, and proxy/original source-mode changes.
- [ ] **T1.3** Add `src/engine/cache-store.ts` with a worker-only `CacheStore` interface and OPFS primary implementation.
  - Acceptance: all file/blob writes happen through the worker-facing store; no OPFS handles or cache blobs cross into `src/ui/`; cache paths are generated from opaque ids/hashes and sanitized before writing, not raw media file names or remote identifiers; OPFS chunk writes stream once to opaque final paths without readback or double-write, and manifest commit plus repair remains the readiness gate.
- [ ] **T1.4** Add an IndexedDB Blob fallback behind the same `CacheStore` interface.
  - Acceptance: fallback is feature-detected by actively calling `navigator.storage.getDirectory()` when present and catching `SecurityError`/`DOMException` failures before falling back; fallback is labeled as reduced for large caches and covered by manifest read/write tests with a mocked store; delete results distinguish actually deleted paths from missing keys.
- [ ] **T1.5** Add manifest startup repair for missing files, orphaned files, and stale `writing` entries.
  - Acceptance: tests load damaged manifests and end with either valid ready entries or deleted/missing entries, never half-ready cache records.

## Dedicated proxy/cache worker

- [ ] **T2.1** Add `src/engine/proxy-cache-worker.ts` and a typed RPC bridge between the pipeline worker and cache worker.
  - Acceptance: the UI talks only to the pipeline worker; cache worker messages are structured-clone-safe and contain no UI-only types.
- [ ] **T2.2** Move cache manifest reads/writes, chunk writes, chunk deletes, cache estimates, and cleanup operations into the cache worker.
  - Acceptance: static search finds no cache write APIs in `src/ui/`; tests cover successful write, failed write, cancellation cleanup, and cache-worker descriptors/write paths for proxy files, render chunks, thumbnail bitmaps, filmstrip samples, and waveform peaks.
- [ ] **T2.3** Add job lifecycle state: queued, running, paused, canceled, complete, failed.
  - Acceptance: jobs expose progress and cancellation tokens; cancel stops new decode/encode/storage work.
- [ ] **T2.4** Add scheduler priority buckets for active timeline range, visible filmstrip range, selected sources, and background bin assets.
  - Acceptance: unit tests prove higher-priority jobs run before lower-priority jobs and playback/export preemption pauses background work.
- [ ] **T2.5** Add bounded worker status messages for proxy/cache state.
  - Acceptance: messages are low-frequency, coalesced, and do not include raw media bytes, file handles, or unbounded diagnostics.

## Proxy generation

- [ ] **T3.1** Add `src/engine/proxy-jobs.ts` with `planProxyCandidates()` using Phase 18 `SourceInspection`, `SourceConformance`, source fingerprints, and hardware throughput.
  - Acceptance: tests recommend proxies for large/heavy/VFR/slow sources and do not recommend proxies for small sources under budget; ask-mode recommendations are marked as requiring user confirmation before scheduling.
- [ ] **T3.2** Add proxy settings selection and support probing for local preview codecs/containers.
  - Acceptance: unsupported encoder/container combinations are not scheduled; the chosen proxy format is recorded in `ProxyAsset`.
- [ ] **T3.3** Implement the proxy decode -> scale -> encode -> mux path in the proxy/cache worker using worker-owned media adapters.
  - Acceptance: no media processing runs on main; every decoded `VideoFrame`/`AudioData` is closed exactly once; mux output is written to cache store.
- [ ] **T3.4** Add encode and storage backpressure to proxy jobs.
  - Acceptance: before decoding more frames, jobs honor `VideoEncoder.encodeQueueSize`, decoded-frame queue limits, and storage-writer backlog; pending drain promises are resumed from the encoder `output` callback when `encodeQueueSize` falls below the threshold.
- [ ] **T3.5** Persist ready proxies into `ProxyManifest` and mark stale proxies when source fingerprint, source conformance hash, or settings hash changes.
  - Acceptance: tests cover valid proxy reuse, stale detection, failed generation, and regeneration after settings change.
- [ ] **T3.6** Add pause, cancel, retry, delete, and pin proxy operations.
  - Acceptance: canceled jobs release resources; pinned proxies are protected from ordinary eviction; delete removes manifest entries and cache files safely.

## Preview routing

- [ ] **T4.1** Extend worker source descriptors with proxy availability snapshots derived from `ProxyManifest`.
  - Acceptance: descriptors remain serializable and old project documents load without proxy fields.
- [ ] **T4.2** Add source selection logic for preview decode: original vs valid proxy.
  - Acceptance: proxy selection requires matching source fingerprint, conformance hash, settings hash, and normalized source range.
- [ ] **T4.3** Route proxy preview through the Phase 18 timestamp normalization path.
  - Acceptance: trim points, non-zero track starts, VFR handling, and rotation metadata resolve consistently between proxy preview and original preview.
- [ ] **T4.4** Add fallback when a proxy is missing, stale, corrupt, or undecodable.
  - Acceptance: preview falls back to original decode or a labeled limited state; stale proxy frames are never displayed as current.
- [ ] **T4.5** Add tests for proxy preview routing and fallback.
  - Acceptance: tests prove a stale proxy is rejected and a valid proxy does not change timeline source seconds.

## Render cache keying and lookup

- [ ] **T5.1** Add `src/engine/render-cache.ts` with lookup and miss-recording hooks around the existing preview/export renderer.
  - Acceptance: cache lookup is optional and disabled on unsupported storage without changing rendering output.
- [ ] **T5.2** Build `RenderCacheKey` from resolved timeline dependencies.
  - Acceptance: key includes timeline range, fps, output size, mode, source mode, source fingerprints/proxy hashes, effects, transforms, transitions, title texture hashes, LUT hashes, keyframes, color settings, and renderer/cache versions.
- [ ] **T5.3** Keep preview and export cache modes separate.
  - Acceptance: tests prove proxy-backed preview chunks cannot satisfy default original-source export keys.
- [ ] **T5.4** Add render-cache entry validation before use.
  - Acceptance: a hit requires ready status, existing chunk file, matching key hash, full canonical key comparison, and compatible output descriptor; dependency summaries are used for invalidation routing and manifest repair, not as a second hit-validation gate.
- [ ] **T5.5** Add unit tests for cache-key stability and invalidation-by-schema-version.
  - Acceptance: changing title hash, LUT hash, keyframe hash, output size, source fingerprint, source mode, or renderer version produces a different key.

## Render cache generation

- [ ] **T6.1** Add chunk planning for render-cache ranges.
  - Acceptance: chunks are bounded, range-aligned, and can be invalidated independently.
- [ ] **T6.2** Generate render-cache chunks through the existing accelerated renderer.
  - Acceptance: effects, transforms, transitions, titles, LUTs, and keyframes are not re-implemented in the cache worker or export module.
- [ ] **T6.3** Capture/cache rendered chunks without CPU pixel readback in the premium path.
  - Acceptance: no `getImageData` or Canvas2D readback appears in accelerated render-cache code paths.
- [ ] **T6.4** Send encoded chunk streams/blobs to the cache worker for storage and manifest commit.
  - Acceptance: interrupted writes leave uncommitted orphan files or `writing` entries that startup repair can clean.
- [ ] **T6.5** Add render-cache hit/miss status to worker snapshots.
  - Acceptance: UI can show original/proxy/render-cache status without receiving media handles.

## Invalidation

- [ ] **T7.1** Add `src/engine/cache-invalidation.ts` with dependency index types and range helpers.
  - Acceptance: helpers are pure and unit-tested with overlapping ranges.
- [ ] **T7.2** Wire timeline edit commands to invalidate affected render-cache ranges.
  - Acceptance: split, trim, move, delete, duplicate, paste, place-clip, add-title, and track reorder invalidate old/new affected spans, including overlapping composite spans on other tracks where z-order can change the result.
- [ ] **T7.3** Wire visual edits to invalidation.
  - Acceptance: effect, transform, opacity, transition, title, LUT, and keyframe edits invalidate only affected ranges where possible.
- [ ] **T7.4** Wire source lifecycle changes to invalidation.
  - Acceptance: relink, source fingerprint changes, conformance changes, proxy settings changes, and media health changes invalidate all dependent proxy/render entries.
- [ ] **T7.5** Add conservative fallback invalidation for unknown edit shapes.
  - Acceptance: ambiguous edits invalidate broader ranges and never leave entries marked ready when dependencies are unknown.
- [ ] **T7.6** Unit-test invalidation coverage.
  - Acceptance: tests cover clips, tracks, transitions, titles, LUTs, keyframes, source changes, output settings, and overlapping composite spans.

## Budgeting, eviction, and cleanup

- [ ] **T8.1** Add `src/engine/cache-budget.ts` for usage accounting and eviction ranking.
  - Acceptance: tests cover per-category totals including metadata, quota estimates, warning thresholds, eviction thresholds, and minimum-free-space reserve.
- [ ] **T8.2** Implement LRU-plus-priority eviction.
  - Acceptance: active ranges, in-flight writes, active export chunks, and pinned proxies are protected; old render chunks/thumbnails/filmstrips/waveforms evict before unpinned proxies.
- [ ] **T8.3** Add storage-pressure handling to proxy/cache worker.
  - Acceptance: quota errors pause background jobs, run eviction, retry when safe, and surface bounded diagnostics.
- [ ] **T8.4** Add cleanup actions: delete render cache, delete selected-source proxies, delete all generated media, repair cache, reset budget.
  - Acceptance: actions are idempotent and safe to repeat; deleting cache leaves project descriptors/timeline intact.
- [ ] **T8.5** Add tests for budget eviction and cleanup.
  - Acceptance: tests prove usage drops below target and project/source descriptors are not removed.

## UI and protocol

- [ ] **T9.1** Extend `src/protocol.ts` with proxy/cache commands and state messages.
  - Acceptance: commands cover generate, pause, cancel, retry, delete, pin, set budget, cleanup, proxy generation preference (`disabled`/`ask`/`automatic`/`selected-only`), preview-proxy enable/disable, and export source-mode selection.
- [ ] **T9.1a** Persist project/user proxy workflow settings.
  - Acceptance: project/user settings store proxy generation preference and preview-proxy enablement; automatic proxy jobs never start unless the stored mode allows them, and the user can globally disable proxy preview without deleting generated proxies.
- [ ] **T9.2** Add proxy status to the media bin.
  - Acceptance: each asset can show not generated, recommended, queued, generating, ready, stale, failed, disabled, and pinned states.
- [ ] **T9.3** Add preview/cache status to persistent chrome.
  - Acceptance: users can tell when preview is original, proxy, render-cache, or limited fallback; proxy resolution is visible.
- [ ] **T9.4** Add `src/ui/CachePanel.tsx` for usage, budget, category totals, pinned proxies, repair, and cleanup actions.
  - Acceptance: controls are keyboard reachable, use native controls, and blocking quota errors use `role="alert"` only when action is required.
- [ ] **T9.5** Update export dialog source-mode controls.
  - Acceptance: original-source export is default; proxy export requires explicit opt-in and is disabled when needed proxies are stale/missing.

## Integration and performance validation

- [ ] **T10.1** Add integration coverage for proxy preview with default original-source export.
  - Acceptance: preview can use a proxy while export plan resolves original source fingerprints by default.
- [ ] **T10.2** Add integration coverage for explicit proxy export.
  - Acceptance: export source mode is recorded in the request and only proxy-valid chunks/proxies are used.
- [ ] **T10.3** Add integration coverage for deleting OPFS/IndexedDB cache while a project remains usable.
  - Acceptance: project loads, timeline edits still work, sources can relink, and derivatives regenerate on demand.
- [ ] **T10.4** Add a performance benchmark or reproducible manual fixture for a large source with proxy generation enabled.
  - Acceptance: benchmark records no sustained main-thread media/cache work and no preview interaction freeze attributable to proxy generation.
- [ ] **T10.5** Add fixture documentation for large/high-bitrate/VFR/proxy-recommended sources.
  - Acceptance: fixtures stay client-side and do not require server-side media compute.
- [ ] **T10.6** Run `npm run build`.
  - Acceptance: strict TypeScript build passes.
- [ ] **T10.7** Run `npm test`.
  - Acceptance: Vitest passes and test count increases for cache-key, invalidation, and eviction logic.
- [ ] **T10.8** Manual smoke: import a large clip, generate a proxy, scrub using proxy preview, delete cache, regenerate, then export with default original-source mode.
  - Acceptance: preview remains responsive, cache deletion does not corrupt the project, and export uses originals unless proxy export is explicitly enabled.
