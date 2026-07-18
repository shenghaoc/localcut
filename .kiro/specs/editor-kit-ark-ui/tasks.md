# Tasks: Editor Kit Ark UI Refresh

> Status: **Implementation complete.** Unchecked manual browser-verification
> items remain recorded honestly; current visual-token and responsive
> verification is tracked in
> [`feature-design-system-foundation`](../feature-design-system-foundation/tasks.md).

## T1 — Add Ark UI

- [x] **T1.1** Add `@ark-ui/solid`.
- [x] **T1.2** Verify Ark exports for `popover` and `tabs` are available through package subpaths.

## T2 — Retire Solid UI Button Stack

- [x] **T2.1** Replace `src/ui/components/button.tsx` with a native button wrapper.
- [x] **T2.2** Preserve existing `variant` and `size` call-site API.
- [x] **T2.3** Replace CVA output with local `button-variant-*` and `button-size-*` classes.
- [x] **T2.4** Replace `cn()` with a dependency-free helper.
- [x] **T2.5** Remove `@kobalte/core`, `class-variance-authority`, `clsx`, and `tailwind-merge`.

## T3 — Migrate Popovers to Ark

- [x] **T3.1** Migrate `ExportDialog` from Kobalte Popover to Ark Popover.
- [x] **T3.2** Migrate `BundleDialog` from Kobalte Popover to Ark Popover.
- [x] **T3.3** Migrate `InterchangeMenu` from Kobalte Popover to Ark Popover.
- [x] **T3.4** Migrate `MediaBin` file-details popover from Kobalte Popover to Ark Popover.
- [ ] **T3.5** Browser-verify each popover opens, closes, restores focus, and remains correctly positioned.

## T4 — Migrate Side Rail Tabs to Ark

- [x] **T4.1** Add Ark Tabs to `App.tsx`.
- [x] **T4.2** Remove manual side-rail arrow/Home/End keyboard handler.
- [x] **T4.3** Keep `activeSideRailTab` as the app-owned selected-tab signal.
- [x] **T4.4** Preserve programmatic tab switches from clip selection, captions messages, and retake flow.
- [ ] **T4.5** Browser-verify pointer and keyboard tab switching.

## T5 — Implement PPTX Chrome

- [x] **T5.1** Change toolbar to menu row, command row, and pipeline row.
- [x] **T5.2** Add functional command-search Ark popover.
- [x] **T5.3** Add source-format and timecode readouts to the toolbar.
- [x] **T5.4** Add Snap/Ripple segmented toggle styling.
- [x] **T5.5** Add left dock rail inside `.dock-left`.
- [x] **T5.6** Keep `.dock-left`, `.preview.panel`, `.side-rail` as the workspace's three outer children.

## T6 — CSS Token and Chrome Updates

- [x] **T6.1** Set `--toolbar-h` to the full 112px header height.
- [x] **T6.2** Replace stale Solid UI token-bridge comments.
- [x] **T6.3** Add native button variant CSS.
- [x] **T6.4** Add PPTX-specific toolbar, command popover, dock rail, workspace, preview, and Ark tab overrides.
- [x] **T6.5** Keep styling in `global.css`; no CSS-in-JS.

## T7 — Verification

- [x] **T7.1** `vp run typecheck`.
- [x] **T7.2** `vp run check` when time/runtime permits.
- [x] **T7.3** Confirm `rg "@kobalte|class-variance-authority|clsx|tailwind-merge" src package.json` returns no active source/package usage.
- [ ] **T7.4** Manual desktop browser QA at 1440×900 and 1280×800.

## T8 — Pull Request

- [x] **T8.1** Commit the scoped migration.
- [x] **T8.2** Push the branch.
- [x] **T8.3** Open a draft PR with a concise title and Markdown description.
