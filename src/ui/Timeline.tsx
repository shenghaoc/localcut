import { Show } from 'solid-js';

interface TimelineProps {
  currentTime: () => number;
  duration: () => number;
  hasMedia: boolean;
  onSeek: (time: number) => void;
}

function formatTimecode(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const frames = Math.floor((s % 1) * 30);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

export function Timeline(props: TimelineProps) {
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
        <span class="timecode tabular-nums">{formatTimecode(props.currentTime())}</span>
        <span class="timecode-sep">/</span>
        <span class="timecode tabular-nums muted">{formatTimecode(props.duration())}</span>
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
