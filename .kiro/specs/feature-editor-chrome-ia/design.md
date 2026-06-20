# Design — Editor chrome information architecture

> Status: **Proposed**. Each Dn maps to Rn in [`requirements.md`](./requirements.md). Code anchors are current as of branch `claude/laughing-colden-c29248`. The guiding move is the audit's: **consolidate by user job, give every nav control one honest behavior, and never hide primary navigation behind a scrollbar.**

## Target information architecture

The audit's proposed reorganization, adopted as the design target:

**Top menu bar** (`Toolbar.tsx` `MENU_GROUPS`) — the command taxonomy:

| Menu | Commands (implemented only) |
| --- | --- |
| Project | New, Import, Project bundle, Collect media, Export |
| Edit | Undo, Redo, Delete, split/ripple/roll editing |
| Clip | clip-specific operations only |
| Timeline | snapping, beat grid, tracks, markers, safe areas |
| View | layout, panels, scopes, overlays (NOT Browser capabilities) |
| Help | User guide, Browser capabilities, Diagnostics |

**Top toolbar** — frequent actions + status only: Import, Undo/Redo, Transport, Timecode, Snap/Beat toggles, master level, Export. The long launcher strip ([`Toolbar.tsx:664-740`](../../../src/ui/Toolbar.tsx): Cleanup, Captions, Translate, Reframe, Silence, Capabilities, Help) is removed/collapsed; infrequent tools move to the palette (⌘K) and menus.

**Left rail** — Option B (library/source): `Media`, `Beats`, optionally `Project` (see D2).

**Right rail** — ≤4 contextual destinations: `Inspector`, `Text`, `Audio`, `Capture`; the current seven become secondary segmented controls *inside* these (see D5).

## D1 — Right-rail navigation that fits (R1)

**Root cause.** `SIDE_RAIL_TABS` ([`App.tsx:354-362`](../../../src/ui/App.tsx)) has seven entries; the tab bar (`.side-rail-tab-bar`) is `display:flex; overflow-x:auto` with a hidden/thin scrollbar ([`global.css:6834-6845`](../../../src/global.css), plus duplicate definitions at `2240`, `7854`). 374px of tabs in a ~302px rail ⇒ scroll, clip, and strip-shift on activation.

**Fix (preferred — fold into ≤4 jobs, D5 does the grouping):** reduce `SIDE_RAIL_TABS` to the four job destinations. Four short labels (`Inspector`, `Text`, `Audio`, `Capture` ≈ 62+40+44+58 ≈ 204px) fit 302px with margin ⇒ **remove `overflow-x: auto` from `.side-rail-tab-bar`** entirely (no scrollable primary nav). Within a destination, use a secondary segmented control (e.g. `Capture` → `Record | Program | Replay`) that itself fits or wraps.

**Fallback (if the four-tab regroup is deferred):** if any overflow remains, replace the hidden-scrollbar pattern with a **visible overflow menu** (an Ark `Menu` "⋯ More" trigger that lists the off-strip tabs) so no destination is silently hidden. Do **not** keep `overflow-x:auto` + hidden scrollbar for primary navigation — same rule applied to the media bin in bugfix B9.

Either way: delete the redundant `.side-rail-tab-bar` rule blocks so one definition governs (the duplicate-rule trap that caused the workspace overlap, bugfix B6, also exists here).

## D2 — Left rail: one honest behavior (R2)

Today `.dock-rail` ([`App.tsx:4299-4334`](../../../src/ui/App.tsx)) mixes: `Project`→import picker, `Media`→**no handler**, `Record`/`Captions`→`openSideRailTab(...)` (switches the *right* rail), `Scopes`→toggle floating overlay, `AI`→`setAsrPanelOpen`, `Reframe`→`setSmartReframeOpen`, `Output`→`scrollIntoView`.

**Design (Option B — recommended):** demote the left rail to a **library/source switcher** only:

- Keep `Media` and `Beats` as the two left-dock sections (they already render in `.dock-library`); make each actually switch the dock content (or, if only Media/Beats exist, drop the rail to a simple header toggle).
- Move the workflow launchers off the rail: `Record`/`Captions`/`Program`/`Replay`/`AI`/`Reframe`/`Silence` become commands in the **command palette** and the relevant **menus** (Clip/Timeline/View), and/or open their right-rail `Capture`/`Text`/`Audio` destination (D5). `Scopes` belongs under `View`. `Project`/`Output` (import/export) belong in the `Project` menu and the toolbar.
- Remove dead controls (the no-handler `Media` button) and the status-bar picker-failure side effect (route import errors through the existing recent-error log, not the status line).

