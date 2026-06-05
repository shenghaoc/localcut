import { Show } from 'solid-js';
import { type TimelineClipSnapshot as ProtocolTimelineClip, type WaveformPeaks } from '../protocol';
import { Waveform } from './Waveform';

interface TimelineClipProps {
  trackId: string;
  clip: ProtocolTimelineClip;
  totalDuration: number;
  onSplit?: (trackId: string, clipId: string, time: number) => void;
  onDelete?: (trackId: string, clipId: string) => void;
  onTrim?: (trackId: string, clipId: string, edge: 'in' | 'out', time: number) => void;
  onMoveStart?: (trackId: string, clipId: string, event: DragEvent) => void;
  selected?: boolean;
  onSelect?: () => void;
  peaks?: WaveformPeaks | null;
  isAudio?: boolean;
}

const EDGE_HANDLE_PX = 10;
const TRIM_DEBOUNCE_MS = 60;

function safePercent(value: number, total: number) {
  if (total <= 0 || Number.isNaN(value) || Number.isNaN(total)) return 0;
  return `${(value / total) * 100}%`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Maps a pointer x-coordinate against the *track surface* (not the clip) into a
 * timeline time. Track-relative drags let the user pull the in/out edge past
 * the clip's current bounds to extend it back out; the worker validates the
 * result against source-media bounds.
 */
function trackTimeAt(clientX: number, trackRect: DOMRect, totalDuration: number): number | null {
  if (trackRect.width <= 0 || totalDuration <= 0) return null;
  const ratio = (clientX - trackRect.left) / trackRect.width;
  return Math.max(0, ratio * totalDuration);
}

/** Clip block renderer from mirrored timeline data. */
export function TimelineClip(props: TimelineClipProps) {
  // Derived accessors (not one-shot values): a SolidJS component body runs once,
  // so reading props.* here directly would freeze position/size at first render and
  // never reflect a move/trim/duration change. Evaluate inside the tracking context.
  const left = () => safePercent(props.clip.start, props.totalDuration);
  const width = () => safePercent(props.clip.duration, props.totalDuration);
  const waveformWidth = () =>
    Math.max(24, Math.floor((props.clip.duration / Math.max(props.totalDuration, 1)) * 900));
  const dragText = () => `${props.clip.id} (${props.clip.sourceId})`;
  let trimDebounce: ReturnType<typeof setTimeout> | null = null;
  let pendingTrimTime = props.clip.start;
  let activeTrimEdge: 'in' | 'out' | null = null;

  function scheduleTrim(clientX: number, trackRect: DOMRect) {
    if (!activeTrimEdge || !props.onTrim) return;
    const time = trackTimeAt(clientX, trackRect, props.totalDuration);
    if (time === null) return;
    pendingTrimTime = time;
    if (trimDebounce) clearTimeout(trimDebounce);
    const edge = activeTrimEdge;
    trimDebounce = setTimeout(() => {
      props.onTrim?.(props.trackId, props.clip.id, edge, time);
      trimDebounce = null;
    }, TRIM_DEBOUNCE_MS);
  }

  function finalizeTrim() {
    if (!activeTrimEdge || !props.onTrim) return;
    if (trimDebounce) {
      clearTimeout(trimDebounce);
      trimDebounce = null;
    }
    props.onTrim(props.trackId, props.clip.id, activeTrimEdge, pendingTrimTime);
    activeTrimEdge = null;
  }

  function onTrimPointerDown(edge: 'in' | 'out', event: PointerEvent) {
    if (!props.onTrim) return;
    event.preventDefault();
    event.stopPropagation();
    const clipEl = event.currentTarget as HTMLElement;
    // Sample against the track surface so the cursor can leave the clip in
    // either direction during the drag — required for outward trims.
    const trackEl = clipEl?.closest('.track-surface') as HTMLElement | null;
    if (!trackEl) return;
    const trackRect = trackEl.getBoundingClientRect();
    if (trackRect.width <= 0) return;

    activeTrimEdge = edge;
    scheduleTrim(event.clientX, trackRect);

    const onMove = (move: PointerEvent) => {
      scheduleTrim(move.clientX, trackRect);
    };
    const onUp = (up: PointerEvent) => {
      scheduleTrim(up.clientX, trackRect);
      finalizeTrim();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  /** Keyboard delete so clips of any duration (including those without the
   *  on-clip × button) can be removed when focused. */
  function onKeyDown(event: KeyboardEvent) {
    if (!props.onDelete) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      props.onDelete(props.trackId, props.clip.id);
    }
  }

  function onSplit(event: MouseEvent) {
    if (!props.onSplit || props.clip.duration <= 0.001) return;
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const splitTime = clamp(props.clip.start + ratio * props.clip.duration, props.clip.start, props.clip.start + props.clip.duration);
    props.onSplit(props.trackId, props.clip.id, splitTime);
  }

  function shouldSplitEdge(event: PointerEvent): 'in' | 'out' | null {
    if (props.clip.duration <= 0.001) return null;
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const cursor = event.clientX - rect.left;
    if (cursor <= EDGE_HANDLE_PX) return 'in';
    if (rect.width - cursor <= EDGE_HANDLE_PX) return 'out';
    return null;
  }

  function onPointerDown(event: PointerEvent) {
    const edge = shouldSplitEdge(event);
    if (!edge) {
      props.onSelect?.();
      return;
    }
    onTrimPointerDown(edge, event);
  }

  return (
    <div
      class={`timeline-clip${props.selected ? ' is-selected' : ''}`}
      style={{ left: left(), width: width() }}
      title={dragText()}
      draggable="true"
      tabindex="0"
      onKeyDown={onKeyDown}
      onDragStart={(event: DragEvent) => props.onMoveStart?.(props.trackId, props.clip.id, event)}
      onPointerDown={onPointerDown}
      onDblClick={onSplit}
    >
      <span class="timeline-clip-inner">
        <Show when={props.isAudio && props.peaks}>
          {(peaks) => (
            <Waveform peaks={peaks()} width={waveformWidth()} height={24} />
          )}
        </Show>
        {props.clip.duration > 0.2 ? <span class="timeline-clip-id">{props.clip.id}</span> : null}
        <span class="timeline-clip-left-handle" />
        <span class="timeline-clip-right-handle" />
        {props.clip.duration > 0.2 ? (
          <button
            class="timeline-clip-delete"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              props.onDelete?.(props.trackId, props.clip.id);
            }}
            aria-label={`Delete ${props.clip.id}`}
          >
            ×
          </button>
        ) : null}
      </span>
    </div>
  );
}
