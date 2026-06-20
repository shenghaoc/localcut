# Tasks — Editor chrome information architecture

> Status: **Proposed** (not started). Tasks map to requirements (Rn) in [`requirements.md`](./requirements.md) and design (Dn) in [`design.md`](./design.md). Ordered by the design's incremental rollout — Phase 1 is copy/labelling/density (low risk), Phase 2 restructures the right rail, Phase 3 the left rail. Resolve the three **Open decisions** in requirements.md before Phase 2/3.

## Phase 1 — Labels, dedupe, density (no nav restructure)

### T1 — Menu/toolbar dedupe (R4, D4)

- [ ] T1.1 Remove the per-menu `{ id: 'palette', label: 'Search actions…' }` items from each `MENU_GROUPS` entry in [`Toolbar.tsx`](../../../src/ui/Toolbar.tsx) (lines ~251/267/283/302/311/320); keep the single `command-search` Popover trigger (~416).
- [ ] T1.2 Move `Browser capabilities` to a single home under `Help` (with Diagnostics); remove it from `View` (~309) and the top-strip `Capabilities` chip (~726).
- [ ] T1.3 Remove the top-strip `Help` chip (~735); keep the `Help` menu.
- [ ] T1.4 Collapse the launcher strip (~664–740): keep only frequent actions; route Cleanup/Captions/Translate/Reframe/Silence to the palette + their right-rail destinations.
- [ ] T1.5 Update `Toolbar` component tests / snapshots for the new menu + strip contents.

### T2 — Audio cleanup disambiguation (R3, D3)

- [ ] T2.1 Rename the top-toolbar `Cleanup` action to **`Audio Cleanup`** and gate it on a selected clip ([`Toolbar.tsx:667`](../../../src/ui/Toolbar.tsx)).
- [ ] T2.2 Rename the right-rail `voice-cleanup` tab label from `Cleanup` to `Voice FX` (or fold under `Audio` per D5/T4); ensure no bare `Cleanup` label remains on any surface.
- [ ] T2.3 Verify the three audio surfaces (`Audio` live chain, Voice FX, Audio Cleanup sheet) each map to one destination; add/adjust a test asserting label uniqueness if practical.

### T3 — Compact unavailable states (R7, D7)

- [ ] T3.1 In [`RecordPanel.tsx`](../../../src/ui/RecordPanel.tsx) and [`ProgramPanel.tsx`](../../../src/ui/ProgramPanel.tsx), collapse the `captureUnavailableReasons(probe)` body list into a one-line status chip + `<details>`/disclosure; keep a primary call-to-action.
- [ ] T3.2 Reuse existing diagnostics/disclosure styling; no change to reason data/copy (from bugfix B4/D4).
- [ ] T3.3 Update the affected `__browser__` panel tests.

## Phase 2 — Right rail by job (R1, R5, D1, D5)

### T4 — Collapse seven tabs to four job destinations

- [ ] T4.1 Replace `SIDE_RAIL_TABS` ([`App.tsx:354`](../../../src/ui/App.tsx)) with `Inspector`, `Text`, `Audio`, `Capture`; update `SideRailTab`, `isSideRailTab`, `openSideRailTab`, `readSideRailCollapsed`/`SIDE_RAIL_COLLAPSED_KEY`, and any keyboard-map entries that reference tab ids.
- [ ] T4.2 `Text` destination hosts Captions + translation/copy (former `captions` + language tools); `Capture` hosts Record · Program · Replay · go-live via a secondary segmented control; `Audio` hosts live chain + Voice FX.
- [ ] T4.3 Add the in-panel secondary segmented control (small `Tabs`/segmented group) for destinations that hold multiple sub-surfaces; ensure it fits/wraps within ~302px.
- [ ] T4.4 **Remove `overflow-x: auto` + hidden scrollbar from `.side-rail-tab-bar`** and delete the duplicate `.side-rail-tab-bar` rule blocks in [`global.css`](../../../src/global.css) (~2240, ~6834, ~7854) so one definition governs. Four labels fit without scrolling.
- [ ] T4.5 If any overflow remains (fallback), add a **visible** "⋯ More" overflow menu instead of a hidden scroll region.
- [ ] T4.6 Update App / right-rail browser tests and keyboard tests; migrate the persisted collapsed-key value safely (old tab ids → new).

### T5 — Verify right-rail fit

- [ ] T5.1 Measure at 1280×720: all four destinations fully visible/clickable; activating any one does not clip another; no `overflow-x` scroll on the tab bar.

## Phase 3 — Left rail + Beats (R2, R6, D2, D6)

### T6 — Left rail → library switcher (Option B)

- [ ] T6.1 Reduce `.dock-rail` ([`App.tsx:4299`](../../../src/ui/App.tsx)) to library/source destinations (`Media`, `Beats`); make each actually switch `.dock-library` content (or replace the rail with a header toggle if only two).
- [ ] T6.2 Remove the dead `Media` no-handler button; move workflow launchers (`Record`/`Captions`/`Program`/`Replay`/`AI`/`Reframe`) to the palette/menus and/or their right-rail destinations; move `Scopes` under `View`; route `Project`/`Output` import/export to the `Project` menu + toolbar.
- [ ] T6.3 Route import/picker failures through the recent-error log, not the status line.

### T7 — Beat Detection home (R6, D6)

- [ ] T7.1 Present `BeatPanel` as a Media-Analysis sub-section shown when an audio source is selected (or as the left-rail `Beats` destination from T6).
- [ ] T7.2 Link Beats state to the transport `Beat`-snap toggle (shared signal) with a one-line affordance explaining the relationship.

## Quality gate (every phase)

- [ ] G1 `pnpm run check` green (format + lint + typecheck + Vitest + build).
- [ ] G2 Test count does not decrease; updated component/keyboard tests reflect the new IA.
- [ ] G3 Existing ARIA roles (`role="tab"`/`tabpanel`/`region`) remain correct after restructure.
- [ ] G4 Re-run the audit captures (or a focused subset) at 1280×720 to confirm each finding is resolved.

## Out of scope (tracked elsewhere)

- [ ] Full accessibility pass (keyboard/screen-reader/responsive) — separate spec per the audit's Limits section.
- [ ] New left-dock panels for a full dock-switcher (Option A) — only if those surfaces are built.
