# Design: Bugfix — Post-merge editor chrome cleanup

This document maps each bug in `bugfix.md` to the concrete change and the
invariant the change protects. All edits stay within `src/global.css`,
`src/ui/App.tsx`, and `src/ui/Toolbar.tsx`. No new component file, no new
worker, no new message type, no new rendering pass.

## D1 — Left dock wraps MediaBin + BeatPanel (B1)

`src/ui/App.tsx`

Wrap the existing `<MediaBin>` and `<BeatPanel>` siblings in a single
`<aside class="dock-left" aria-label="Library">` element so the workspace
grid sees one child, not two, in the left column. BeatPanel ceases to
occupy its own implicit grid track.

```tsx
<Show when={previewSurfaceAvailable()}>
  <aside class="dock-left" aria-label="Library">
    <MediaBin ... />
    <BeatPanel ... />
  </aside>
</Show>
```

`src/global.css`

```css
.dock-left {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.dock-left > .media-bin { flex: 1 1 auto; min-height: 140px; }
.dock-left > .beat-panel { flex: 0 0 auto; max-height: 36vh; overflow-y: auto; }
```

The workspace grid also drops the gap from `12px` to `6px` and the column
widths tighten to `236px / 1fr / 304px` (was `232 / 1fr / 320`) so the
preview reclaims 16px and the rail shrinks just enough to keep the five
tabs (D6) fitting.

Why not put BeatPanel as a side-rail tab: the beat results are scoped to
imported audio sources and are consumed in the library context (the user
enables sources, sets a global offset, and triggers auto-cut on selected
clips). Co-locating with MediaBin matches the user's workflow; the side
rail is reserved for clip-scoped editing (Inspector, Captions, …).

Why not a fourth grid column: a fourth column would either shrink the
preview again or push the side rail off-screen at 1280-wide laptops.

## D2 — Status row separated from tools row in the pipeline strip (B2)

`src/ui/Toolbar.tsx`

The pipeline strip still uses one container, but the JSX now emits the
status chips first (`Accelerated`, `Client`, `COOP/COEP`, optional `PV ...`
preview-resolution, optional `<fps>` encode rate), then a
`<span class="pipeline-tools-divider" aria-hidden="true" />`, then the
tool buttons (`Go Live`, `Cleanup`, `Captions`, `Translate`, `Reframe`,
`Silence`, `Keys`, `Capabilities`, `Help`). Each tool button gets a
second class `is-tool` so CSS can demote it visually.

Label shortenings: `COOP/COEP OK` → `COOP/COEP`; `Client compute` →
`Client`; `Preview 720p` → `PV 720p`; `Encode 60 fps` → `60 fps`. The
mono uppercase typography removes the need for verbose words.

`src/global.css`

```css
.pipeline-tools-divider { flex: 1; min-width: 14px; }
.pipeline-chip.is-tool {
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: none;
  color: var(--ink-300);
}
.pipeline-chip.is-tool:hover {
  color: var(--cyan);
  background: rgb(34 211 238 / 6%);
}
```

The base `.pipeline-chip` (used by the status chips) keeps the
monospace + uppercase treatment with `is-ok` (sage), `is-waiting`
(amber), `is-warn` (vermillion) colour states.

The `Go Live` button keeps `is-ok` semantics: when streaming, it
animates a pulsing vermillion dot prefix.

## D3 — `:root` token block rewrite (B3)

`src/global.css` lines ~11–140

The existing token block is replaced wholesale. Variables are reorganised
into named groups so future work can target them.

| Group | Tokens |
|---|---|
| Surfaces | `--ink #07070a`, `--plate #0d0d12`, `--panel #14141b`, `--elevated #1b1b24`, `--well #0a0a10` |
| Edges | `--edge #232330`, `--edge-strong #34344a`, `--edge-soft rgb(255 255 255 / 5%)` |
| Type ramp | `--ink-100 #f4f6fa`, `--ink-300 #c7c9d6`, `--ink-500 #8e90a3`, `--ink-700 #5a5c70`, `--ink-900 #3b3d4e` |
| Accent | `--cyan #22d3ee`, `--cyan-soft`, `--cyan-glow` |
| Signal | `--amber #f5b942`, `--vermillion #ef4f4f`, `--sage #6ee7b7` (each + `-soft`) |

A shadcn-token bridge then maps the new palette onto the legacy variable
names (`--background`, `--card`, `--primary`, `--secondary`, `--accent`,
`--warn`, `--destructive`, `--border`, `--ring`, `--text`, `--text-muted`,
`--bg-elevated`, `--bg-control`, etc.) so the ~5000 existing CSS rules
adopt the new palette without per-rule edits.

Type sizes drop fractional rems for integer pixels:
`--text-2xs: 10.5px`, `--text-xs: 11.5px`, `--text-sm: 12.5px`,
`--text-base: 13.5px`, `--text-md: 16px`, `--text-lg: 20px`,
`--text-xl: 28px`. Radii drop to `--radius-xs 2px`, `--radius-sm 3px`,
`--radius-md 4px`, `--radius-lg 6px`. Toolbar height `--toolbar-h 56px`
(was 88), control height `--control-h 28px` (was 34), icon button width
`--icon-btn-w 28px` (was 36) — denser instrument look without losing
hit-target size (28px is at the WCAG 2.5.5 24×24 minimum + 4 padding).

Body styling drops both atmospheric radial gradients:

```css
body {
  background-color: var(--ink);
  background-image: none;
  font-feature-settings: 'ss01', 'cv11';
  line-height: 1.35;
}
```

