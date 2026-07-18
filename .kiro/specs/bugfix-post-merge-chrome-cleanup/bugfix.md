# Bugfix — Post-merge editor chrome cleanup

> Status: **Implemented in PR #114.** This is the historical structural cleanup
> that restored the three-child workspace grid. Its electric-cyan visual-token
> direction was later superseded by the canonical amber foundation in
> [`feature-design-system-foundation`](../feature-design-system-foundation/design.md).

## Summary

Several feature PRs landed in rapid succession and the visible chrome regressed
beyond what any single PR's review caught. The most damaging regression is
structural: the workspace CSS grid declares three tracks
(`232px / 1fr / 320px`) but four children render into it — a Phase 34 BeatPanel
sits as a `MediaBin` sibling inside `.workspace`, taking the preview's column
slot and forcing the side rail to wrap to a second implicit row at the *left*.
On a 1600×1000 viewport this collapses the preview to ~320×292 in the top-right
corner while ~1000px of empty void renders between MediaBin and the misplaced
preview. The remaining issues are token / chrome drift accumulated across the
same merge window: status chips and action buttons share identical styling,
glass-blur sits on top of flat panels, the toolbar mixes purple gradient
primary with green secondary accent, the brand glyph is a generic gradient
circle, and the second toolbar row reads as a long horizontal sprawl of
indistinguishable pills.

This spec scopes the cleanup. No engine or protocol changes; no new product
features; no removal of any existing surface. Pure structural + visual repair
of the editor chrome.

Architecture is preserved:

- SolidJS UI on the main thread; the pipeline worker owns media I/O, the
  timeline, playback, WebGPU, and export.
- No server-side media processing.
- No change to the accelerated preview/export hot path.
- No new worker, message type, or rendering pass.
- No change to `VideoFrame` lifecycle.

## Bugs

### B1 — Workspace grid renders four children in three column tracks (P0)

`src/ui/App.tsx`: `.workspace` declares
`grid-template-columns: 232px minmax(0, 1fr) 320px` (via `.has-bin`) but the
JSX inside renders four siblings: `<MediaBin>`, `<BeatPanel>`,
`<section class="preview panel">`, `<div class="side-rail">`. Implicit-grid
auto-placement puts BeatPanel in the 1fr middle column track, shoves the
preview into the 320px right track that the side rail expects, and forces the
side rail down to a new implicit row at the left. Measured at 1600×1000:
MediaBin at (12, 101, 232×292), BeatPanel at (256, 101, 1000×292), preview at
(1268, 101, 320×292), side rail at (12, 404, 232×324). The preview — the
single most important surface in an NLE — renders at ~10% of the available
width.

**Expected:** The workspace renders three columns: a left dock (MediaBin +
BeatPanel stacked), the dominant preview, and the side rail. BeatPanel does
not occupy its own grid column track.

### B2 — Pipeline strip mixes status indicators and action buttons (P1)

`src/ui/Toolbar.tsx`: the second toolbar row (`.pipeline-strip`) renders three
*state* chips (`Accelerated`, `Client compute`, `COOP/COEP OK`) interleaved
with eight *action* buttons (`Capabilities`, `Audio Cleanup`, `Auto Captions`,
`Language Tools`, `Smart Reframe`, `Silence Review`, `Keystroke Overlay`,
`Help`, `Go Live`) under the same `.pipeline-chip` class. A user cannot
distinguish "what the editor is" from "what the editor can do" at a glance.
Live/optional `Preview 720p` and `Encode 60 fps` chips appear in the same row
with the same styling, drifting between state and action depending on context.

**Expected:** The status row keeps state chips on the left in one visual
language, separates them from a tool group with a divider, and styles the
tool group distinctly (non-monospace label, no uppercase, hover state).

### B3 — Design tokens drift from the stated dark professional-tool aesthetic (P1)

`src/global.css`: the `:root` block declares a purple primary (`#8b6fff`) +
green accent (`#36d399`) + navy plate (`#0c0d18`) palette, then layers two
fixed-attachment radial gradients on the body (`color-mix var(--primary)` top
right, `color-mix var(--waveform)` top left), a `backdrop-filter: blur(16px)`
glass band on the toolbar, and a multi-stop linear gradient on the primary
brand glyph. The combined effect reads as a consumer SaaS dashboard rather
than the dark professional-tool standard documented in
[`.kiro/steering/ui-standards.md`](../../steering/ui-standards.md). Type sizes
use awkward fractional rems (`0.74rem`, `0.8125rem`, `0.9375rem`); radii are
large (`10–14px`); shadows carry the purple glow (`--shadow-primary`,
`--glow-primary`) into every component that consumes them. The end result is
muddy hierarchy and color contention everywhere.

