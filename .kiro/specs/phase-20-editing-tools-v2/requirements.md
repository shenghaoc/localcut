# Requirements: Phase 20 — Editing Tools V2

## R1 — Linked A/V Clips

- **R1.1** Clips originating from a single source with both video and audio streams share a `linkedGroupId`; operations on one linked member apply identically to all members of the group unless explicitly unlinked.
- **R1.2** Unlinking is an explicit user action; after unlinking, each former member becomes an independent clip and desync is visible in the UI.
- **R1.3** Linked clips must never silently desync — if a ripple, insert, or overwrite would move one member but a locked or non-targeted track blocks the other, the entire operation is rejected rather than applied partially.
- **R1.4** Link and unlink are undoable operations; relinking reconnects clips by matching `linkedGroupId`.

## R2 — Insert + Overwrite Edit

- **R2.1** Insert edit places a source range at the playhead on targeted tracks, pushing downstream clips and gaps right (ripple) by the inserted duration; sync-locked tracks shift by the same amount.
- **R2.2** Overwrite edit places a source range at the playhead on targeted tracks, replacing whatever occupies that time range without shifting downstream clips.
- **R2.3** Both operations respect edit targeting: only tracks marked as edit targets receive new clips; non-targeted tracks are untouched unless sync-locked (insert only).
- **R2.4** Both operations respect track locking: a locked target track blocks the entire operation rather than silently skipping it.
- **R2.5** Overwrite split-trims any clip the placed region partially overlaps and deletes any clip it fully covers.
- **R2.6** Each insert or overwrite is one undoable history entry regardless of how many tracks or clips are affected.

## R3 — Ripple Delete + Ripple Trim

- **R3.1** Ripple delete removes selected clips and shifts all downstream clips on the same track left by the total removed duration; sync-locked tracks shift by the same amount.
- **R3.2** Ripple trim extends or shortens a clip edge and shifts downstream clips accordingly, preserving no gap at the trimmed boundary.
- **R3.3** Both operations are blocked on locked tracks; if a sync-locked track is locked, the entire ripple is rejected.

## R4 — Roll Trim, Slip Edit, Slide Edit

- **R4.1** Roll trim moves the cut point between two adjacent clips — extending one while shortening the other — keeping total timeline duration unchanged; clamped by source bounds on both sides.
- **R4.2** Slip edit changes a clip's `inPoint` within its source without altering position or duration on the timeline; clamped to available source media.
- **R4.3** Slide edit moves a clip along the timeline while adjusting the out-point of the preceding neighbour and the in-point of the following neighbour so that no gap or overlap is created; clamped by all three clips' source bounds.

## R5 — Lift + Extract

- **R5.1** Lift removes the selected region from targeted tracks, leaving a gap; downstream clips are not shifted.
- **R5.2** Extract removes the selected region from targeted tracks and shifts downstream clips left to close the gap; sync-locked tracks shift by the same amount.
- **R5.3** Both operations clip-trim at the region boundaries rather than requiring frame-exact selection.

## R6 — Track Lock, Visibility, Sync Lock, Edit Targeting

- **R6.1** A locked track rejects all mutating commands; no clip on a locked track may be created, moved, trimmed, deleted, or otherwise altered.
- **R6.2** Track visibility controls whether a track is included in preview and export compositing; hidden tracks remain editable.
- **R6.3** Sync lock causes a track to shift in tandem with ripple operations on other tracks, preserving relative sync; sync lock does not make a track an edit target.
- **R6.4** Edit targeting marks which tracks receive insert and overwrite edits; untargeted tracks are skipped by those operations.
- **R6.5** Track lock, visibility, sync lock, and edit target state are per-track, persisted in the project document, and each change is an undoable operation.

## R7 — Gesture Coalescing + Undo

- **R7.1** Each completed gesture (drag-trim, drag-move, drag-slip, drag-slide, drag-roll) commits as one coalesced history entry, regardless of how many intermediate pointermove samples occurred.
- **R7.2** Multi-clip batch operations (ripple delete of a selection, insert affecting linked clips) produce one history entry.
- **R7.3** Undo/redo remains bounded and predictable with the existing ~100-entry cap.

## R8 — Transition + Marker Integrity

- **R8.1** Ripple, insert, overwrite, slide, and extract re-validate transitions via the existing `reconcileTransitions` path; a transition whose adjacency or headroom is broken is dropped explicitly.
- **R8.2** Markers shift with ripple and extract operations on the same principle as sync-locked clips; lift and overwrite leave markers in place.
- **R8.3** Offline (unresolved) clips block slip and roll operations that depend on source duration but participate normally in positional operations (move, delete, ripple).

## R9 — Tests

- **R9.1** Unit-test every edit operation (insert, overwrite, ripple delete, ripple trim, roll trim, slip, slide, lift, extract) with single-track, multi-track, gap, locked-track, sync-locked-track, linked A/V, transition-adjacent, and marker-adjacent scenarios.
- **R9.2** Unit-test that locked-track rejection produces a no-op with no timeline mutation and no history entry.
- **R9.3** Unit-test undo/redo coalescing for drag-based gestures (pointermove streams collapse to one entry).
- **R9.4** Unit-test linked-clip consistency: operations that would desync are rejected; unlink then re-edit succeeds.
- **R9.5** Integration-test the workflow: import → split → ripple delete → insert → trim → export.