`--gradient-primary` becomes a real `linear-gradient` value so Tailwind's
`bg-[image:var(--gradient-primary)]` produces valid CSS (B4):

```css
--gradient-primary: linear-gradient(
  180deg,
  var(--cyan),
  color-mix(in oklab, var(--cyan), #000 10%)
);
```

`--glass-blur` resolves to `0px` and `--toolbar-bg` to `var(--ink)` so
the existing `backdrop-filter: blur(var(--glass-blur))` rules become
no-ops.

## D4 — Instrument override section appended at the file tail (B3, B5, B7)

`src/global.css` tail (~430 LOC, last-loaded so it wins source order
without specificity gymnastics)

The override section re-shapes the most visible chrome where the
token-bridge alone cannot express the design:

- `.workspace` gap + column widths + `.dock-left` wrapper styles.
- `.panel` becomes flat hairline (no shadow).
- `.toolbar` drops `backdrop-filter`, sits on a 1px ink edge.
- `.app-brand` gets a vertical hairline separator to the right.
- `.app-glyph` renders an inline-SVG reticle (D5).
- `.file-name` becomes a monospaced source readout with a small dot prefix.
- `.transport-controls`, `.edit-controls`, `.master-mix` become paired
  hairline-bordered groups on the plate background.
- `.pipeline-strip` becomes a 26px monitor strip with per-chip vertical
  hairline dividers; `.pipeline-chip` loses its rounded pill and reads
  as a monospace cell in the strip.
- `.status-bar` becomes a 28px monospace footer with per-badge
  vertical hairline dividers; `.status-ok` gets a sage `●` prefix.
- `.side-rail-tabs` get a panel border + radius; `.side-rail-tab` reads
  as a monospace label with a cyan underline on the active tab.
- `.side-rail-tab-panel .panel-title:first-child` is hidden so the tab
  label above doesn't duplicate as an in-panel heading.
- `.preview` paints a 32px calibration grid via `::before` + a faint
  cyan well at the top for depth.
- `.preview-empty` adds cyan corner brackets via `::before` and
  `::after`, an elevated-letter-spacing cyan eyebrow, a monospace
  uppercase title, and a substantial cyan CTA with proper foreground
  contrast (`#04161a`).
- `input[type='range']` gets a 2px ink track + 12px cyan thumb with a
  3px halo.
- Scrollbars become 8px ink hairlines.
- `::selection` reads cyan-on-ink.

The override section is fenced with a `/* === Precision-instrument
redesign === */` banner comment so future readers know this is the
expected last word on the chrome.

## D5 — Inline-SVG reticle brand glyph (B4)

`src/global.css`

The `.app-glyph` element becomes a 28×28 transparent square. Its
`::before` paints an inline SVG via `background-image: url("data:image/svg+xml;utf8,...")`:

- Outer circle at `r=9` (stroke `#22d3ee`, `stroke-width=1.25`).
- Centre dot at `r=2.2` (solid `#22d3ee`).
- Four tick marks at top/bottom/left/right extending from circle to edge.

The reticle reads as a sighting / calibration mark — tying the brand
glyph to the precision-instrument stance. SVG inlined as a data URL
avoids a new file in `public/` and stays self-contained in the CSS.

## D6 — Side-rail tabs fit five labels (B6)

`src/global.css`

```css
.side-rail-tab {
  flex: 1 1 0;
  min-width: 0;
  padding: 0 2px;
  height: 32px;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

`flex: 1 1 0` gives every tab equal share. `min-width: 0` is the standard
flex-truncation enable. `padding: 0 2px` + `letter-spacing: 0.02em`
brings `INSPECTOR` (the widest label) under 55px at the new 304px column
width (5×55 = 275, leaves 28px for the collapse-button + a few px of
borders). Verified at 1280×800 — all five tabs fit without truncation.

## D7 — Preview empty state as calibration surface (B7)

Already described under D4 as part of the override section.
`preview-empty::before` and `::after` paint two 22×22 cyan corner
brackets at the inset 12px. The brackets share `border: 1px solid var(--cyan)`
with `opacity: 0.55` and use `border-right: none; border-bottom: none`
(top-left) / `border-left: none; border-top: none` (bottom-right) to
form the L-shapes.

## Out-of-scope drift caught during work

The redesign uncovered three pre-existing issues that are not addressed
here and are flagged for follow-up:

1. The Inspector panel's content has a top-level `<h2 class="panel-title">`
   that duplicates the tab label above it. The override section hides only
   the immediate panel-child title via
   `.side-rail-tab-panel > .panel > .panel-title:first-child { display: none }`
   as a defensive fix, so nested panel headers such as Replay Buffer, Live
   Audio Chain, and Voice Cleanup remain visible. A content-level cleanup of
   every Inspector subsection title belongs in a separate spec.
2. The Inspector subsections (Source, Transform, Effects, Speed, Beauty,
   Matte, Time Remap, Look) all share the same eyebrow weight. A future
   spec should introduce a typography hierarchy that distinguishes
   section heads from field labels.
3. The right-rail Replay Buffer, Live Audio Chain, and Voice Cleanup sparse
   states were checked during the Product Design follow-up pass. The export
   popover, bundle popover, audio-cleanup panel, ASR panel, smart-reframe
   panel, language-tools panel, and render-queue panel still inherit the new
   tokens via the bridge but were not individually reviewed for any
   pixel-level alignment regressions. A follow-up spec should walk those
   panels at 1280×800 and 1440×900 and tighten anything that reads off.
