import { type TimelineClip as ProtocolTimelineClip } from '../protocol';

interface TimelineClipProps {
  trackId: string;
  clip: ProtocolTimelineClip;
  totalDuration: number;
  onSplit?: (trackId: string, clipId: string, time: number) => void;
  onDelete?: (trackId: string, clipId: string) => void;
  onTrim?: (trackId: string, clipId: string, edge: 'in' | 'out', time: number) => void;
  onMoveStart?: (trackId: string, clipId: string, event: DragEvent) => void;
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

function makeTrimTime(clip: ProtocolTimelineClip, edge: 'in' | 'out', clientX: number, widthPx: number, leftPx: number): number {
  const ratio = clamp((clientX - leftPx) / widthPx, 0, 1);
  const candidate = clip.start + ratio * clip.duration;
  const start = clip.start;
  const end = start + clip.duration;
  return edge === 'in' ? clamp(candidate, start, end - 0.001) : clamp(candidate, start + 0.001, end);
}

/** Clip block renderer from mirrored timeline data. */
export function TimelineClip(props: TimelineClipProps) {
  const left = safePercent(props.clip.start, props.totalDuration);
  const width = safePercent(props.clip.duration, props.totalDuration);
  const dragText = `${props.clip.id} (${props.clip.sourceId})`;
  let trimDebounce: ReturnType<typeof setTimeout> | null = null;
  let pendingTrimTime = props.clip.start;
  let activeTrimEdge: 'in' | 'out' | null = null;

  function scheduleTrim(clientX: number, rect: DOMRect) {
    if (!activeTrimEdge || !props.onTrim) return;
    pendingTrimTime = makeTrimTime(props.clip, activeTrimEdge, clientX, rect.width, rect.left);
    if (trimDebounce) clearTimeout(trimDebounce);
    const edge = activeTrimEdge;
    const time = pendingTrimTime;
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
    if (!clipEl) return;
    const rect = clipEl.getBoundingClientRect();
    if (rect.width <= 0) return;

    activeTrimEdge = edge;
    scheduleTrim(event.clientX, rect);

    const onMove = (move: PointerEvent) => {
      scheduleTrim(move.clientX, rect);
    };
    const onUp = (up: PointerEvent) => {
      scheduleTrim(up.clientX, rect);
      finalizeTrim();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
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
    if (!edge) return;
    onTrimPointerDown(edge, event);
  }

  return (
    <div
      class="timeline-clip"
      style={{ left, width }}
      title={dragText}
      draggable="true"
      onDragStart={(event: DragEvent) => props.onMoveStart?.(props.trackId, props.clip.id, event)}
      onPointerDown={onPointerDown}
      onDblClick={onSplit}
    >
      <span class="timeline-clip-inner">
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
