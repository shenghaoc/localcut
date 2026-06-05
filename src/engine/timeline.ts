/** Authoritative timeline model — Phase 3. */
export interface TimelineClip {
  id: string;
  sourceId: string;
  start: number;
  duration: number;
  inPoint: number;
}

export interface TimelineTrack {
  id: string;
  type: 'video' | 'audio';
  clips: TimelineClip[];
}

export function createEmptyTimeline(): TimelineTrack[] {
  return [];
}
