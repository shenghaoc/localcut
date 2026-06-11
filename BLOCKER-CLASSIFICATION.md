# Blocker Classification

Severity levels for release gate failures. Maps to P0/P1 priorities in `AGENTS.md` review guidelines.

## Blocks Release (P0)

Any of these open issues blocks the release entirely:

- Sustained media decode/encode/GPU/pixel processing on the main thread (architectural violation)
- CPU pixel round-trip (`getImageData`, Canvas2D readback) in the accelerated preview/export path
- Per-frame `postMessage` for the accelerated playback clock when SAB is available
- Missing COOP/COEP headers in production build
- Missing user-facing capability handling when `crossOriginIsolated` is false (dead-end screen)
- Server runtime or external API required for core editing/export
- `VideoFrame` not `.close()`d or closed twice
- Logic bugs, crashes, data loss, race conditions, or security issues in shipped code
- `pnpm build` fails
- `pnpm test` fails or test count decreases for non-trivial logic

## Blocks Accelerated Tier (P1)

These block the accelerated (WebGPU) tier but allow limited mode to ship:

- Multiple `queue.submit` per frame in the accelerated effect chain
- `importExternalTexture` cached across frames
- Unbounded frame queues without backpressure
- Frame cache without LRU + `.close()` on eviction
- Effect chain run twice (preview + export) instead of shared texture
- Unstable references causing re-renders in rAF clock loop
- Silent failures: swallowed errors, empty catch blocks on critical paths

## Manual Follow-up Required

These need a documented plan but don't block the release:

- Performance budgets in warning range (not breach)
- Accessibility issues that don't prevent keyboard-only workflows
- Missing optional codec support (AV1, ProRes)
- HDR content handling gaps
- Browser-specific quirks with known workarounds

## Known Limited Mode

Expected degraded behavior that is documented and accepted:

- No WebGPU: limited preview with compatibility thumbnail
- No crossOriginIsolated: shell-only mode, no import/edit/export
- No File System Access API: fallback to download-based export
- No AudioWorklet: silent preview, audio disabled
- Software GPU: lower preview frame rate, acceptable with budget warning
