# Requirements — Editor chrome information architecture

> Status: **Proposed**. Source: [`audits/editor-chrome-panels-2026-06-20/audit.md`](../../../audits/editor-chrome-panels-2026-06-20/audit.md) (visual + DOM-rect + code audit at 1280×720). This spec turns that audit's seven findings and proposed reorganization into actionable requirements. It is an **IA/navigation** effort — distinct from [`bugfix-capability-probe-and-editor-overlap`](../bugfix-capability-probe-and-editor-overlap/bugfix.md), which fixed the workspace-grid overlap and media-bin overflow. Where the two touch the same anti-pattern (hidden horizontal scrollbars on a primary nav surface), this spec references it.

## Problem

The editor exposes the same concepts through **three competing navigation systems** with overlapping, differently-labelled entry points:

- **Left rail** (`.dock-rail`, [`App.tsx:4299`](../../../src/ui/App.tsx)) — styled like persistent workspace tabs, but the buttons fire mixed actions (import picker, right-rail switches, floating overlays, modals, scroll-into-view; `Media` has no handler at all).
- **Top menu + top toolbar strip** ([`Toolbar.tsx:245`, `:664`](../../../src/ui/Toolbar.tsx)) — sparse menus that each end in `Search actions…`, plus a long launcher strip that duplicates menu items (`Browser capabilities`, `Help`).
- **Right rail** (`SIDE_RAIL_TABS`, [`App.tsx:354`](../../../src/ui/App.tsx)) — seven text tabs (Inspector, Captions, Record, Program, Replay, Audio, Cleanup) crammed into a ~302px panel.

The result is not learnable: e.g. **`Cleanup`** in the top toolbar opens *Local Audio Cleanup* as a full-height sheet, while **`Cleanup`** in the right rail means *Voice Cleanup*; a third nearby concept *`Audio`* is the live chain.

### Measured evidence (1280×720)

- Right rail panel: x≈971, width≈302px. The seven tab labels measure 62+59+50+56+48+44+55 = **374px** — ~72px wider than the rail. `.side-rail-tab-bar` has `overflow-x: auto` with a hidden/thin scrollbar ([`global.css:6834`](../../../src/global.css)).
- Activating `Cleanup` scrolls the strip left so `Cleanup` (right=1273) shows but `Inspector` moves to x=901 — **off the rail's left edge (971)** and clipped. (`cleanup-tab-attempt.json`.)
- `Audio` (x=1174–1218) and `Cleanup` (1218–1273) sit at/over the right edge in the default state; the audit notes a max button right of 1497 beyond the 1280 viewport.

## Requirements

### R1 — Right-rail navigation fits and is stable

- The right rail's top-level navigation MUST fit its panel width at the default 1280×720 viewport with **no horizontally-scrolled, clipped, or hidden** top-level destinations.
- Switching a destination MUST NOT shift the tab strip such that a previously-visible destination becomes clipped.
- Acceptance: at 1280×720 every top-level right-rail destination is fully visible and clickable; no top-level nav relies on a hidden-scrollbar `overflow-x` region. (Same anti-pattern this project already removed for the media bin — see bugfix B9.)

### R2 — Left rail has one consistent behavior

- The left rail MUST be **either** true dock navigation (every item owns/swaps the left-dock content) **or** a clearly-styled command launcher (grouped commands that visibly differ from persistent tabs) — not a mix.
- No left-rail control may be a dead label (today `Media` has no handler), and none may silently switch a *different* surface (today `Record`/`Captions` switch the right rail; `Scopes` toggles a floating overlay; `AI`/`Reframe` open modals; `Project` opens the file picker and can leave a picker-failure message in the status bar).
- Acceptance: each left-rail control's behavior matches its visual affordance; clicking any of them produces a visible change in the surface it appears to own.

### R3 — One concept, one label (audio cleanup disambiguation)

- The bare label **`Cleanup`** MUST NOT appear on two surfaces meaning different things. Audio concepts (`Audio` live chain, `Cleanup`/Voice Cleanup, top-toolbar Local Audio Cleanup) MUST be named and grouped so each label maps to exactly one surface.
- Acceptance: searching the UI for "Cleanup" yields a single, unambiguous destination; the right-rail live-audio surface and the selected-clip cleanup workflow are distinctly named.

### R4 — Menu bar is the taxonomy; toolbar is the frequent-action strip; no duplicate access

- Capability info and Help MUST each have **one** home; `Browser capabilities` MUST NOT appear under both `View` and a toolbar chip, and `Help` MUST NOT be both a menu and a toolbar chip.
- The repeated `Search actions…` item MUST be removed from each menu (or demoted to a single palette shortcut hint), not duplicated in every menu.
- The top toolbar's long tool-launcher strip MUST be reduced to frequent actions; infrequent tools are reachable via the command palette / menus.
- Acceptance: no command is reachable from more than one redundant top-chrome surface; menus contain real, implemented commands.

### R5 — Right rail is organized by job, not feature name

- Right-rail top-level destinations MUST group by user job (properties / text / audio / capture), with secondary controls inside each destination — not one flat tab per feature.
- Capture-class surfaces (`Record`, `Program`, `Replay`, go-live) MUST live together, not interleaved with the contextual `Inspector`.
- Acceptance: the right rail presents at most ~4 stable top-level destinations; capture workflows are grouped.

### R6 — Beat Detection has a clear home

- Beat Detection MUST be presented as part of a clearly-named analysis/timing context (e.g. media analysis when an audio source is selected, or an Audio/Timing panel) and its relationship to transport `Beat` snapping MUST be explicit.
- Acceptance: a user can tell what Beat Detection is for and how it connects to beat snapping.

### R7 — Unavailable states are compact, not dominant

- For unavailable features (e.g. Record/Program on an unsupported profile), the primary panel body MUST show a **compact** status with the full browser/flag reasons behind a details disclosure or tooltip — and still surface what the user *can* do next — rather than filling the panel with reason lists.
- Acceptance: an unavailable Record/Program panel shows a one-line status + disclosure, not a full-body reason dump. (Builds on the accurate-reason work in bugfix B4/D4.)

## Non-goals

- Full accessibility certification (keyboard map, screen-reader announcements) — the audit explicitly scopes that to a separate pass. This spec keeps existing ARIA roles correct but does not claim WCAG conformance.
- Rebuilding the underlying features (capture, voice cleanup, captions, reframe) — this is navigation/labelling/layout only.
- Changing the dark precision-instrument visual language — IA, not theme.
- Mobile/responsive redesign beyond keeping the existing single-column collapse honest.

## Open decisions (resolve during design review)

1. **Left rail direction (R2):** Option A — true dock switcher (`Media`, `Effects`, `Text`, `Audio`, `Capture`, `Export`, each swaps the left dock); Option B — reduce to library/source only (`Media`, `Beats`, maybe `Project`) and move workflow launchers to the palette/menus. The audit leans toward making it *one* of these; design proposes **Option B** as lower-risk (see design D2).
2. **Right-rail destination set (R5):** the audit proposes `Inspector`, `Text`, `Audio`, `Capture`. Confirm whether `Captions`→`Text` and the `Record`/`Program`/`Replay`→`Capture` grouping is acceptable.
3. Whether the consolidation ships incrementally (R1/R3/R4/R7 first, then R2/R5/R6) or as one redesign PR — design recommends incremental.
