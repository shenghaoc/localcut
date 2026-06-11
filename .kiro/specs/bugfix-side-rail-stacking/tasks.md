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
- [x] **T5.2** Change `let terminateFallback` to `const` by reordering the
  `setTimeout` before the callback.

## T6 — Build and test gate

- [x] **T6.1** `vp build` passes (strict TypeScript).
- [x] **T6.2** `vp test run` passes — 97 files, 1032 tests green (no decrease).
- [x] **T6.3** Pre-commit hook (`vp check --fix`) passes.

## T7 — Manual verification

- [ ] **T7.1** Open the editor, expand Replay Buffer — Inspector and Captions
  retain their full height.
- [ ] **T7.2** Switch to Live Audio Chain tab — Replay Buffer is hidden, Live
  Audio Chain fills the same space.
- [ ] **T7.3** Expand Gate/Limiter controls inside Live Audio Chain — the
  collapse-body scrolls internally instead of being capped at 280px.
- [ ] **T7.4** Tab buttons are keyboard-navigable (Tab/Enter/Space) with visible
  focus indicators.
- [ ] **T7.5** On the Phase 36 branch, rebase and add Voice Cleanup as a third
  tab — verify all 3 tabs switch correctly.
