import { Show } from 'solid-js';

interface TimelineProps {
  currentTime: () => number;
  duration: () => number;
  /** Source frame rate for the timecode frame field; null falls back to 30. */
  frameRate?: () => number | null;
  hasMedia: boolean;
  onSeek: (time: number) => void;
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

  function onScrubClick(e: MouseEvent) {
    const track = e.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const d = props.duration();
    if (d > 0) props.onSeek(ratio * d);
  }

  return (
    <section class="timeline panel">
      <div class="timeline-header">
        <span class="timecode tabular-nums">{formatTimecode(props.currentTime(), fps())}</span>
        <span class="timecode-sep">/</span>
        <span class="timecode tabular-nums muted">{formatTimecode(props.duration(), fps())}</span>
      </div>
      <Show when={props.hasMedia} fallback={<p class="placeholder-text">Import media to edit</p>}>
        <div class="timeline-track" onClick={onScrubClick} role="slider" aria-label="Timeline">
          <div class="timeline-ruler" />
          <div class="scrubhead" style={{ left: `${progress() * 100}%` }} />
        </div>
      </Show>
    </section>
  );
}