**Why Option B over A (full dock switcher):** the left dock today only has Media + Beats content; a six-destination dock switcher (Effects/Text/Audio/Capture/Export) implies building five new left-dock panels — a much larger surface. Option B fixes the dishonest-nav problem now; a dock switcher can be a follow-up if those panels materialise.

## D3 — Audio cleanup disambiguation (R3)

Three nearby concepts: right-rail `Audio` (live chain, `live-audio` tab), right-rail `Cleanup` (`voice-cleanup` tab → Voice Cleanup), top-toolbar `Cleanup` ([`Toolbar.tsx:667`](../../../src/ui/Toolbar.tsx) → `onOpenAudioCleanup`, the Local Audio Cleanup selected-clip sheet).

**Design:**

- Right-rail live chain stays **`Audio`**.
- Fold Voice Cleanup under the **`Audio`** destination as a secondary control (D5), or rename the tab to **`Voice FX`** / **`Voice Chain`** — never a bare `Cleanup`.
- The top-toolbar selected-clip action is renamed **`Audio Cleanup`** (it already opens the per-clip cleanup workflow) and only enabled when a clip is selected; it does not collide with the right-rail `Audio`.
- Net: exactly one surface per label. (Note: bugfix B8 already removed the misleading "Noise Suppression — future update" insert; this completes the audio-labelling cleanup.)

## D4 — Menu taxonomy, no duplicate access (R4)

In [`Toolbar.tsx`](../../../src/ui/Toolbar.tsx):

- Every menu group appends `{ id: 'palette', label: 'Search actions…' }` (lines 251, 267, 283, 302, 311, 320). **Remove** it from each menu; keep the single `command-search` Popover trigger ([`:416`](../../../src/ui/Toolbar.tsx)) as the one palette affordance.
- `Browser capabilities` exists both under `View` ([`:309`](../../../src/ui/Toolbar.tsx)) and as a top-strip `Capabilities` chip ([`:726`](../../../src/ui/Toolbar.tsx)). Keep it in **one** place — under `Help` (with Diagnostics) — and drop the duplicate.
- `Help` is both a menu and a top-strip chip ([`:735`](../../../src/ui/Toolbar.tsx)); keep the menu, drop the chip.
- Collapse the launcher strip ([`:664-740`](../../../src/ui/Toolbar.tsx)) to frequent actions; route Cleanup/Captions/Translate/Reframe/Silence through the palette + their right-rail destinations.

## D5 — Right rail by job (R5)

Replace `SIDE_RAIL_TABS` (7) with four job destinations, each holding the former tabs as secondary segmented controls:

| Destination | Holds (secondary control) |
| --- | --- |
| `Inspector` | contextual clip properties (unchanged) |
| `Text` | Captions + translation/copy tools |
| `Audio` | live chain + Voice FX (+ selected-clip cleanup entry) |
| `Capture` | Record · Program · Replay · go-live/WHIP setup |

`isSideRailTab`, `openSideRailTab`, the persisted `SIDE_RAIL_COLLAPSED_KEY`, and the keyboard map that references tab ids must be updated together. The secondary segmented control is a small in-panel `Tabs`/segmented group (fits the 302px rail; wraps if needed). This subsumes D1 (four labels fit, so the scroll pattern is removed, not merely hidden).

## D6 — Beat Detection home (R6)

`BeatPanel` currently sits as a fixed companion under `MediaBin` in `.dock-library` ([`App.tsx:4359`](../../../src/ui/App.tsx)) with `Beat` snapping in the transport. **Design:** present Beats as a **Media Analysis** sub-section that appears when an audio source is selected, and link its state to the transport `Beat`-snap toggle (shared signal) with a one-line "snapping uses these beats" affordance. If the left rail becomes a `Media`/`Beats` switcher (D2), `Beats` is that destination.

## D7 — Compact unavailable states (R7)

`RecordPanel` and `ProgramPanel` render the full `captureUnavailableReasons(probe)` list in the primary body (bugfix B4/D4 made the list accurate and exhaustive). **Design:** collapse it to a **one-line status chip** ("Recording unavailable — 2 requirements") with the full list behind a `<details>`/disclosure (reuse the diagnostics styling), and keep a primary call-to-action (e.g. "Open Diagnostics", or the flag hint for transferable-track). The reason data and copy are unchanged — only the density.

## Rollout

Recommended **incremental** order (each independently shippable, smallest blast radius first):

1. **D4** (menu/toolbar dedupe) + **D3** (audio labels) + **D7** (compact unavailable) — copy/labelling/density, no nav restructure.
2. **D1** (remove hidden-scroll right-rail nav) via **D5** (four job destinations + secondary controls).
3. **D2** (left rail → library switcher) + **D6** (Beats home).

Each step keeps `pnpm run check` green and updates the affected `__browser__` component tests + any keyboard-map tests that reference tab ids.