**Expected:** A single confident accent (electric cyan `#22d3ee`) replaces the
purple/green dyad. Surfaces step ink → plate → panel → elevated with hairline
1px borders. Type sizes are an integer-pixel scale. Radii drop to 2–6px.
Shadows are neutral. Body has no atmospheric gradient. Toolbar has no glass
blur. JetBrains Mono carries every numeric / technical readout (timecodes,
codec strings, sample rates, fps, percentages).

### B4 — Brand glyph rendering is incoherent (P2)

`src/global.css` `.app-glyph::after`: the current glyph composes a
`linear-gradient` background block on the `.app-glyph` and overlays an
absolutely-positioned 11×11 `border-radius: 50%` ring via `::after`. With the
new flat token palette, the gradient block stays but the gradient definition
itself (`--gradient-primary`) was redirected to a flat cyan value, leaving
Tailwind's `bg-[image:var(--gradient-primary)]` to evaluate to
`background-image: <flat-color>` which is invalid CSS (`background-image`
does not accept colors) — every default-variant button silently drops its
background. The brand mark itself reads as a generic gradient circle, not a
mark tied to any concept in the product.

**Expected:** `--gradient-primary` resolves to an actual `linear-gradient` so
Tailwind `bg-[image:...]` produces a valid background-image. The brand mark
becomes a recognisable reticle/crosshair that ties the brand to the product's
"precision instrument" stance.

### B5 — Status bar reads as a generic footer (P2)

`src/ui/App.tsx` `<footer class="status-bar">`: the status bar renders a left
status line plus a row of `.status-badge` buttons (Update Available, Ready
Offline, Offline, Worker, Audio, capability tier, Diagnostics) with no
hierarchical treatment, no separators, and no monospace anchoring for the
technical readouts. The COOP/COEP indicator renders as bare green text
without a status dot, so it reads as a heading or label rather than a state.

**Expected:** The status bar reads as an instrument footer: monospace
technical readouts, hairline dividers between badge groups, sage dot prefix
on the `Ready Offline` / `COOP/COEP OK` state, neutral ink for buttons.

### B6 — Side rail tabs need graceful compression with 7 labels (P2)

The side rail now exposes seven tabs (`Inspector`, `Captions`, `Record`,
`Program`, `Replay`, `Audio`, `Cleanup`). At the 304px rail width, the 28px
collapse button leaves roughly 276px for tabs, or about 39px per equal-width
tab. The previous five-tab test premise is stale, and long labels such as
`Inspector` and `Captions` cannot remain fully visible at that width.

**Expected:** All seven tabs stay equal width, keyboard/tablist semantics remain
intact, and longer labels use clean ellipsis without half-visible glyphs or
horizontal overflow at the smallest rail width.

### B7 — Preview empty-state reads as a generic empty card (P2)

`src/ui/App.tsx` `.preview-empty`: when no source is loaded the preview
shows an eyebrow ("PREVIEW"), a title ("No source loaded"), one line of body
copy, and an import label styled as a default Tailwind button. There is no
visual cue that the surrounding area is a precision preview surface — the
empty state could be from any web app's empty card. The corner brackets and
calibration-grid stage texture that signal "reference monitor" are missing.

**Expected:** The empty state reads as a calibration surface: a faint grid
overlay on the well, cyan corner brackets at the inset, monospace eyebrow at
elevated letter-spacing, a substantial cyan CTA, a readable but secondary
"getting started" link.

## Non-goals

- No engine, protocol, or worker changes.
- No new product features beyond the listed structural + visual repair.
- No removal of any existing surface or capability.
- No change to the timeline interaction model, keyboard shortcuts, or any
  panel's content/behaviour.
- No change to the accelerated `VideoFrame → importExternalTexture → compute
  chain → queue.submit` pipeline.
- No new dependency.
- No light mode (per the steering doc: "no light mode in v1").

## Acceptance criteria

- The workspace grid renders three columns (dock / preview / rail) at all
  supported viewports (≥1280×800). Preview width ≥60% of available workspace
  width.
- Status chips and action buttons in the toolbar second row are visually
  distinct and grouped by category.
- The design tokens at `:root` declare a single accent (cyan), an integer-px
  type scale, and 2–6px radii. The body has no atmospheric gradient. The
  toolbar has no `backdrop-filter`.
- `--gradient-primary` resolves to a valid `linear-gradient` value so
  Tailwind `bg-[image:var(--gradient-primary)]` produces a visible
  background-image.
- The brand glyph renders a recognisable reticle.
- The status bar renders monospace technical readouts with hairline
  dividers; the COOP/COEP-OK state carries a sage dot.
- All seven side-rail tabs fit the rail without overflow, with longer labels
  ellipsized cleanly at the new column width.
- The preview empty state shows cyan corner brackets, a calibration grid on
  the stage, and a substantial cyan import CTA with proper contrast.
- `vp run typecheck` passes (strict TypeScript).
- `vp run check` passes (format / lint / typecheck / test / build).
- No `VideoFrame` lifecycle is touched by this work.
