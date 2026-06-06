# Design: Phase 20 — Editing Tools V2

> Status: **Planned** — professional NLE editing grammar on top of the gap-tolerant timeline; prerequisite for efficient multi-track workflows.

## Goal

Add the editing operations a professional NLE user expects — insert, overwrite, ripple, roll, slip, slide, lift, extract — along with linked A/V clips and track-level lock/sync/target state. Phase 10 landed gap-tolerant time-based placement, multi-select, and clipboard. Phase 20 builds real editing grammar on that foundation without altering the worker-authority or bounded-undo model.

## Model changes

### Linked groups

```
TimelineClip += { linkedGroupId?: string }
```

On import of a source with both video and audio streams, both clips receive the same `linkedGroupId` (a generated id). The link is metadata — no structural coupling in `resolveAt` or the effect chain. Link-aware operations query the timeline for all clips sharing a `linkedGroupId` and apply the positional mutation to each, or reject the entire batch if any member is blocked.

`linkClips(timeline, clipRefs[])` assigns a shared `linkedGroupId`; `unlinkClips(timeline, clipRefs[])` clears it. Both are undoable.

### Track state

```
TimelineTrack += {
  locked: boolean,
  visible: boolean,
  syncLocked: boolean,
  editTarget: boolean,
}
```

Defaults: `locked: false`, `visible: true`, `syncLocked: false`, `editTarget: true`. Persisted in the project document via the Phase 9 serializer; `schemaVersion` bump with additive defaults so existing documents upgrade cleanly.

- **Locked** — the track-lock guard is a precondition check at the top of every mutating pure function in `timeline.ts`. If the target track is locked, the function returns the original timeline reference (no-op), which `commitTimelineMutation` detects as unchanged and skips history push.
- **Visible** — consumed by `resolveAllAt` and `compositeLayers` in the pipeline worker to skip hidden tracks during preview and export compositing. Hidden tracks are still editable.
- **Sync locked** — consumed only by ripple-class operations (ripple delete, ripple trim, insert, extract). When a ripple shifts clips on track A by delta, every sync-locked track shifts all clips whose start is at or after the ripple point by the same delta. If a sync-locked track is also locked, the entire ripple is rejected.
- **Edit target** — consumed only by insert and overwrite. Non-targeted tracks are skipped; if the only matching target track is locked, the operation is rejected.

### New pure functions in `timeline.ts`

| Function | Semantics |
|----------|-----------|
| `insertEdit(timeline, targetTrackIds, clips, atTime, syncLockedTrackIds)` | Place clips at `atTime` on target tracks; shift downstream clips on those tracks right by inserted duration; shift clips on sync-locked tracks by the same delta. |
| `overwriteEdit(timeline, targetTrackIds, clips, atTime)` | Place clips at `atTime` on target tracks; split-trim or delete any clips in the overwritten range; no downstream shift. |
| `rippleDelete(timeline, clipRefs, syncLockedTrackIds)` | Remove clips; shift downstream clips left by total removed duration per track; shift sync-locked tracks. |
| `rippleTrim(timeline, trackId, clipId, edge, time, syncLockedTrackIds, sourceDuration?)` | Trim clip edge; shift downstream clips by the trim delta; shift sync-locked tracks. |
| `rollTrim(timeline, trackId, clipId, edge, time, sourceDurations)` | Move the cut point between adjacent clips; extend one, shorten the other; clamp by source bounds on both sides. |
| `slipEdit(timeline, trackId, clipId, deltaS, sourceDuration)` | Shift `inPoint` by delta without changing `start` or `duration`; clamp to `[0, sourceDuration - duration]`. |
| `slideEdit(timeline, trackId, clipId, deltaS, sourceDurations)` | Shift clip position by delta; adjust predecessor's out-point and successor's in-point; clamp by all three source bounds. |
| `liftRegion(timeline, targetTrackIds, startTime, endTime)` | Remove the region from target tracks, leaving gaps; trim clips at boundaries. |
| `extractRegion(timeline, targetTrackIds, startTime, endTime, syncLockedTrackIds)` | Remove the region and shift downstream clips left; shift sync-locked tracks. |
| `linkClips(timeline, clipRefs)` | Assign a shared `linkedGroupId`. |
| `unlinkClips(timeline, clipRefs)` | Clear `linkedGroupId` on the specified clips. |
| `setTrackLock(timeline, trackId, locked)` | Toggle lock state. |
| `setTrackVisible(timeline, trackId, visible)` | Toggle visibility. |
| `setTrackSyncLock(timeline, trackId, syncLocked)` | Toggle sync lock. |
| `setTrackEditTarget(timeline, trackId, editTarget)` | Toggle edit target. |

