# Tasks: Phase 20 — Editing Tools V2

> Status: **Planned**. Track state and linked clips first — every edit operation depends on lock/sync/target checks and linked-group expansion.

## Track state

- [ ] **T1.1** Extend `TimelineTrack` with `locked`, `visible`, `syncLocked`, `editTarget` (defaults: `false`, `true`, `false`, `true`); extend `TimelineTrackSnapshot` and `TimelineClipSnapshot` in `src/protocol.ts`.
- [ ] **T1.2** Add `setTrackLock`, `setTrackVisible`, `setTrackSyncLock`, `setTrackEditTarget` pure functions in `src/engine/timeline.ts`.
- [ ] **T1.3** Wire worker command handlers for `set-track-lock`, `set-track-visible`, `set-track-sync-lock`, `set-track-edit-target` through `commitTimelineMutation`.
- [ ] **T1.4** Bump `schemaVersion` in `src/engine/project.ts` with additive defaults so existing documents upgrade cleanly.
- [ ] **T1.5** Add track header controls in `src/ui/Timeline.tsx`: lock, visibility, sync lock, edit target toggles.
- [ ] **T1.6** Integrate track visibility into `resolveAllAt` and `compositeLayers` to skip hidden tracks in preview and export.
- [ ] **T1.7** Unit-test track state mutations, persistence round-trip with old and new schema versions, and visibility skip in resolution.

## Linked clips

- [ ] **T2.1** Add `linkedGroupId?: string` to `TimelineClip` and `TimelineClipSnapshot`.
- [ ] **T2.2** Add `linkClips`, `unlinkClips`, and `expandLinkedGroup` pure functions in `src/engine/timeline.ts`.
- [ ] **T2.3** Wire worker command handlers for `link-clips` and `unlink-clips`.
- [ ] **T2.4** On import of a source with both video and audio streams, assign matching `linkedGroupId` to both clips.
- [ ] **T2.5** Add linked-clip visual indicator in `src/ui/TimelineClip.tsx`.
- [ ] **T2.6** Unit-test link/unlink round-trip, `expandLinkedGroup` across multiple tracks, and linked-group rejection when a member is on a locked track.

## Lock guard

- [ ] **T3.1** Add a lock precondition check at the entry of every existing and new mutating pure function in `timeline.ts`: if the target track (or any track in the expanded linked group) is locked, return the original timeline reference.
- [ ] **T3.2** Unit-test that locked-track rejection produces no mutation and no history entry across all edit operations.

## Ripple operations

- [ ] **T4.1** Add `rippleDelete(timeline, clipRefs, syncLockedTrackIds)` — remove clips, shift downstream clips left, shift sync-locked tracks; handle linked-group expansion.
- [ ] **T4.2** Add `rippleTrim(timeline, trackId, clipId, edge, time, syncLockedTrackIds, sourceDuration?)` — trim edge, shift downstream clips by trim delta, shift sync-locked tracks.
- [ ] **T4.3** Add `shiftMarkers(markers, afterTime, deltaS)` helper; integrate into ripple delete and ripple trim.
- [ ] **T4.4** Wire worker command handlers for `ripple-delete` and `ripple-trim`; derive `syncLockedTrackIds` from track state.
- [ ] **T4.5** Unit-test ripple delete and ripple trim with gaps, linked clips, sync-locked tracks, locked sync-locked tracks (full rejection), transitions, and markers.

## Insert + overwrite

- [ ] **T5.1** Add `insertEdit(timeline, targetTrackIds, clips, atTime, syncLockedTrackIds)` — place clips at `atTime`, shift downstream clips and sync-locked tracks right; handle linked-group expansion.
- [ ] **T5.2** Add `overwriteEdit(timeline, targetTrackIds, clips, atTime)` — place clips at `atTime`, split-trim or delete overlapped clips; no downstream shift.
- [ ] **T5.3** Wire worker command handlers for `insert-edit` and `overwrite-edit`; derive target and sync-lock state from tracks.
- [ ] **T5.4** Unit-test insert and overwrite with empty tracks, occupied tracks, partial overlaps, full overlaps, linked clips, locked targets (rejection), and transitions.

