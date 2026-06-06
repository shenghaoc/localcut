import { createSignal, onCleanup, Show } from 'solid-js';
import { type TimelineClipSnapshot as ProtocolTimelineClip, type WaveformPeaks } from '../protocol';
import {
  resolveSnap,
  timelineTimeAtClientX,
  type SnapTarget,
} from './timeline-interaction';
import { Waveform } from './Waveform';

interface TimelineClipProps {
  trackId: string;
  clip: ProtocolTimelineClip;
  pxPerSecond: number;
  snapEnabled: boolean;
  snapTargets: readonly SnapTarget[];
  onMove?: (trackId: string, clipId: string, toStart: number, fromStart: number) => void;
  onSplit?: (trackId: string, clipId: string, time: number) => void;
  onDelete?: (trackId: string, clipId: string) => void;
  onTrim?: (trackId: string, clipId: string, edge: 'in' | 'out', time: number) => void;
  selected?: boolean;
  onSelect?: (additive: boolean, exclusive: boolean) => void;
  peaks?: WaveformPeaks | null;
  isAudio?: boolean;
}

const EDGE_HANDLE_PX = 10;
const TRIM_DEBOUNCE_MS = 60;
const SNAP_THRESHOLD_PX = 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Maps a pointer x-coordinate against the *track surface* (not the clip) into a
 * timeline time. Track-relative drags let the user pull the in/out edge past
 * the clip's current bounds to extend it back out; the worker validates the
 * result against source-media bounds.
 */
function trackTimeAt(
  clientX: number,
  trackRect: DOMRect,
  pxPerSecond: number,
  snapEnabled: boolean,
  snapTargets: readonly SnapTarget[],
): number | null {
  const time = timelineTimeAtClientX(clientX, trackRect.left, pxPerSecond);
  if (time === null) return null;
  return snapEnabled
    ? resolveSnap(time, pxPerSecond, snapTargets, SNAP_THRESHOLD_PX).time
    : time;
}

/** Clip block renderer from mirrored timeline data. */
export function TimelineClip(props: TimelineClipProps) {
  // Derived accessors (not one-shot values): a SolidJS component body runs once,
  // so reading props.* here directly would freeze position/size at first render and
  // never reflect a move/trim/duration change. Evaluate inside the tracking context.
  const [dragPreviewStart, setDragPreviewStart] = createSignal<number | null>(null);
  const left = () => `${(dragPreviewStart() ?? props.clip.start) * props.pxPerSecond}px`;
  const width = () => `${Math.max(10, props.clip.duration * props.pxPerSecond)}px`;
  const waveformWidth = () =>
    Math.max(24, Math.floor(props.clip.duration * props.pxPerSecond));
  const clipTitle = () => `${props.clip.id} (${props.clip.sourceId})`;
  let trimDebounce: ReturnType<typeof setTimeout> | null = null;
  let pendingTrimTime = props.clip.start;
  let activeTrimEdge: 'in' | 'out' | null = null;
  let cleanupPointerListeners: (() => void) | null = null;

  function clearPointerListeners() {
    cleanupPointerListeners?.();
    cleanupPointerListeners = null;
  }

  onCleanup(clearPointerListeners);

  function scheduleTrim(clientX: number, trackRect: DOMRect) {
    if (!activeTrimEdge || !props.onTrim) return;
    const time = trackTimeAt(
      clientX,
      trackRect,
      props.pxPerSecond,
      props.snapEnabled,
      props.snapTargets,
    );
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
      clearPointerListeners();
    };

    clearPointerListeners();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    cleanupPointerListeners = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
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

  function onMovePointerDown(event: PointerEvent) {
    event.stopPropagation();
    // Select on pointerdown so a group drag can begin immediately; App keeps an
    // existing multi-selection intact when the clicked clip is already part of it.
    props.onSelect?.(event.shiftKey, false);
    if (!props.onMove) return;
    event.preventDefault();
    const clipEl = event.currentTarget as HTMLElement;
    const trackEl = clipEl?.closest('.track-surface') as HTMLElement | null;
    if (!trackEl) return;
    const originX = event.clientX;
    const originStart = props.clip.start;
    let moved = false;
    let finalStart = originStart;

    const onMove = (move: PointerEvent) => {
      const delta = (move.clientX - originX) / props.pxPerSecond;
      const candidate = Math.max(0, originStart + delta);
      finalStart = props.snapEnabled
        ? resolveSnap(candidate, props.pxPerSecond, props.snapTargets, SNAP_THRESHOLD_PX).time
        : candidate;
      moved ||= Math.abs(finalStart - originStart) > 0.001;
      setDragPreviewStart(finalStart);
    };
    const onUp = (up: PointerEvent) => {
      onMove(up);
      setDragPreviewStart(null);
      clearPointerListeners();
      if (moved) {
        props.onMove?.(props.trackId, props.clip.id, finalStart, originStart);
      } else if (!up.shiftKey) {
        // A plain click (no drag, no shift) collapses any multi-selection down to
        // just this clip; the pointerdown handler had preserved the group in case
        // the user intended a drag.
        props.onSelect?.(false, true);
      }
    };

    clearPointerListeners();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    cleanupPointerListeners = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }

  function onPointerDown(event: PointerEvent) {
    const edge = shouldSplitEdge(event);
    if (!edge) {
      onMovePointerDown(event);
      return;
    }
    onTrimPointerDown(edge, event);
  }

  return (
    <div
      class={`timeline-clip${props.isAudio ? ' is-audio' : ''}${props.selected ? ' is-selected' : ''}${dragPreviewStart() !== null ? ' is-dragging' : ''}${props.clip.offline ? ' is-offline' : ''}`}
      style={{ left: left(), width: width() }}
      title={clipTitle()}
      role="button"
      aria-pressed={!!props.selected}
      aria-label={`${clipTitle()}${props.clip.offline ? ' offline' : ''}`}
      tabindex="0"
      onKeyDown={onKeyDown}
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
          <span
            class="timeline-clip-delete"
            role="button"
            tabIndex={-1}
            aria-label={`Delete ${props.clip.id}`}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.stopPropagation();
                event.preventDefault();
                props.onDelete?.(props.trackId, props.clip.id);
              }
            }}
            onClick={(event) => {
              event.stopPropagation();
              props.onDelete?.(props.trackId, props.clip.id);
            }}
          >
            ×
          </span>
        ) : null}
      </span>
    </div>
  );
}