Every function returns the original timeline reference on no-op (locked-track rejection, nothing to do), which the worker detects as unchanged and skips history.

### Linked-clip dispatch

A helper `expandLinkedGroup(timeline, clipRefs)` returns the full set of clips including all linked partners. Edit operations call this before executing:

- **Positional operations** (move, ripple delete, insert, overwrite, extract, slide): expand to linked group, check all target tracks are unlocked, apply to all or reject entirely.
- **Slip**: applied to the single clip only (slip changes source window, which is per-stream).
- **Roll trim**: applied to adjacent pair only; if either clip has linked partners on other tracks, those partners are not rolled (roll is a same-track boundary operation).
- **Unlink**: only then can members be edited independently.

If expanding the linked group finds a member on a locked track, the operation returns the original timeline (no-op).

## Protocol

New commands added to `WorkerCommand`:

```
'insert-edit'     { targetTrackIds, clips: ClipboardTimelineClip[], atTime }
'overwrite-edit'  { targetTrackIds, clips: ClipboardTimelineClip[], atTime }
'ripple-delete'   { clips: ClipReference[] }
'ripple-trim'     { trackId, clipId, edge, time }
'roll-trim'       { trackId, clipId, edge, time }
'slip-edit'       { trackId, clipId, deltaS }
'slide-edit'      { trackId, clipId, deltaS }
'lift-region'     { targetTrackIds, startTime, endTime }
'extract-region'  { targetTrackIds, startTime, endTime }
'link-clips'      { clips: ClipReference[] }
'unlink-clips'    { clips: ClipReference[] }
'set-track-lock'  { trackId, locked }
'set-track-visible'  { trackId, visible }
'set-track-sync-lock'  { trackId, syncLocked }
'set-track-edit-target'  { trackId, editTarget }
```

`timeline-state` already carries the full track list; the new track fields serialize into existing `TimelineTrackSnapshot`. No new state message types needed.

The worker handler for each edit command:
1. Derives `syncLockedTrackIds` and `targetTrackIds` from current track state.
2. Expands linked groups via `expandLinkedGroup`.
3. Calls the pure function.
4. Commits via `commitTimelineMutation` (which handles history, transition reconciliation, and state broadcast).

## UI gesture model

Gestures live in `src/ui/` and are decoupled from worker mutations. The UI owns transient drag-preview state; the worker owns committed state.

### Gesture lifecycle

```
pointerdown  → capture tool mode + initial snapshot from mirror
pointermove  → update local SolidJS preview signal (no worker command)
pointerup    → compute final delta from snapshot → send ONE worker command
```

This avoids posting full timeline snapshots on every pointermove. The UI shows a CSS-transformed preview overlay during the drag; the committed timeline state arrives via the normal `timeline-state` message after the worker processes the command.

### Tool modes

The active tool determines how a drag on a clip or clip edge is interpreted:

| Tool | Click / drag on clip body | Drag on left edge | Drag on right edge |
|------|---------------------------|--------------------|--------------------|
| Select (V) | Move (existing) | Trim (existing) | Trim (existing) |
| Ripple (B) | Ripple move* | Ripple trim | Ripple trim |
| Roll (N) | — | Roll trim | Roll trim |
| Slip (Y) | Slip edit | — | — |
| Slide (U) | Slide edit | — | — |

*Ripple move = move + ripple-close the vacated gap. Implemented as ripple-delete at old position + insert at new position, coalesced as one history entry.