## Roll, slip, slide

- [ ] **T6.1** Add `rollTrim(timeline, trackId, clipId, edge, time, sourceDurations)` — move cut point between adjacent clips, clamped by source bounds on both sides.
- [ ] **T6.2** Add `slipEdit(timeline, trackId, clipId, deltaS, sourceDuration)` — shift `inPoint` without changing position or duration, clamped to source range; reject if source is offline.
- [ ] **T6.3** Add `slideEdit(timeline, trackId, clipId, deltaS, sourceDurations)` — shift clip position, adjust predecessor out-point and successor in-point, clamped by all three source bounds.
- [ ] **T6.4** Wire worker command handlers for `roll-trim`, `slip-edit`, `slide-edit`.
- [ ] **T6.5** Unit-test roll, slip, and slide with source-bound clamping, offline sources (slip/roll reject, slide allows), adjacent transitions, and edge cases (first/last clip on track).

## Lift + extract

- [ ] **T7.1** Add `liftRegion(timeline, targetTrackIds, startTime, endTime)` — remove region from target tracks, leave gaps, trim at boundaries.
- [ ] **T7.2** Add `extractRegion(timeline, targetTrackIds, startTime, endTime, syncLockedTrackIds)` — remove region, shift downstream left, shift sync-locked tracks; shift markers.
- [ ] **T7.3** Wire worker command handlers for `lift-region` and `extract-region`.
- [ ] **T7.4** Unit-test lift and extract with partial clips, full clips, gaps, linked clips, locked tracks, sync-locked tracks, and markers.

## Gesture model + UI

- [ ] **T8.1** Add tool-mode signal to `src/ui/timeline-interaction.ts` (Select, Ripple, Roll, Slip, Slide); tool mode determines drag interpretation.
- [ ] **T8.2** Implement gesture lifecycle: pointerdown captures initial snapshot and tool mode; pointermove updates local CSS-transform preview (no worker command); pointerup computes final delta and sends one worker command.
- [ ] **T8.3** Add slip/slide/roll preview overlays in `src/ui/TimelineClip.tsx` showing source-window shift or neighbour adjustment during drag.
- [ ] **T8.4** Add tool-mode selector in `src/ui/Toolbar.tsx` with visual indicator of active tool.
- [ ] **T8.5** Add keyboard shortcuts in `src/ui/keyboard.ts`: V (select), B (ripple), N (roll), Y (slip), U (slide), comma (insert), period (overwrite), Shift+Delete (ripple delete), apostrophe (extract), Cmd/Ctrl+L (toggle track lock).

## Undo coalescing

- [ ] **T9.1** Extend the coalesce key in `src/engine/history.ts` to support drag-gesture keys: `{ gesture: 'slip' | 'slide' | 'roll' | 'ripple-trim', clipId }` so that if multiple intermediate commits occur (e.g., snapping feedback during roll trim), they collapse into one entry.
- [ ] **T9.2** Verify that all batch operations (ripple delete of multi-selection, insert affecting linked clips) produce exactly one history entry.
- [ ] **T9.3** Unit-test coalescing: simulate a stream of slip-edit commands for the same clip and verify history has one entry; verify different clips produce separate entries.

## Verification

- [ ] **T10.1** All unit tests green: every operation × {single-track, multi-track, gap, locked, sync-locked, linked A/V, transition-adjacent, marker, offline}.
- [ ] **T10.2** Manual: import A/V source → verify linked indicator → split → ripple delete → insert at playhead → roll trim the cut → slip a clip → slide a clip → lock a track → verify lock blocks edits → undo entire sequence → export.
- [ ] **T10.3** Manual: overwrite into an occupied region → verify partial clips are trimmed → lift the middle → verify gap remains → extract a range → verify downstream shift → undo all.
- [ ] **T10.4** `npm run build` and `npm test` green; test count grows.
