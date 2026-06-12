# Tasks: Bugfix — Right sidebar panel stacking

> Status: **Active**. Tasks map to the bugs in `bugfix.md` and the design in
> `design.md`. Tracks the work on `fix/side-rail-tabs` (PR #81).

## T1 — Tab state and container (B1, B3)

- [x] **T1.1** In `App.tsx`, add `type SideRailTab = 'replay' | 'live-audio'`
  and a `const [activeSideRailTab, setActiveSideRailTab] =
  createSignal<SideRailTab>('replay')`.
- [x] **T1.2** Wrap `ReplayBufferPanel` and `LiveAudioChainPanel` in a
  `<div class="side-rail-tabs">` container.
- [x] **T1.3** Add a `<div class="side-rail-tab-bar" role="tablist">` with two
  `<button role="tab">` elements for Replay Buffer and Live Audio Chain.
- [x] **T1.4** Wrap each panel in `<Show
  when={activeSideRailTab() === '...'}>` so only the active tab renders.

## T2 — Grid layout change (B1)

- [x] **T2.1** In `global.css`, change `.side-rail` `grid-template-rows` from
  `minmax(170px, 1fr) minmax(180px, 0.8fr) auto auto` to
  `minmax(170px, 1fr) minmax(180px, 0.8fr) minmax(0, 1fr)`.
- [x] **T2.2** Update the responsive breakpoint (max-width: 900px) from
  `grid-template-rows: auto auto auto auto` to
  `grid-template-rows: auto auto minmax(0, 1fr)`.

## T3 — Collapse-body height override (B2)

- [x] **T3.1** In `global.css`, add
  `.side-rail-tab-content .collapse-body { max-height: none }` to remove the
  280px cap inside the tabbed container.
- [x] **T3.2** Add `.side-rail-tab-content .replay-buffer-panel,
  .side-rail-tab-content .live-audio-chain-panel` rules for `display: flex;
  flex-direction: column; height: 100%; overflow: visible`.
- [x] **T3.3** Add `.side-rail-tab-content` rule for `flex: 1; min-height: 0;
  overflow: auto`.

## T4 — Tab bar styles (B3)

- [x] **T4.1** Add `.side-rail-tabs` styles (flex column, border, border-radius,
  overflow hidden).
- [x] **T4.2** Add `.side-rail-tab-bar` styles (flex row, border-bottom,
  background).
- [x] **T4.3** Add `.side-rail-tab` styles (flex: 1, padding, font-size, cursor,
  transition).
- [x] **T4.4** Add `.side-rail-tab.active` styles (color: primary, border-bottom
  indicator).
- [x] **T4.5** Add `.side-rail-tab:focus-visible` styles (outline indicator).

## T5 — Lint fixes (incidental)

- [x] **T5.1** Wrap `case 'timeline-state':` body in `{}` to fix
  `no-case-declarations` lint error.
- [x] **T5.2** Use mutable ref object for `terminateFallback` to avoid TDZ and
  satisfy `prefer-const`.

## T6 — Review fixes (Gemini round 1)

- [x] **T6.1** Inline `SideRailTab` type into `createSignal` call.
- [x] **T6.2** Add full ARIA tab/tabpanel attributes (`id`, `aria-controls`,
  `role="tabpanel"`, `aria-labelledby`).
- [x] **T6.3** Fix undefined CSS variable `var(--bg)` → `var(--bg-panel)`.

## T6b — Review fixes (Gemini round 2)

- [x] **T6b.1** Use SolidJS `classList` instead of string interpolation for tab
  button classes.
- [x] **T6b.2** Replace `display: contents` on `role="tabpanel"` with
  `.side-rail-tab-panel` CSS class (display:contents strips semantic roles from
  the a11y tree).
- [x] **T6b.3** Add `.side-rail-tab-panel` CSS class.

## T6c — Review fixes (Claude)

- [x] **T6c.1** Add `initiallyExpanded` prop to `ReplayBufferPanel` and
  `LiveAudioChainPanel`; pass `true` from tab content so panels show content
  immediately (P1: panels started collapsed, requiring double-click).
- [x] **T6c.2** Add roving tabindex (`active=0`, `inactive=-1`) and
  ArrowLeft/Right keyboard navigation to tab buttons (P1: WAI-ARIA APG tabs
  pattern).
- [x] **T6c.3** Add transparent baseline border to `.side-rail-tab` to prevent
  2px layout shift on activation.
- [x] **T6c.4** Remove redundant `overflow: visible` on panels inside
  `overflow: auto` container.

## T7 — Build and test gate

- [x] **T7.1** `vp build` passes (strict TypeScript).
- [x] **T7.2** `vp test run` passes — 97 files, 1032 tests green (no decrease).
- [x] **T7.3** Pre-commit hook (`vp check --fix`) passes.

## T8 — Manual verification

- [ ] **T8.1** Open the editor, expand Replay Buffer — Inspector and Captions
  retain their full height.
- [ ] **T8.2** Switch to Live Audio Chain tab — Replay Buffer is hidden, Live
  Audio Chain fills the same space.
- [ ] **T8.3** Expand Gate/Limiter controls inside Live Audio Chain — the
  collapse-body scrolls internally instead of being capped at 280px.
- [ ] **T8.4** Tab buttons are keyboard-navigable (Tab/Enter/Space) with visible
  focus indicators.
- [ ] **T8.5** On the Phase 36 branch, rebase and add Voice Cleanup as a third
  tab — verify all 3 tabs switch correctly.

## T9 — Full-rail tab model (short-viewport follow-up)

The partial-tab layout still squeezed the tab row below usability on ~790px-tall
viewports (13" laptops). Promote the tab model to the entire rail.

- [x] **T9.1** All four panels (Inspector, Captions, Replay, Audio) are tabs;
  one visible at a time, each gets the full rail height.
- [x] **T9.2** Auto-switch: selecting a clip/transition fronts Inspector
  (keyed on selection identity, not the recreated memo object); caption import
  fronts Captions.
- [x] **T9.3** Rail collapse toggle (`›`/`‹`) reclaims the 320px column for
  preview/timeline; state persists via `localStorage`.
- [x] **T9.4** Panels inside the tab container drop their card chrome
  (border/radius/shadow) to avoid double borders.
- [x] **T9.5** Stacked (≤900px) layout pins the tab container to 380px; the
  collapsed-rail expand strip renders as a full-width bar.
- [x] **T9.6** Roving tabindex generalized to N tabs with wrap-around
  ArrowLeft/ArrowRight.
- [x] **T9.7** `docs/USER-GUIDE.md` Side Panel section documents tabs,
  auto-switch, and collapse.
- [x] **T9.8** Build + 1032 tests green; verified in-browser at 1440×790 and
  375×812.
