# Design: Phase 3 — Timeline + Editing

> Status: **Planned**.

## Goal

Turn single-clip preview into a multi-clip, editable timeline. The worker owns an authoritative model; the main thread renders a mirror and emits edit commands. Playback walks the timeline to pick the right source frame per timestamp, with a frame cache for responsive scrubbing.

## Data model (`timeline.ts`)

```
Timeline = Track[]
Track    = { id, type: 'video' | 'audio', clips: Clip[] }
Clip     = { id, sourceId, start, duration, inPoint }
```

- Pure data + pure functions (`split`, `remove`, `reorder`, `trim`) — no DOM, no GPU. Unit-testable in isolation.
- `resolveAt(timeline, t) → { clip, sourceTime } | null` maps a timeline timestamp to a source frame.

## Mirror & commands

```
Main (mirror, render only)            Worker (authoritative)
  ── timeline-edit command ─────────────▶ apply mutation
  ◀── timeline-state (low-frequency) ──── serialized model snapshot
```

New `WorkerCommand`s: `split`, `delete-clip`, `move-clip`, `trim-clip`. New `WorkerStateMessage`: `timeline-state` (mirror snapshot). Multi-source import assigns a stable `sourceId` per imported `Input`.

## Playback integration (`playback.ts`)

- Replace the single-source seek with `resolveAt` per displayed timestamp.
- Pre-roll the next clip near a boundary so the cut is seamless (decode ahead).
- On seek, resolve the owning clip and decode from its nearest preceding keyframe.

## Frame cache (`frame-cache.ts`)

- LRU keyed by `(sourceId, frameTimestamp)`, bounded by a GPU-memory budget (≈8 MB per 1080p frame; cap ±N around the playhead).
- Cache hit returns a resident `VideoFrame`; eviction `.close()`s the frame exactly once.

## Modules to touch

| Module | Work |
|--------|------|
| `timeline.ts` | Model + pure edit ops + `resolveAt` |
| `worker.ts` | Edit command dispatch; emit `timeline-state` mirror |
| `playback.ts` | Timeline-driven frame selection; seamless boundaries |
| `frame-cache.ts` | LRU with `.close()` on eviction |
| `Timeline.tsx` / `TimelineTrack.tsx` / `TimelineClip.tsx` | Proportional blocks; drag/trim gestures |
| `protocol.ts` | Edit commands + `timeline-state` message |

## Acceptance

- Proportional clip blocks; draggable scrubhead seeks.
- Razor splits at playhead; clips reorder; edges trim.
- Seamless playback across clip boundaries.
- Scrubbing is responsive (frame-cache hits, not re-seeks).
- Timeline model and seek resolution covered by unit tests.
