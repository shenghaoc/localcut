# Bugfix — Codebase audit quality

> Status: **In review** (PR #155). Comprehensive codebase audit across 10
> dimensions with parallel analysis agents, code review, and `.jules/` coverage.

## Why this exists

PR #155 is a code-quality fix-up branch that started as a full codebase audit
and grew to cover all `.jules/` documented points (security, accessibility,
performance) and extract shared utilities to eliminate duplication.

## Scope

In scope:

- logic bugs that produce wrong output, invalid state, or broken fallback paths,
- lifetime and cleanup bugs (worker/capture/interpolation resource handling),
- CSS regressions where missing tokens or wrong z-index break the editor chrome,
- accessibility bugs in interactive Solid UI controls,
- performance violations of bolt.md layout-thrashing rules,
- shared code extraction to eliminate duplication,
- `.jules/` coverage (sentinel.md security, palette.md accessibility,
  bolt.md performance).

Out of scope:

- new editing features,
- broad visual redesign,
- server-side media processing or telemetry,
- speculative rewrites without a concrete bug or repeated duplication.

## Bugs

### B1 — Auto-zoom merge condition inverted

`auto-zoom.ts:172` — The comparison `prev.zoomOutAtUs - curr.zoomInAtUs >
mergeThresholdUs` was inverted: it merged on large overlap but NOT on small
gaps. The merge action also truncated `prev.zoomOutAtUs` to `curr.zoomInAtUs`
instead of extending. Fixed both the condition and the merge action.

### B2 — Missing bt2020-12 transfer characteristic

`colour.ts:183` — `selectNormalizeTransfer` had no case for `bt2020-12`,
causing it to fall through to IDENTITY (no OETF correction). BT.2020-12
sources rendered with incorrect gamma.

### B3 — Stale frame past end of stream

`frame-source.ts:119` — `SequentialFrameSource.frameAt` returned the last
frame even after its `endOf` time had passed, compositing incorrect frames
into exports.

### B4 — Audio-only ring buffer eviction stall

`ring-buffer.ts:94-127` — When the oldest entry exceeded `maxDurationS`,
`cutoffIdx` stayed at -1 and the buffer grew unbounded. Added fallback
`cutoffIdx = 1`.

### B5 — isRecord missing Array.isArray check

`capture-chunk-manifest.ts:37` — The `isRecord` type guard was missing
`!Array.isArray(value)`, allowing arrays to pass as records.

### B6 — moveClips missing lock enforcement

`timeline.ts:974` — `moveClips` did not check `track.locked` on source or
destination tracks. All current callers checked, but the exported function
provided no invariant.

### B7 — App init discards probe data on sendInit failure

`App.tsx:3933` — The entire onMount init was wrapped in one try-catch. If
`sendInit(canvas)` failed after `probeCapabilitiesV2()` succeeded, all derived
state was skipped. Moved sendInit() after capability setup.

### B8 — Interpolation tensor cleanup after queue submission

`interpolation-engine.ts:387-390` — `.then().catch()` chaining meant if
`dispose()` threw in the fulfilled handler, the catch handler caught it and
called `dispose()` again. The follow-up review also noted that
`onSubmittedWorkDone()` can reject during WebGPU device loss. The cleanup now
handles that rejection before disposing the output tensor.

### B9 — Export dialog no download fallback

`ExportDialog.tsx:979` — When `showSaveFilePicker` existed but threw a
non-AbortError, the code logged "falling back to download" but never called
`downloadBlob()`. Added actual download fallback.

### B10 — Capture session duplicate onError

`capture-session.ts:527,536,556` — Catch handlers called `onError` (duplicate
of the call at line 519) and manually set `state = 'idle'` (bypassing stop()'s
cleanup). Removed duplicate and manual state reset.

### B11 — Silent IndexedDB failures

`worker.ts:2368,2482,5081,5959` — Source load/restore/delete operations
silently swallowed all errors. Added `console.warn` logging.

## .jules/ coverage

### sentinel.md (Security) — 0 violations

All `innerHTML` uses properly sanitized via DOMPurify. No language attribute
injection. No URL validation issues.

### palette.md (Accessibility) — 18 violations, all fixed

- 5 missing `aria-controls` on collapse toggle buttons
- 13 missing `aria-live`/`aria-atomic` on status elements

### bolt.md (Performance) — audited with review corrections

- ReframeOverlay crop rect: direct dimensions retained because scaling distorts
  borders and shadows on this absolutely positioned overlay
- Timeline marquee: direct dimensions retained because scaling distorts the
  selection border
- PreviewGizmo: `width`/`height` → `scaleX`/`scaleY` combined with rotation

## Active review follow-up

The 2026-07-04 Gemini pass added active review threads after the initial PR
body/spec update. This branch now also covers:

- queued tensor cleanup after WebGPU device loss,
- short-lived, DOM-backed blob downloads,
- Solid `<Show>` conditional rendering in `AudioInsertRow`,
- copy-feedback timeout cleanup in `LanguageToolsPanel`,
- bordered overlay sizing corrections in ReframeOverlay and Timeline,
- explicit centered transform origin in PreviewGizmo.

## Shared code extraction

- `src/lib/type-guards.ts` — shared `isRecord`, `isString`, `isNonEmptyString`,
  `isPositiveNumber` (eliminates 18+ duplicate definitions)
- `src/lib/clipboard.ts` — shared `copyToClipboard` utility
- `src/lib/blob-download.ts` — shared `downloadBlob` utility

## Acceptance criteria

- PR #155 has no unresolved GitHub review threads.
- All `.jules/` points fully covered (sentinel, palette, bolt).
- `vp run check` — full quality gate passes.
- Focused review-comment regression guards pass.
