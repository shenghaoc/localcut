import type { Timeline, TimelineMarker, TimelineTransition } from './timeline';
import type { CaptionTrack } from './captions/types';
import { cloneCaptionTracksSnapshot, cloneMarkersSnapshot, cloneTimelineSnapshot, cloneTransitionsSnapshot } from './project';

const DEFAULT_HISTORY_LIMIT = 100;
const DEFAULT_COALESCE_WINDOW_MS = 80;

export interface HistoryCoalesceKey {
  clipId: string;
  key: string;
}

export interface TimelineHistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

export interface TimelineHistoryOptions {
  limit?: number;
  coalesceWindowMs?: number;
  now?: () => number;
}

export interface TimelineHistorySnapshot {
  timeline: Timeline;
  captionTracks?: CaptionTrack[];
  transitions: TimelineTransition[];
  markers: TimelineMarker[];
}

export interface TimelineHistory {
  push: (snapshot: TimelineHistorySnapshot, options?: { coalesceKey?: HistoryCoalesceKey }) => void;
  undo: (current: TimelineHistorySnapshot) => TimelineHistorySnapshot | null;
  redo: (current: TimelineHistorySnapshot) => TimelineHistorySnapshot | null;
  clear: () => void;
  state: () => TimelineHistoryState;
  size: () => { past: number; future: number };
}

interface HistoryEntry {
  snapshot: TimelineHistorySnapshot;
  coalesceKey: HistoryCoalesceKey | null;
  updatedAt: number;
}

function keysEqual(a: HistoryCoalesceKey | null, b: HistoryCoalesceKey | null): boolean {
  return a !== null && b !== null && a.clipId === b.clipId && a.key === b.key;
}

export function createTimelineHistory(options: TimelineHistoryOptions = {}): TimelineHistory {
  const limit = Math.max(1, Math.floor(options.limit ?? DEFAULT_HISTORY_LIMIT));
  const coalesceWindowMs = Math.max(0, options.coalesceWindowMs ?? DEFAULT_COALESCE_WINDOW_MS);
  const now = options.now ?? (() => Date.now());
  const past: HistoryEntry[] = [];
  const future: TimelineHistorySnapshot[] = [];

  function cloneSnapshot(snapshot: TimelineHistorySnapshot): TimelineHistorySnapshot {
    const cloned: TimelineHistorySnapshot = {
      timeline: cloneTimelineSnapshot(snapshot.timeline),
      transitions: cloneTransitionsSnapshot(snapshot.transitions),
      markers: cloneMarkersSnapshot(snapshot.markers),
    };
    if (snapshot.captionTracks !== undefined) {
      cloned.captionTracks = cloneCaptionTracksSnapshot(snapshot.captionTracks);
    }
    return cloned;
  }

  function push(snapshot: TimelineHistorySnapshot, pushOptions: { coalesceKey?: HistoryCoalesceKey } = {}): void {
    const timestamp = now();
    const coalesceKey = pushOptions.coalesceKey ?? null;
    const last = past[past.length - 1] ?? null;
    future.length = 0;

    if (last && keysEqual(last.coalesceKey, coalesceKey) && timestamp - last.updatedAt <= coalesceWindowMs) {
      last.updatedAt = timestamp;
      return;
    }

    past.push({
      snapshot: cloneSnapshot(snapshot),
      coalesceKey,
      updatedAt: timestamp,
    });
    if (past.length > limit) {
      past.splice(0, past.length - limit);
    }
  }

  function undo(current: TimelineHistorySnapshot): TimelineHistorySnapshot | null {
    const entry = past.pop();
    if (!entry) return null;
    future.push(cloneSnapshot(current));
    return cloneSnapshot(entry.snapshot);
  }

  function redo(current: TimelineHistorySnapshot): TimelineHistorySnapshot | null {
    const snapshot = future.pop();
    if (!snapshot) return null;
    past.push({
      snapshot: cloneSnapshot(current),
      coalesceKey: null,
      updatedAt: now(),
    });
    if (past.length > limit) {
      past.splice(0, past.length - limit);
    }
    return cloneSnapshot(snapshot);
  }

  function clear(): void {
    past.length = 0;
    future.length = 0;
  }

  function state(): TimelineHistoryState {
    return {
      canUndo: past.length > 0,
      canRedo: future.length > 0,
    };
  }

  function size(): { past: number; future: number } {
    return { past: past.length, future: future.length };
  }

  return {
    push,
    undo,
    redo,
    clear,
    state,
    size,
  };
}