Tool mode is a UI-only signal; the worker commands are tool-agnostic.

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| V | Select tool |
| B | Ripple tool |
| N | Roll tool |
| Y | Slip tool |
| U | Slide tool |
| , (comma) | Insert edit from source/bin selection |
| . (period) | Overwrite edit from source/bin selection |
| Shift+Delete / Shift+Backspace | Ripple delete selection |
| Delete / Backspace | Lift (existing delete becomes lift) |
| ' (apostrophe) | Extract selection |
| Cmd/Ctrl+L | Toggle track lock on focused track |

All shortcuts route through the existing `src/ui/keyboard.ts` focus-aware handler. Tool-mode shortcuts are blocked when focus is in a text input or the Inspector.

## Conflict behavior

### Gaps

- Insert and ripple operations create or close gaps as defined.
- Overwrite and lift may create gaps (by design).
- Roll, slip, and slide never create gaps.

### Locked tracks

A locked track is an absolute barrier. If any clip in the operation set (including linked partners) lives on a locked track, the entire operation returns no-op. The UI should indicate the rejection (flash the lock icon, not a modal).

### Transitions

All operations call the existing `reconcileTransitions` path after mutation. Transitions are boundary objects between adjacent clips — any operation that breaks adjacency or exhausts source headroom drops the transition. This is explicit and consistent with Phase 13.

### Markers

- Ripple operations (ripple delete, ripple trim, insert, extract) shift markers that are at or after the ripple point by the same delta.
- Non-ripple operations (overwrite, lift, roll, slip, slide) leave markers in place.
- Marker shift is part of the same atomic mutation and undo entry.

A new helper `shiftMarkers(markers, afterTime, deltaS)` returns an updated marker list.

### Offline media

Clips with unresolved sources participate in all positional operations (move, delete, ripple, insert, overwrite, lift, extract, slide). They block slip and roll operations that require `sourceDuration` for clamping — returning no-op rather than corrupting bounds.

## Modules

| Module | Work |
|--------|------|
| `src/engine/timeline.ts` | New pure functions: `insertEdit`, `overwriteEdit`, `rippleDelete`, `rippleTrim`, `rollTrim`, `slipEdit`, `slideEdit`, `liftRegion`, `extractRegion`, `linkClips`, `unlinkClips`, `setTrackLock`, `setTrackVisible`, `setTrackSyncLock`, `setTrackEditTarget`, `expandLinkedGroup`, `shiftMarkers`. |
| `src/engine/worker.ts` | Command handlers for all new commands; derive sync/target state before calling pure functions; commit via existing `commitTimelineMutation`. |
| `src/protocol.ts` | New command types; extend `TimelineTrackSnapshot` with `locked`, `visible`, `syncLocked`, `editTarget`; extend `TimelineClipSnapshot` with `linkedGroupId`. |
| `src/engine/project.ts` | `schemaVersion` bump; additive defaults for new track/clip fields on deserialization. |
| `src/ui/timeline-interaction.ts` | Tool-mode signal; gesture lifecycle (pointerdown/move/up → preview → commit); `expandLinkedGroup` mirror for preview highlighting. |
| `src/ui/TimelineClip.tsx` | Linked-clip indicator; slip/slide/roll preview overlays. |
| `src/ui/Timeline.tsx` | Track header controls: lock, visibility, sync lock, edit target toggles. |
| `src/ui/keyboard.ts` | Tool-mode shortcuts (V/B/N/Y/U), insert/overwrite (,/.), ripple delete (Shift+Del), extract ('). |
| `src/ui/Toolbar.tsx` | Tool-mode selector (visual indicator of active tool). |

## Validation

- Unit tests cover every operation × {single-track, multi-track, gap, locked, sync-locked, linked A/V, transition-adjacent, marker, offline clip}.
- Locked-track rejection produces no history entry and no state broadcast.
- Drag gestures coalesce to one undo entry (unit-test the coalesce key).
- Linked-clip operations are all-or-nothing (no partial application).
- Manual: import A/V source → split → ripple delete → insert at playhead → roll trim the cut → slip a clip → slide a clip → lock a track → verify lock blocks edits → undo entire sequence step by step → export.
- `npm run build` and `npm test` green; test count grows.
