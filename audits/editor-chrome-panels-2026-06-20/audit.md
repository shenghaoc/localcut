# Editor Chrome Panels Audit

Date: 2026-06-20
Target: http://localhost:5174/
Viewport: 1280 x 720 default in-app browser viewport
Branch/worktree: claude/laughing-colden-c29248

## General Health

Weak. The visual language is coherent, but the information architecture is not. The app currently has three competing navigation systems:

- Left rail: presented like workspace navigation, but many entries are action launchers.
- Top menu plus top pipeline strip: sparse menus and many duplicate tool launchers.
- Right rail: seven top-level tabs squeezed into a 304px panel, with some tabs hidden until focus shifts the tab strip.

The worst current problem is not only CSS. It is that the same concepts are exposed through different labels and different surfaces. For example, `Cleanup` in the top toolbar opens Local Audio Cleanup as a full-height sheet, while `Cleanup` in the right rail means Voice Cleanup / live chain. That is not learnable.

## Evidence

Screenshots are saved in `screenshots/`.

Key captures:

- `screenshots/01-editor-shell.png` - baseline shell at 1280 x 720.
- `screenshots/02a-left-project-isolated.png` - left `Project` triggers import instead of switching a project panel.
- `screenshots/04a-left-record-isolated.png` - left `Record` switches the right rail, while the left content remains Media plus Beat Detection.
- `screenshots/05a-left-scopes-isolated.png` - left `Scopes` opens a floating overlay, not a left panel.
- `screenshots/06a-left-ai-isolated.png` - left `AI` opens the Auto Captions modal.
- `screenshots/07a-left-captions-isolated.png` - left `Captions` switches the right rail.
- `screenshots/10a-menu-project-clean.png` through `15a-menu-help-clean.png` - clean top menu captures.
- `screenshots/16a-right-inspector-clean.png` through `22b-right-cleanup-tab-locator-result.png` - clean right rail tab captures.
- `capture-meta.json`, `left-isolated-meta.json`, `top-clean-meta.json`, `right-clean-meta.json`, and `cleanup-tab-attempt.json` contain DOM text and rect evidence.

Supporting code references:

- `src/ui/App.tsx:355` defines seven right rail tabs in one row: Inspector, Captions, Record, Program, Replay, Audio, Cleanup.
- `src/ui/App.tsx:4298` renders the left rail as `Workspace sections`, but the buttons trigger mixed actions.
- `src/ui/Toolbar.tsx:245` defines sparse menu groups where every menu includes `Search actions...`.
- `src/ui/Toolbar.tsx:664` adds top-strip launchers for Cleanup, Captions, Translate, Reframe, Silence, Keys, Capabilities, and Help.
- `src/global.css:6834` makes the right tab bar horizontally scrollable, while `src/global.css:6843` hides the scrollbar.

## Findings

### 1. Right rail tabs do not fit the actual right rail

At the default viewport, the right rail is 304px wide, but the tab row contains seven text tabs plus collapse. The `Audio` tab is clipped and the `Cleanup` tab is initially off the visible edge. The DOM measurement captured a max button right edge beyond the 1280px viewport even though the page itself does not expose useful horizontal scrolling.

The locator test could activate `Cleanup`, but doing so shifted the tab row left. That hides `Inspector` and makes the rail feel like it changed shape. This is not an acceptable primary navigation pattern.

Recommendation: do not put seven top-level text tabs in this rail. Reduce the top-level right rail to fewer, stable destinations or use a real overflow menu with a visible affordance.

### 2. Left rail looks like navigation but behaves like mixed commands

The left rail is labeled as workspace sections, but it does not consistently switch left-panel content:

- `Project` opens import and can leave a file-picker failure in the status bar.
- `Media` is the only clear left dock panel.
- `Record` switches the right rail to Record.
- `Scopes` opens a floating preview overlay.
- `AI` opens Auto Captions, not a generic AI panel.
- `Captions` switches the right rail to Captions.
- `Reframe` opens a modal/sheet.
- `Output` attempts to scroll to a render queue area, with no visible change in the empty project state.

Recommendation: make the left rail one of two things, not both. Either it is true workspace navigation and every item owns the left dock content, or it becomes a command launcher with different styling and grouped commands. Do not make action buttons look like persistent tabs.

### 3. `Cleanup` means two different things

The top toolbar `Cleanup` opens `Local Audio Cleanup (Experimental)` as a full-height sheet. The right rail `Cleanup` tab shows `Voice Cleanup` with denoiser, loudness, gate, and limiter controls. The adjacent right rail `Audio` tab also shows a live audio chain.

This creates three nearby audio concepts: `Audio`, `Cleanup`, and top toolbar `Cleanup`. They overlap but do not lead to the same surface.

Recommendation: rename and consolidate.

- Use `Audio` for the right rail live chain.
- Rename right rail `Cleanup` to `Voice Chain`, `Voice FX`, or fold it under `Audio`.
- Keep the top toolbar action named `Audio Cleanup` only if it opens the selected-clip cleanup workflow.
- Avoid a bare `Cleanup` label anywhere.

### 4. Top menus are too sparse and duplicate the toolbar

