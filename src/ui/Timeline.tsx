import { createSignal, For, Show } from 'solid-js';
import { TimelineClip } from './TimelineClip';
import { TimelineTrack } from './TimelineTrack';
import {
  type TimelineTrackSnapshot as ProtocolTimelineTrack,
  type TimelineClipSnapshot as ProtocolTimelineClip,
} from '../protocol';

interface TimelineProps {
  currentTime: () => number;
  duration: () => number;
  /** Source frame rate for the timecode frame field; null falls back to 30. */
  frameRate?: () => number | null;
  hasMedia: boolean;
  timeline: () => ProtocolTimelineTrack[];
  onSeek: (time: number) => void;
  onSplit: (trackId: string, clipId: string, time: number) => void;
  onDelete: (trackId: string, clipId: string) => void;
  onMoveClip: (
    fromTrackId: string,
    clipId: string,
    toTrackId: string,
    toIndex: number,
  ) => void;
  onTrim: (trackId: string, clipId: string, edge: 'in' | 'out', time: number) => void;
}

const DEFAULT_FPS = 30;

function formatTimecode(seconds: number, fps: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  // Round fps to a whole frame count and clamp so e.g. 29.97 never shows
  // frame 30. Unknown/invalid rates fall back to 30.
  const f = fps > 0 ? Math.round(fps) : DEFAULT_FPS;
  const frames = Math.min(f - 1, Math.floor((s % 1) * f));
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

export function Timeline(props: TimelineProps) {
  const fps = () => props.frameRate?.() ?? DEFAULT_FPS;
  const progress = () => {
    const d = props.duration();
    if (d <= 0) return 0;
    return Math.min(1, props.currentTime() / d);
  };
  const [isScrubbing, setIsScrubbing] = createSignal(false);

  function seekFromClientX(clientX: number, ruler: HTMLElement) {
    const rect = ruler.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const duration = props.duration();
    if (duration > 0) props.onSeek(ratio * duration);
  }

  function onScrubPointerDown(event: PointerEvent) {
    const target = event.currentTarget as HTMLElement;
    event.preventDefault();
    seekFromClientX(event.clientX, target);
    setIsScrubbing(true);
    const onMove = (move: PointerEvent) => {
      seekFromClientX(move.clientX, target);
    };
    const onUp = () => {
      setIsScrubbing(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function onClipMoveStart(trackId: string, clipId: string, event: DragEvent) {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(
      'application/x-be-timeline-clip',
      JSON.stringify({ fromTrackId: trackId, clipId }),
    );
  }

  return (
    <section class="timeline panel">
      <div class="timeline-header">
        <span class="timecode tabular-nums">{formatTimecode(props.currentTime(), fps())}</span>
        <span class="timecode-sep">/</span>
        <span class="timecode tabular-nums muted">{formatTimecode(props.duration(), fps())}</span>
      </div>
      <Show when={props.hasMedia} fallback={<p class="placeholder-text">Import media to edit</p>}>
        <div class="timeline-track-wrapper">
          <For each={props.timeline()}>
            {(track) => (
              <TimelineTrack
                track={track}
                totalDuration={props.duration()}
                onMoveClip={props.onMoveClip}
              >
                <For each={track.clips as ProtocolTimelineClip[]}>
                  {(clip) => (
                    <TimelineClip
                      trackId={track.id}
                      clip={clip}
                      totalDuration={props.duration()}
                      onSplit={props.onSplit}
                      onDelete={props.onDelete}
                      onTrim={props.onTrim}
                      onMoveStart={onClipMoveStart}
                    />
                  )}
                </For>
              </TimelineTrack>
            )}
          </For>
          <div
            class={`timeline-ruler-wrap ${isScrubbing() ? 'is-scrubbing' : ''}`}
            onPointerDown={onScrubPointerDown}
            role="slider"
            aria-label="Timeline"
          >
            <div class="timeline-ruler" />
            <div class="scrubhead" style={{ left: `${progress() * 100}%` }} />
          </div>
        </div>
      </Show>
    </section>
  );
}
