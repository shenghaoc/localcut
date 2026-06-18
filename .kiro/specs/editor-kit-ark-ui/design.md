# Design: Editor Kit Ark UI Refresh

This spec implements the single-slide `editor-kit-demo.pptx` as the app's production editor chrome. It is a UI-shell migration only: worker protocols, media engine modules, and frame lifetimes are unchanged.

## D1 — Chrome Layout

`Toolbar.tsx` becomes a three-row header:

- `.toolbar-menu` — brand, top menu buttons, command search.
- `.toolbar-main` — import, source readout, source format, edit/transport controls, timecode, Snap/Ripple toggles, master meter, export/interchange/bundle controls.
- `.pipeline-strip` — capability and tool chips.

`global.css` sets `--toolbar-h: 112px` so preview sizing subtracts the full header height.

## D2 — Left Dock

`App.tsx` keeps one `<aside class="dock-left">` child in the workspace grid, then splits it internally:

```tsx
<aside class="dock-left" aria-label="Library">
  <nav class="dock-rail" aria-label="Workspace sections">...</nav>
  <div class="dock-library">
    <MediaBin ... />
    <BeatPanel ... />
  </div>
</aside>
```

This matches the PPTX's left vertical section rail without regressing the three-child workspace invariant.

## D3 — Ark Primitives

Kobalte popovers are replaced one-for-one:

- `ExportDialog`
- `BundleDialog`
- `InterchangeMenu`
- `MediaBin` details popover

Each uses Ark `Popover.Root` with `positioning` and direct `Popover.Trigger` buttons. `ExportDialog` guards close while exporting through the existing controlled-open handler.

The right rail replaces custom tab keyboard handling with Ark Tabs. The selected tab still flows through `activeSideRailTab`; Ark owns roles, selection attributes, and arrow-key behavior.

## D4 — Shared Button

`src/ui/components/button.tsx` becomes a native wrapper:

- Existing props: `variant`, `size`, `class`, normal button attributes.
- Output classes: `button`, `button-variant-*`, `button-size-*`.
- Default `type="button"` to avoid accidental form submission.

The old CVA/Kobalte implementation is removed. Styling lives in `global.css`, keeping the project on vanilla CSS.

## D5 — Command Search

The command search is an Ark popover, not a visual placeholder. It exposes working commands:

- Import media
- Play/Pause
- Go live
- Auto captions
- Smart reframe
- Capabilities
- User guide

Unavailable commands render disabled through the same conditions used by toolbar buttons.

## D6 — Styling

The final CSS pass appends an "Editor-kit PPTX + Ark UI migration" section:

- Native button variants.
- Deck-like menu/header rows.
- Command popover styling.
- Fixed 364px left dock (`66px` rail + library), fluid preview, 360px inspector rail.
- Ark tab selected states.
- Popover z-index and dense mono readouts.

No CSS-in-JS, runtime style injection, or component-library theme runtime is introduced.

## D7 — Non-Goals

- No new command-palette search index.
- No new app router or page.
- No engine, protocol, shader, export, or worker behavior changes.
- No removal of Tailwind itself; existing utility classes still exist in older panels. The retired scope is Solid UI/Kobalte/CVA/class-merge dependencies.
