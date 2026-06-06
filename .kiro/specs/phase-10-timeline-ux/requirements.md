# Requirements: Phase 10 — Timeline UX + Gap Model

## R1 — Gap-Tolerant Moves

- **R1.1** Clip moves become time-based: `move-clip` carries an absolute target start, tolerates gaps, and replaces index-based reordering.
- **R1.2** Same-track overlap is rejected at the model level — an overlap would shadow later clips in `resolveAt`.
- **R1.3** Sequential relayout survives only behind an explicit "close gaps" action, never as an implicit side effect.

## R2 — Zoom + Scroll

- **R2.1** Timeline geometry derives from a pixels-per-second scale with horizontal scrolling, replacing percent-of-duration layout.
- **R2.2** Zoom in/out (control + keyboard) recentres on the playhead; ruler ticks adapt to the zoom level.

## R3 — Snapping

- **R3.1** Drag and trim snap to clip edges, the playhead, markers, and timeline zero within a pixel threshold.
- **R3.2** Snapping is toggleable and computed from the mirrored model, not the DOM.

## R4 — Multi-Select + Batch Ops

- **R4.1** Shift-click and marquee selection cover multiple clips.
- **R4.2** Group move/delete/duplicate apply as one undoable history entry.

## R5 — Clipboard + Markers

- **R5.1** Copy/paste/duplicate clips; paste lands at the playhead.
- **R5.2** Named timeline markers: add, delete, seek to next/previous; persisted in the project document.

## R6 — Keyboard Map

- **R6.1** A centralized, focus-aware shortcut handler covers split-at-playhead, delete, J/K/L shuttle, zoom, undo/redo, and clipboard.

## R7 — Tests

- **R7.1** Unit-test time-based moves, overlap rejection, and gap preservation, including that old sequential projects still resolve identically.
- **R7.2** Unit-test snap-target resolution, batch operations, and the marker model.
