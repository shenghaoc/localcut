# Design: Bugfix — Right sidebar panel stacking

This document maps each bug in `bugfix.md` to the concrete change and the
invariant the change protects. All edits stay within existing modules; no new
worker, message type, or rendering pass is introduced.

## D1 — Tabbed bottom section (B1, B3)

`src/ui/App.tsx`

A `SideRailTab` union type (`'replay' | 'live-audio'`) and a
`activeSideRailTab` signal replace the unconditional rendering of
`ReplayBufferPanel` and `LiveAudioChainPanel`. The panels are wrapped in a
`.side-rail-tabs` container with:

- A `.side-rail-tab-bar` containing two `<button role="tab">` elements.
- A `.side-rail-tab-content` area that conditionally renders the active panel
  via `<Show when={...}>>`.

The tab bar uses `role="tablist"` on the container and `role="tab"` +
`aria-selected` on each button for accessibility.

Why tabs and not accordion-one-at-a-time: tabs give a persistent visual
indication of which panel is active and avoid the jarring collapse/expand
animation when switching. The tab bar also scales cleanly when Voice Cleanup
is added as a third tab.

Why not a scrollable sidebar: scrolling hides the Inspector (the most-used
panel) off-screen when the user scrolls to the bottom. Tabs keep Inspector
and Captions always visible.

## D2 — Grid change from 4 rows to 3 (B1)

`src/global.css`

`.side-rail` changes from:

```css
grid-template-rows: minmax(170px, 1fr) minmax(180px, 0.8fr) auto auto;
```

to:

```css
grid-template-rows: minmax(170px, 1fr) minmax(180px, 0.8fr) minmax(0, 1fr);
```

The third row is now `minmax(0, 1fr)` — it grows to fill remaining space but
can shrink to zero. The tabbed container fills this row entirely.

The responsive breakpoint (max-width: 900px) changes from
`grid-template-rows: auto auto auto auto` to
`grid-template-rows: auto auto minmax(0, 1fr)`.

## D3 — Collapse-body height override (B2)

`src/global.css`

A new rule removes the `max-height` cap when the panel is inside the tabbed
container:

```css
.side-rail-tab-content .replay-buffer-panel .collapse-body,
.side-rail-tab-content .live-audio-chain-panel .collapse-body {
  max-height: none;
}
```

The panels inside `.side-rail-tab-content` also get `display: flex; flex-direction: column; height: 100%; overflow: visible` so they fill the tab
content area. The `.side-rail-tab-content` itself has `flex: 1; min-height: 0;
overflow: auto` to handle scrolling when the content exceeds the available
height.

## D4 — Tab bar styles

`src/global.css`

New CSS classes:

| Class | Purpose |
|---|---|
| `.side-rail-tabs` | Flex container wrapping tab-bar + content; `border: 1px solid var(--border); border-radius: var(--radius-lg)` |
| `.side-rail-tab-bar` | Horizontal flex row of tab buttons; `background: var(--bg-control)` |
| `.side-rail-tab` | Individual tab button; `flex: 1`, text-centered, `font-size: var(--text-xs)` |
| `.side-rail-tab.active` | Active tab indicator; `color: var(--primary); border-bottom: 2px solid var(--primary)` |
| `.side-rail-tab-content` | Flex-1 scrollable container for the active panel |

Focus indicators use `:focus-visible` with `outline: 2px solid var(--ring)`.

## D5 — Extensibility for Voice Cleanup (PR #72)

Adding Voice Cleanup as a third tab requires:

1. Extend `SideRailTab` to `'replay' | 'live-audio' | 'voice-cleanup'`.
2. Add a third `<button role="tab">` in the tab bar.
3. Add `<Show when={activeSideRailTab() === 'voice-cleanup'}>` around
   `<VoiceCleanupPanel>`.

No structural changes to the tab container or CSS are needed.

## D6 — Lint fixes (incidental)

Two pre-existing lint errors found during the build:

1. `case 'timeline-state':` in `App.tsx` had a `const` declaration without
   block braces — wrapped in `{}`.
2. `let terminateFallback` in the dispose path was never reassigned — changed
   to `const` by moving the `setTimeout` before the callback that references it.

These are not related to the layout fix but were required by the pre-commit
hook (`vp check --fix`).
