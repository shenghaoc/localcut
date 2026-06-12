# Bugfix — Right sidebar panel stacking makes expanded panels unusable

> Status: **Active**. Bugfix spec for the right sidebar layout issue where stacking
> multiple collapsible panels vertically in a 320px-wide column makes expanded
> panels too cramped to use. Tracks the work on `fix/side-rail-tabs` (PR #81).

## Summary

LocalCut Studio's right sidebar (`.side-rail`) stacks Inspector, Captions,
Replay Buffer, Live Audio Chain, and (on the Phase 36 branch) Voice Cleanup
vertically in a fixed 320px-wide column. The bottom three panels are collapsed
by default, but expanding any one of them squishes the Inspector and Captions
into unusable slivers. The `max-height: 280px` cap on `.collapse-body` further
limits the usable area. On the Phase 36 deployment (5 panels), the Voice
Cleanup controls are effectively inaccessible — users cannot expand the section
and the expanded area is too small to interact with.

Architecture is preserved:

- SolidJS UI on the main thread; the pipeline worker owns media I/O, the
  timeline, playback, WebGPU, and export.
- No server-side media processing.
- No change to the accelerated preview/export hot path.
- No new worker, message type, or rendering pass.

## Bugs

### B1 — Stacked panels compete for vertical space

The `.side-rail` grid uses `grid-template-rows: minmax(170px, 1fr) minmax(180px,
0.8fr) auto auto` for 4+ children. The bottom panels are `auto`-sized and
collapsed by default, but expanding any one adds up to 280px of content,
compressing the Inspector and Captions rows below their minimum usable heights.
With 5 panels (Phase 36 branch), the grid has an implicit 5th `auto` row,
making the problem worse.

**Expected:** Only one bottom panel is visible at a time. Inspector and
Captions retain their full fractional share of the sidebar height. Each bottom
panel gets the remaining space with internal scrolling.

### B2 — `max-height: 280px` caps collapse-body inside sidebar

`.replay-buffer-panel .collapse-body` and `.live-audio-chain-panel
.collapse-body` have `max-height: 280px` regardless of available space. When a
panel is the only visible one in a tabbed layout, this cap wastes the space the
tabbed container provides.

**Expected:** Collapse-body inside the tabbed container has no `max-height`
restriction; it fills the available space with `overflow: auto`.

### B3 — No tab mechanism exists for bottom panels

The bottom panels are rendered unconditionally in the `.side-rail` DOM. There is
no UI to switch between them — the user must expand/collapse each accordion
independently, and multiple expanded panels fight for space.

**Expected:** A tab bar at the top of the bottom section lets the user switch
between Replay Buffer and Live Audio Chain (extensible to Voice Cleanup). Only
the active tab's panel is rendered.

## Non-goals

- No AI of any kind.
- No new product features beyond fixing the layout.
- No change to Inspector or Captions panel behaviour.
- No change to the accelerated `VideoFrame → importExternalTexture → compute
  chain → queue.submit` pipeline.
- Not moving panels to overlay/dialog (they stay in the sidebar).
- Not changing the sidebar width (320px).

## Acceptance criteria

- Expanding Replay Buffer or Live Audio Chain does not compress Inspector or
  Captions.
- Each tab panel fills the remaining sidebar height with internal scrolling.
- Tab buttons are keyboard-accessible with visible focus indicators.
- `vp build` passes (strict TypeScript).
- `vp test run` passes (test count does not decrease).
- The tabbed layout works on the responsive breakpoint (max-width: 900px).