The menu bar reads like a desktop app, but most menus contain only one or two commands plus `Search actions...`. `View > Browser capabilities` duplicates the top strip `Capabilities` button. `Help > User guide` duplicates the top strip `Help` button. This creates the exact duplicate-access problem the user already called out.

Recommendation: make the menu bar the command taxonomy and the top toolbar the frequent-action strip.

- Put capability information in one place, likely Help or Diagnostics.
- Do not expose `Browser capabilities` under both View and a toolbar chip.
- Remove repeated `Search actions...` from every menu or demote it to a single command-palette shortcut hint.
- Fill menus with real commands only when those commands are already implemented and useful.

### 5. The right rail mixes properties, capture workflows, and audio processing

Each right rail item evaluated:

- `Inspector`: correct as a right rail destination. It is contextual and property-oriented.
- `Captions`: plausible in a right rail, but only if the rail is an editing-properties surface. It currently also exists in left rail and top toolbar.
- `Record`: capture setup is a workflow, not an inspector tab. It fights the left `Record` entry and top `Go Live`.
- `Program`: live program mode belongs with capture/streaming, not next to Inspector.
- `Replay`: replay buffer belongs with capture/streaming, not next to Inspector.
- `Audio`: useful, but it should be the one right rail home for live audio chain controls.
- `Cleanup`: duplicated/confusing. It overlaps with Audio and with the top toolbar Local Audio Cleanup sheet.

Recommendation: split by job, not by feature name. Suggested structure:

- Right rail: `Inspector`, `Text`, `Audio`, `Capture` at most.
- `Text`: captions plus translation/copy tools.
- `Audio`: live chain, voice chain, clip cleanup entry point when a clip is selected.
- `Capture`: record, program, replay, WHIP/go-live setup.
- Move one-off modals out of the left rail unless they are also represented as the same selected right rail tab.

### 6. Beat Detection is styled now, but still orphaned

The Beat Detection card is no longer visually broken, but it still sits as a small fixed companion to Media without explaining whether it is a media analysis tool, timeline snapping tool, or audio editing tool. The top transport strip also has `Beat` snapping, so the relationship is implicit.

Recommendation: either make Beats a sub-section of Media Analysis when an audio source is selected, or move Beat Detection into an Audio/Timing panel and link it directly to beat snapping state.

### 7. Disabled or unavailable states still occupy too much primary UI

Record and Program devote large panel space to unavailable reasons in the primary body. The app should be honest, but unavailable capability details should not dominate the panel unless the user asked for diagnostics.

Recommendation: for unavailable feature states, show a compact status row and put the full browser/flag reason in a tooltip or details disclosure. The primary body should still show what the user can do next.

## Proposed Reorganization

Top menu:

- `Project`: New, Import, Project bundle, Collect media, Export.
- `Edit`: Undo, Redo, Delete, split-related editing commands.
- `Clip`: clip-specific operations only.
- `Timeline`: snapping, beat grid, tracks, markers, safe areas.
- `View`: layout, panels, scopes, overlays. Do not put Browser Capabilities here if it remains in Help/Diagnostics.
- `Help`: User guide, Browser capabilities, Diagnostics.

Top toolbar:

- Keep only frequent commands and status: Import, Undo/Redo, Transport, Timecode, Snap/Beat toggles, master level, Export.
- Remove or collapse the long tool launcher strip. A command palette can handle infrequent tool discovery.

Left rail:

- Option A: make it a real dock switcher with `Media`, `Effects`, `Text`, `Audio`, `Capture`, `Export`, and each item changes the left dock content.
- Option B: reduce it to source/library only: `Media`, `Beats`, maybe `Project`. Move workflow launchers elsewhere.

Right rail:

- Keep it contextual and compact: `Inspector`, `Text`, `Audio`, `Capture`.
- Use secondary segmented controls inside each tab for the current seven destinations.
- Make tab overflow visible if any overflow remains. Hidden-scrollbar horizontal tabs are not acceptable for core navigation.

## Step List

1. Baseline shell audit: unhealthy. Right rail and top toolbar are already squeezed at 1280px. Output: `screenshots/01-editor-shell.png`.
2. Left rail audit: unhealthy. The rail visually promises sections but triggers imports, modals, right-rail switches, overlays, and scroll attempts. Output: `screenshots/02a-left-project-isolated.png` through `screenshots/09a-left-output-isolated.png`.
3. Top menu audit: weak. Menus are sparse and duplicate toolbar actions, especially Browser Capabilities and Help. Output: `screenshots/10a-menu-project-clean.png` through `screenshots/15a-menu-help-clean.png`.
4. Right rail audit: unhealthy. Seven top-level tabs do not fit; `Audio` and `Cleanup` are clipped/hidden, and activation shifts the tab strip. Output: `screenshots/16a-right-inspector-clean.png` through `screenshots/22b-right-cleanup-tab-locator-result.png`.
5. Organization recommendation: consolidate by user job instead of feature label. Full output saved in this folder.

## Limits

This audit is based on visual inspection, DOM rect/text captures, and supporting code inspection. It does not claim full accessibility compliance. Keyboard behavior, screen reader announcements, and responsive/mobile behavior would need a separate focused pass.
