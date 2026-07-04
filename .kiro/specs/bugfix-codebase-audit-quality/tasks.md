# Tasks: Bugfix — Codebase audit quality

> Status: **In review** (PR #155). Tasks map to `bugfix.md` and `design.md`.

## T1 — Logic bugs

- [x] auto-zoom.ts: Fix inverted merge condition (was merging on large overlap,
  now merges on small gap/overlap; also fix merge action to extend, not truncate)
- [x] colour.ts: Add missing `bt2020-12` case to `selectNormalizeTransfer`
- [x] frame-source.ts: Fix stale frame returned past end of stream (add
  `endOf(current) > time` guard)
- [x] ring-buffer.ts: Fix audio-only eviction stall when oldest entry exceeds
  maxDurationS (add fallback `cutoffIdx = 1`)
- [x] chunk-manifest.ts: Fix isRecord missing `!Array.isArray` check (arrays
  would pass as records)
- [x] timeline.ts: Add `track.locked` enforcement to `moveClips` (prevents
  moves to/from locked tracks)

## T2 — Error handling

- [x] App.tsx: Wrap onMount init in try-catch (prevents stuck "Checking
  capabilities..." on probe failure)
- [x] App.tsx: Move sendInit() after capability setup (preserves probe data
  even if canvas init fails)
- [x] worker.ts: Add logging to silent IndexedDB catch blocks (source load,
  restore, delete)
- [x] capture-session.ts: Add error logging to auto-stop catch handlers;
  remove duplicate onError calls and manual state bypass
- [x] interpolation-engine.ts: Fix ORT tensor GPU buffer leak on device loss
  (use `.then(onFulfilled, onRejected)` to prevent double-dispose)
- [x] ExportDialog.tsx: Add actual download fallback for non-AbortError save
  failures (was logging "falling back to download" but never downloading)
- [x] ExportDialog.tsx: Add debug logging for clipboard failures
- [x] LanguageToolsPanel.tsx: Add debug logging for clipboard failures

## T3 — CSS tokens and z-index

- [x] Define missing CSS custom properties: `--ink-400`, `--ink-600`,
  `--warning`, `--input-bg`, `--surface`, `--surface-hover`
- [x] Fix z-index hierarchy: reduce film-grain overlay from 9999 to 50

## T4 — Accessibility

- [x] TimelineClip.tsx: Replace `<span role="button">` with native `<button>`
  for delete affordance
- [x] VoiceCleanupPanel.tsx: Replace `<div role="button">` collapse header
  with native `<button>`
- [x] ScopePanel.tsx: Add `role="img"` and `aria-label` to scope canvases
- [x] ScopePanel.tsx: Add `aria-controls` to collapse toggle button
- [x] VoiceCleanupPanel.tsx: Add `aria-controls` to collapse header
- [x] ReplayBufferPanel.tsx: Add `aria-controls` to collapse header
- [x] LiveAudioChainPanel.tsx: Add `aria-controls` to collapse header
- [x] AudioInsertRow.tsx: Add `aria-controls` to expand button
- [x] InterpolationControls.tsx: Add `aria-live`/`aria-atomic` to status
  elements
- [x] BeatPanel.tsx: Add `aria-atomic` to progress wrap
- [x] AutoCaptionsPanel.tsx: Add `aria-atomic` to ASR progress blocks
- [x] ExportDialog.tsx: Add `aria-live`/`aria-atomic` to status elements
- [x] VoiceCleanupPanel.tsx: Add `aria-live`/`aria-atomic` to WASM hints
- [x] KeystrokeOverlayPanel.tsx: Add `aria-live`/`aria-atomic` to status
- [x] ProgramPanel.tsx: Add `aria-live`/`aria-atomic` to status elements
- [x] CaptionStyleInspector.tsx: Add `aria-atomic` to success notice

## T5 — Performance (bolt.md compliance)

- [x] ReframeOverlay.tsx: Crop rect `width`/`height` → `scaleX`/`scaleY`
  (eliminates layout thrashing at 60fps)
- [x] Timeline.tsx: Marquee `width`/`height` → `scaleX`/`scaleY`
- [x] PreviewGizmo.tsx: Gizmo `width`/`height` → `scaleX`/`scaleY`
  combined with rotation
- [x] App.tsx: Remove unnecessary `Array.from()` on `dataTransfer.types`
  (already `readonly string[]`)

## T6 — Shared code extraction

- [x] Create `src/lib/type-guards.ts` with shared `isRecord`, `isString`,
  `isNonEmptyString`, `isPositiveNumber` (eliminates 18+ duplicate definitions)
- [x] Create `src/lib/clipboard.ts` with shared `copyToClipboard` utility
- [x] Create `src/lib/blob-download.ts` with shared `downloadBlob` utility

## T7 — Validation

- [x] `vp test run` — 2457 tests, 220 files, all passing
- [x] `vp run typecheck` — clean
- [x] `vp run check` — full quality gate passes (format + lint + typecheck +
  test + build)
- [x] `.jules/sentinel.md` security points — 0 violations
- [x] `.jules/palette.md` accessibility points — 18 violations, all fixed
- [x] `.jules/bolt.md` performance points — 6 violations, all fixed

## T8 — PR metadata

- [x] Update PR #155 body to reflect all commits and findings
- [x] Post review findings as PR comments
- [x] Post .jules/ coverage audit as PR comment
