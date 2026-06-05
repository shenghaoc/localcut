import { type JSX } from 'solid-js';
import { type TimelineTrack as ProtocolTimelineTrack } from '../protocol';

interface TimelineTrackProps {
  track: ProtocolTimelineTrack;
  totalDuration: number;
  onMoveClip: (fromTrackId: string, clipId: string, toTrackId: string, toIndex: number) => void;
  children?: JSX.Element | JSX.Element[];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

interface TimelineClip {
  start: number;
  duration: number;
}

function computeInsertIndex(time: number, clips: TimelineClip[]): number {
  if (clips.length === 0) return 0;
  for (let i = 0; i < clips.length; i += 1) {
    const clip = clips[i];
    if (!clip) continue;
    const clipEnd = clip.start + clip.duration;
    if (time <= clipEnd) return i;
  }
  return clips.length;
}

/** Track row renderer for timeline mirror models. */
export function TimelineTrack(props: TimelineTrackProps) {
  let surfaceEl: HTMLDivElement | null = null;

  function onDrop(event: DragEvent) {
    event.preventDefault();
    const data = event.dataTransfer?.getData('application/x-be-timeline-clip');
    if (!data) return;
    let payload: { fromTrackId: string; clipId: string } | null = null;
    try {
      payload = JSON.parse(data) as { fromTrackId: string; clipId: string };
    } catch {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const time = props.totalDuration <= 0 ? 0 : clamp((event.clientX - rect.left) / rect.width, 0, 1) * props.totalDuration;
    const index = computeInsertIndex(time, props.track.clips);
    props.onMoveClip(payload.fromTrackId, payload.clipId, props.track.id, index);
  }

  function onDragOver(event: DragEvent) {
    event.preventDefault();
  }

  function onDragEnter(event: DragEvent) {
    event.preventDefault();
    surfaceEl?.classList.add('is-over');
  }

  function onDragLeave(event: DragEvent) {
    if (!surfaceEl) return;
    const next = event.relatedTarget as Node | null;
    if (!next || (next !== surfaceEl && !surfaceEl.contains(next))) {
      surfaceEl.classList.remove('is-over');
    }
  }

  return (
    <div class="timeline-track-row">
      <div class="track-label">{props.track.id}</div>
      <div
        class="track-surface"
        ref={surfaceEl}
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={(event) => {
          onDrop(event);
          surfaceEl?.classList.remove('is-over');
        }}
      >
        {props.children}
      </div>
    </div>
  );
}
