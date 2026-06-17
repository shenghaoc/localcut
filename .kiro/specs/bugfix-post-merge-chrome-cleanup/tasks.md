# Tasks: Bugfix — Post-merge editor chrome cleanup

> Status: **Active**. Tasks map to the bugs in `bugfix.md` and the design in
> `design.md`. Tracks the work on `claude/charming-meitner-eb82d3` (PR #114).

## T1 — Left dock wraps MediaBin + BeatPanel (B1)

- [x] **T1.1** In `App.tsx`, wrap the existing `<MediaBin>` and `<BeatPanel>`
  siblings in a single `<aside class="dock-left" aria-label="Library">`
  inside the `previewSurfaceAvailable()` `<Show>` block.
- [x] **T1.2** Verify in the browser that `.workspace` now has exactly three
  children at runtime (`.dock-left`, `.preview.panel`, `.side-rail`).
- [x] **T1.3** Add `.dock-left` + `.dock-left > .media-bin` + `.dock-left >
  .beat-panel` rules to the override section of `global.css`.
- [x] **T1.4** Update `.workspace` grid `gap` to 6px and `.workspace.has-bin`
  columns to `236px minmax(0, 1fr) 304px` (and the `rail-collapsed`
  variant accordingly).

## T2 — Pipeline strip status / tools split (B2)

- [x] **T2.1** In `Toolbar.tsx`, emit the status chips
  (`Accelerated`, `Client`, `COOP/COEP`, optional `PV`, optional fps) in
  the existing order at the start of `.pipeline-strip`.
- [x] **T2.2** Emit `<span class="pipeline-tools-divider"
  aria-hidden="true" />` after the status chips.
- [x] **T2.3** Emit the eight tool buttons (`Go Live`, `Cleanup`,
  `Captions`, `Translate`, `Reframe`, `Silence`, `Keys`, `Capabilities`,
  `Help`) each with `class="pipeline-chip pipeline-chip-button is-tool"`.
- [x] **T2.4** Shorten labels per the design doc
  (`COOP/COEP OK` → `COOP/COEP`, `Client compute` → `Client`,
  `Preview 720p` → `PV 720p`, `Encode 60 fps` → `60 fps`).
- [x] **T2.5** Add `.pipeline-tools-divider`, `.pipeline-chip.is-tool`,
  `.pipeline-chip.is-tool:hover`, `.pipeline-chip.is-tool.is-ok` rules
  to the override section.
- [x] **T2.6** Verify the `Go Live` button still drives
  `props.onOpenPublish` and shows `Live` while
  `props.publishLive === true`.

## T3 — Token rewrite at `:root` (B3)

- [x] **T3.1** Replace the existing `:root` block (lines ~11–111) with the
  precision-instrument token groups (surfaces, edges, type ramp, accent,
  signal).
- [x] **T3.2** Keep the shadcn token-bridge so existing rules continue to
  resolve (`--background`, `--card`, `--primary`, …).
- [x] **T3.3** Update the type ramp to integer-px values; update radii to
  2–6px; update `--toolbar-h`, `--status-h`, `--control-h`,
  `--icon-btn-w`.
- [x] **T3.4** Replace the body background-image with `none`; drop
  `background-attachment: fixed`; restore `line-height: 1.35`; add
  `font-feature-settings: 'ss01', 'cv11'` to DM Sans for the alternate
  glyphs.

## T4 — `--gradient-primary` is a real gradient (B4)

- [x] **T4.1** Change `--gradient-primary` to
  `linear-gradient(180deg, var(--cyan), color-mix(in oklab, var(--cyan),
  #000 10%))` so Tailwind `bg-[image:var(--gradient-primary)]` evaluates
  to a valid `background-image`.
- [x] **T4.2** Verify the empty-state import CTA renders with
  `background-color: rgb(34, 211, 238)` and dark text (`color: rgb(4,
  22, 26)`) — caught by inspecting `getComputedStyle(...).backgroundColor`
  in the browser preview.

## T5 — Instrument override section (B3, B5, B7)

- [x] **T5.1** Append a `/* === Precision-instrument redesign === */`
  fenced section at the tail of `global.css`.
- [x] **T5.2** Override `.workspace`, `.dock-left`, `.panel`,
  `.panel-title` (and the side-rail-panel duplicate hide), `.toolbar`,
  `.toolbar-main`, `.app-brand`, `.file-name`,
  `.transport-controls`/`.edit-controls`/`.master-mix`,
  `.pipeline-strip`/`.pipeline-chip` (status variant + `is-tool`),
  `.status-bar`/`.status-meta`/`.status-badge`/`.status-ok`,
  `.side-rail-tabs`/`.side-rail-tab(-bar)`/collapse/expand,
  `.preview`/`.preview-canvas`/`.preview-empty`,
  `.safe-area-toggle`/`.phase39-controls`, banner strips
  (`.restore-banner`, `.source-health-banner`), `.media-bin(-header
  -title -count -empty)`, `.beat-panel`.
- [x] **T5.3** Override `input[type='range']` (track + thumb) to a 2px
  ink track and a 12px cyan thumb with a 3px halo.
- [x] **T5.4** Override `*::-webkit-scrollbar*` to an 8px ink hairline.
- [x] **T5.5** Override `::selection` to cyan-on-ink.
- [x] **T5.6** Add a `pulse-live` keyframe + `is-tool.is-ok::before`
  vermillion dot for the active stream state.

## T6 — Inline-SVG reticle brand glyph (B4)

- [x] **T6.1** Replace `.app-glyph` background block + `::after` ring
  with a transparent square + `::before` that paints an inline-SVG
  reticle (outer circle, centre dot, four tick marks) as a data URL.
- [x] **T6.2** Set `.app-glyph { width: 28px; height: 28px; color:
  var(--cyan) }`. The SVG strokes use the literal `%2322d3ee` colour
  (URL-encoded `#22d3ee`) so the data URL is self-contained.
- [x] **T6.3** Update `.app-title` to JetBrains Mono uppercase; update
  `.app-kicker` to a smaller mono with elevated letter-spacing.
- [x] **T6.4** Rename the displayed brand to `LocalCut · 0.1 · Browser
  NLE` in `Toolbar.tsx` to match the steering doc's product name
  (`LocalCut Studio`).

## T7 — Side-rail tabs fit five labels (B6)

- [x] **T7.1** In the override section, set `.side-rail-tab` to
  `flex: 1 1 0; min-width: 0; padding: 0 2px;
  font-size: 9px; letter-spacing: 0.02em; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap`.
- [x] **T7.2** Verify in the browser that all five tabs report
  `truncated: false` and equal width (55px each at 1440×900 and
  1280×800).

## T8 — Quality gate

- [x] **T8.1** `pnpm exec tsgo --noEmit` → exit 0.
- [ ] **T8.2** `vp run check` (format / lint / typecheck / test / build)
  passes — **pending CI**.
- [ ] **T8.3** No `VideoFrame` lifecycle touched — visual inspection of
  the diff confirms this (no engine files changed).

## T9 — Manual verification

- [x] **T9.1** At 1440×900 the workspace renders dock 236 / preview 876
  / rail 304 (preview ≥60% of available width).
- [x] **T9.2** At 1280×800 the workspace renders dock 236 / preview 716
  / rail 304 (preview still dominant).
- [x] **T9.3** Toolbar emits the status chips, the divider, and the
  tool buttons in that order; status chips are sage when OK; tools
  hover cyan.
- [x] **T9.4** Brand glyph renders the reticle (verified via
  `getComputedStyle(.app-glyph, '::before').backgroundImage !== 'none'`).
- [x] **T9.5** Preview empty state shows the cyan eyebrow ("PREVIEW"),
  monospace title ("NO SOURCE LOADED"), cyan corner brackets, and a
  140×36 cyan IMPORT CTA.
- [x] **T9.6** All five side-rail tabs fit without truncation.
- [x] **T9.7** Status bar shows monospace technical readouts with
  hairline dividers; "COOP/COEP OK" carries a sage dot.
- [ ] **T9.8** Load a real clip end-to-end and verify the timeline +
  inspector loaded states inherit the new tokens cleanly — **pending
  user verification**.
- [ ] **T9.9** Verify on a limited tier (no WebGPU / no isolation) so
  the status chips and capability badges still read correctly —
  **pending user verification**.

## T10 — Out-of-scope drift flagged for follow-up

These were noticed during the work but are not addressed here. Each
deserves its own spec; see `design.md` § "Out-of-scope drift" for
context.

- [ ] **T10.1** Inspector subsection `<h2 class="panel-title">` cleanup:
  a content-level audit that removes the duplicate headings in every
  Inspector subsection, rather than the defensive
  `display: none` shim added under T5.2.
- [ ] **T10.2** Inspector typography hierarchy: distinguish section
  heads from field labels in the Inspector form ladder.
- [ ] **T10.3** Per-panel walkthrough at 1280×800 / 1440×900: export
  popover, bundle popover, audio-cleanup, ASR, smart-reframe,
  language-tools, render-queue. Each inherits the new tokens via the bridge
  but was not individually reviewed in this spec.

## T11 — Product Design polish follow-up

- [x] **T11.1** Narrow the duplicate title hide to direct panel children so
  nested side-rail headers (`Replay Buffer`, `Live Audio Chain`,
  `Voice Cleanup`) stay visible.
- [x] **T11.2** Default the side-rail `VoiceCleanupPanel` open to match the
  `ReplayBufferPanel` and `LiveAudioChainPanel` treatment, avoiding a sparse
  one-line cleanup tab.

## T12 — Review comment follow-up

- [x] **T12.1** Restate the narrow toolbar layout overrides after the final
  redesign block so sub-900px viewports keep the intended stacked toolbar.
- [x] **T12.2** Move the calibration grid from the unconditional preview
  pseudo-element into the empty preview background so loaded program images are
  not covered by the grid.
- [x] **T12.3** Restate the narrow status-bar overrides after the final
  redesign block so stacked status text and badges can expand vertically.
