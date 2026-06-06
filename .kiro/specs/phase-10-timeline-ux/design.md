# Design: Phase 10 — Timeline UX + Gap Model

> Status: **Planned** — the editing surface must scale past toy projects before overlay tracks arrive.

## Goal

Turn the fixed percent-of-duration timeline into a zoomable, scrollable, snap-aware surface, and finish the gap-model migration. Clips already keep their positions through delete and trim; only `reorderClip` still force-packs tracks through `relayoutSequential` (`src/engine/timeline.ts`). Free time-based placement is the prerequisite for Phase 12 overlay layers and Phase 14 title clips.

## Model changes

- `moveClipTo(timeline, trackId, clipId, toStart)` replaces index-based `reorderClip`: it clamps against same-track neighbours (reusing the neighbour scan `trimClip` already does) and never relayouts; cross-track moves keep the type-compatibility check.
- `moveClips(batch)` and `duplicateClip` support group operations — one Phase 9 history entry each.
- `markers: Marker[]` (`{ id, time, label }`) lives beside the tracks and serializes into the project document.
- `relayoutSequential` survives only as the explicit `close-gaps` command.

## Protocol

- `move-clip` payload changes `toIndex` → `toStart` — coordinated `schemaVersion` bump with the Phase 9 serializer.
- Migration is additive: persisted v1 documents already store absolute clip `start`s, so the v1→v2 upgrade in the Phase 9 deserializer only defaults `markers: []` and rewrites nothing positional. Commands and undo history are transient (in-memory, never persisted), so only the live protocol changes shape; the upgrade step gets its own unit test.
- New commands: `move-clips`, `duplicate-clip`, `paste-clips`, `add-marker`, `delete-marker`, `close-gaps`.
- `timeline-state` carries markers.

## UI

| Piece | Work |
|-------|------|
| `src/ui/Timeline.tsx` | `pxPerSecond` signal, scroll container, adaptive ruler, marker lane |
| `src/ui/TimelineClip.tsx` | geometry from `start × pps`; drags emit absolute `toStart` |
| `src/ui/timeline-interaction.ts` (new) | snap-target resolution + marquee math, pure and unit-testable |
| `src/ui/keyboard.ts` (new) | focus-aware global shortcuts, mounted once in `App.tsx` |

Zoom and scroll stay pure UI state; the SAB clock cadence and worker protocol frequency are untouched.

## Validation

- Old sequential projects deserialize and resolve identically after the model change.
- Overlapping placements are impossible through UI or commands (model test).
- Manual: zoom deep into a long timeline, snap a trim to the playhead, marquee-move three clips as one undo step, paste at the playhead, hop between markers.
