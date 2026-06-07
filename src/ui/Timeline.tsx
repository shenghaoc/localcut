import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import {
  Film,
  Flag,
  Magnet,
  Music2,
  RotateCcw,
  SkipBack,
  SkipForward,
  Type,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-solid';
import { TimelineClip } from './TimelineClip';
import { TimelineTrack } from './TimelineTrack';
import { ASSET_DRAG_MIME } from './MediaBin';
import type { ThumbnailEntry } from './thumbnail-store';
import {
  type ClipEffectParamsSnapshot,
  type TimelineClipMove,
  type TimelineClipReference,
  type TimelineClipSnapshot as ProtocolTimelineClip,
  type TimelineMarkerSnapshot,
  type TimelineTrackSnapshot as ProtocolTimelineTrack,
  type WaveformPeaks,
} from '../protocol';
import {
  buildSnapTargets,
  selectClipsInMarquee,
  timelineTimeAtClientX,
} from './timeline-interaction';

interface TimelineProps {
  currentTime: () => number;
  duration: () => number;
  /** Source frame rate for the timecode frame field; null falls back to 30. */
  frameRate?: () => number | null;
  hasMedia: boolean;
  timeline: () => ProtocolTimelineTrack[];
  markers: () => TimelineMarkerSnapshot[];
  selectedClipRefs: () => readonly TimelineClipReference[];
  onSeek: (time: number) => void;
  onSplit: (trackId: string, clipId: string, time: number) => void;
  onDelete: (trackId: string, clipId: string) => void;
  onTrim: (trackId: string, clipId: string, edge: 'in' | 'out', time: number) => void;
  onMoveClips: (moves: TimelineClipMove[]) => void;
  onSelectClip: (trackId: string, clipId: string, effects: ClipEffectParamsSnapshot, additive: boolean, exclusive: boolean) => void;
  onSelectClips: (clips: TimelineClipReference[]) => void;
  onAddTitle: (start: number) => void;
  onAddMarker: (time: number, label: string) => void;
  onDeleteMarker: (markerId: string) => void;
  onCloseGaps: (trackId?: string) => void;
  waveformPeaks?: () => Record<string, WaveformPeaks>;
  onPlaceAsset: (sourceId: string, trackId: string, start: number) => void;
  onAddTrack: (trackType: 'video' | 'audio') => void;
  onRemoveTrack: (trackId: string) => void;
  onReorderTrack: (trackId: string, toIndex: number) => void;
  onSetTrackLock: (trackId: string, locked: boolean) => void;
  onSetTrackVisible: (trackId: string, visible: boolean) => void;
  onSetTrackSyncLock: (trackId: string, syncLocked: boolean) => void;
  onSetTrackEditTarget: (trackId: string, editTarget: boolean) => void;
  getThumbnail: (sourceId: string, timestamp: number) => ThumbnailEntry | null;
  thumbnailVersion: () => number;
  onRequestThumbnails: (sourceId: string, timestamps: number[]) => void;
}

interface MarqueeBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const DEFAULT_FPS = 30;
const DEFAULT_PX_PER_SECOND = 80;
const MIN_PX_PER_SECOND = 28;
const MAX_PX_PER_SECOND = 420;
const RULER_INTERVALS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

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

function formatTick(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}:${String(m).padStart(2, '0')}`;
  }
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  return seconds % 1 === 0 ? `${seconds}s` : `${seconds.toFixed(1)}s`;
}

function selectionKey(ref: TimelineClipReference): string {
  return `${ref.trackId}:${ref.clipId}`;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('button, input, .timeline-clip, .timeline-ruler-wrap');
}

export function Timeline(props: TimelineProps) {
  const fps = () => props.frameRate?.() ?? DEFAULT_FPS;
  const [pxPerSecond, setPxPerSecond] = createSignal(DEFAULT_PX_PER_SECOND);
  const [snapEnabled, setSnapEnabled] = createSignal(true);
  const [isScrubbing, setIsScrubbing] = createSignal(false);
  const [marquee, setMarquee] = createSignal<MarqueeBox | null>(null);
  const [dropTrackId, setDropTrackId] = createSignal<string | null>(null);
  let scrollEl: HTMLDivElement | undefined;
  let contentEl: HTMLDivElement | undefined;
  let zoomRaf: number | null = null;
  let cleanupScrubListeners: (() => void) | null = null;
  let cleanupMarqueeListeners: (() => void) | null = null;

  const timelineDuration = () => Math.max(0, props.duration());
  const boundedCurrentTime = () =>
    timelineDuration() > 0 ? Math.min(timelineDuration(), Math.max(0, props.currentTime())) : 0;

  const modelDuration = createMemo(() => {
    let end = timelineDuration();
    for (const track of props.timeline()) {
      for (const clip of track.clips) {
        end = Math.max(end, clip.start + clip.duration);
      }
    }
    for (const marker of props.markers()) {
      end = Math.max(end, marker.time + 1);
    }
    return Math.max(1, end);
  });

  const contentWidth = createMemo(() =>
    Math.max(720, Math.ceil(modelDuration() * pxPerSecond()) + 96),
  );

  const selectedKeys = createMemo(() => new Set(props.selectedClipRefs().map(selectionKey)));
  const snapTargets = createMemo(() =>
    buildSnapTargets(props.timeline(), props.markers(), boundedCurrentTime()),
  );

  const rulerInterval = createMemo(() => {
    const pps = pxPerSecond();
    const duration = modelDuration();
    for (const interval of RULER_INTERVALS) {
      if (interval * pps >= 64 && duration / interval <= 500) return interval;
    }
    return RULER_INTERVALS[RULER_INTERVALS.length - 1]!;
  });

  const rulerTicks = createMemo(() => {
    const ticks: { time: number; label: string }[] = [];
    const interval = rulerInterval();
    const duration = modelDuration();
    // Integer indexing avoids the rounding drift of `time += interval` (e.g.
    // 0.1 accumulating to 9.99999…) and the phantom trailing tick a float guard
    // could emit.
    const count = Math.ceil(duration / interval);
    for (let i = 0; i <= count; i++) {
      const time = Math.round(i * interval * 1000) / 1000;
      ticks.push({ time, label: formatTick(time) });
    }
    return ticks;
  });

  function findClip(ref: TimelineClipReference): ProtocolTimelineClip | null {
    const track = props.timeline().find((item) => item.id === ref.trackId);
    return track?.clips.find((clip) => clip.id === ref.clipId) ?? null;
  }

  function selectedTrackId(): string | undefined {
    const selected = props.selectedClipRefs()[0];
    return selected?.trackId;
  }

  function seekTo(time: number) {
    const duration = props.duration();
    if (duration <= 0) return;
    props.onSeek(Math.max(0, Math.min(duration, time)));
  }

  function recenterOnPlayhead() {
    if (!scrollEl) return;
    if (zoomRaf !== null) cancelAnimationFrame(zoomRaf);
    zoomRaf = requestAnimationFrame(() => {
      zoomRaf = null;
      if (!scrollEl) return;
      const center = boundedCurrentTime() * pxPerSecond() - scrollEl.clientWidth / 2;
      scrollEl.scrollLeft = Math.max(0, center);
    });
  }

  function zoomBy(multiplier: number) {
    setPxPerSecond((current) =>
      Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, current * multiplier)),
    );
    recenterOnPlayhead();
  }

  function seekFromClientX(clientX: number, ruler: HTMLElement) {
    const rect = ruler.getBoundingClientRect();
    const time = timelineTimeAtClientX(clientX, rect.left, pxPerSecond());
    if (time === null) return;
    seekTo(time);
  }

  function onScrubKeyDown(event: KeyboardEvent) {
    const frameStep = 1 / (fps() > 0 ? fps() : DEFAULT_FPS);
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        seekTo(boundedCurrentTime() - frameStep);
        break;
      case 'ArrowRight':
        event.preventDefault();
        seekTo(boundedCurrentTime() + frameStep);
        break;
      case 'PageDown':
        event.preventDefault();
        seekTo(boundedCurrentTime() - 1);
        break;
      case 'PageUp':
        event.preventDefault();
        seekTo(boundedCurrentTime() + 1);
        break;
      case 'Home':
        event.preventDefault();
        seekTo(0);
        break;
      case 'End':
        event.preventDefault();
        seekTo(props.duration());
        break;
    }
  }

  function onScrubPointerDown(event: PointerEvent) {
    const target = event.currentTarget as HTMLElement;
    event.preventDefault();
    event.stopPropagation();
    seekFromClientX(event.clientX, target);
    setIsScrubbing(true);
    const onMove = (move: PointerEvent) => {
      seekFromClientX(move.clientX, target);
    };
    const onUp = () => {
      setIsScrubbing(false);
      cleanupScrubListeners?.();
      cleanupScrubListeners = null;
    };
    cleanupScrubListeners?.();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    cleanupScrubListeners = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }

  function handleMoveClip(trackId: string, clipId: string, toStart: number, fromStart: number) {
    const currentRef = { trackId, clipId };
    const selection = selectedKeys().has(selectionKey(currentRef))
      ? props.selectedClipRefs()
      : [currentRef];
    const delta = toStart - fromStart;

    // Clamp the group delta once by the earliest selected start so the leftmost
    // clip lands at 0 without collapsing the relative offsets of the others
    // (independent per-clip clamping would overlap clips and the worker would
    // reject the whole move).
    let earliestStart = Number.POSITIVE_INFINITY;
    for (const ref of selection) {
      const clip = findClip(ref);
      if (clip) earliestStart = Math.min(earliestStart, clip.start);
    }
    const clampedDelta = Number.isFinite(earliestStart) ? Math.max(-earliestStart, delta) : delta;

    const moves: TimelineClipMove[] = [];
    for (const ref of selection) {
      const clip = findClip(ref);
      if (!clip) continue;
      moves.push({
        trackId: ref.trackId,
        clipId: ref.clipId,
        toTrackId: ref.trackId,
        toStart: clip.start + clampedDelta,
      });
    }
    if (moves.length > 0) props.onMoveClips(moves);
  }

  function markerAt(offset: 1 | -1): TimelineMarkerSnapshot | null {
    const sorted = [...props.markers()].sort((a, b) => a.time - b.time);
    if (sorted.length === 0) return null;
    const current = boundedCurrentTime();
    if (offset > 0) {
      return sorted.find((marker) => marker.time > current + 0.001) ?? sorted[0]!;
    }
    return [...sorted].reverse().find((marker) => marker.time < current - 0.001) ?? sorted[sorted.length - 1]!;
  }

  function trackIdsInVerticalRange(top: number, bottom: number): string[] {
    if (!contentEl) return [];
    const ids: string[] = [];
    for (const surface of contentEl.querySelectorAll<HTMLElement>('.track-surface[data-track-id]')) {
      const rect = surface.getBoundingClientRect();
      if (rect.top < bottom && rect.bottom > top) {
        const id = surface.dataset.trackId;
        if (id) ids.push(id);
      }
    }
    return ids;
  }

  function onContentPointerDown(event: PointerEvent) {
    if (event.button !== 0 || isInteractiveTarget(event.target) || !contentEl) return;
    event.preventDefault();
    const contentRect = contentEl.getBoundingClientRect();
    const startTime = timelineTimeAtClientX(event.clientX, contentRect.left, pxPerSecond());
    if (startTime === null) return;
    const startX = event.clientX;
    const startY = event.clientY;

    const updateBox = (move: PointerEvent) => {
      setMarquee({
        left: Math.min(startX, move.clientX) - contentRect.left,
        top: Math.min(startY, move.clientY) - contentRect.top,
        width: Math.abs(move.clientX - startX),
        height: Math.abs(move.clientY - startY),
      });
    };
    const onMove = (move: PointerEvent) => updateBox(move);
    const onUp = (up: PointerEvent) => {
      updateBox(up);
      const endTime = timelineTimeAtClientX(up.clientX, contentRect.left, pxPerSecond());
      const trackIds = trackIdsInVerticalRange(Math.min(startY, up.clientY), Math.max(startY, up.clientY));
      if (endTime !== null) {
        props.onSelectClips(
          selectClipsInMarquee(props.timeline(), {
            startTime,
            endTime,
            trackIds,
          }),
        );
      }
      setMarquee(null);
      cleanupMarqueeListeners?.();
      cleanupMarqueeListeners = null;
    };
    cleanupMarqueeListeners?.();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    cleanupMarqueeListeners = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }

  function dragHasAsset(event: DragEvent): boolean {
    return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes(ASSET_DRAG_MIME);
  }

  function onTrackDragOver(trackId: string, event: DragEvent) {
    if (!dragHasAsset(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    if (dropTrackId() !== trackId) setDropTrackId(trackId);
  }

  function onTrackDragLeave(trackId: string) {
    if (dropTrackId() === trackId) setDropTrackId(null);
  }

  function onTrackDrop(trackId: string, event: DragEvent) {
    if (!dragHasAsset(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setDropTrackId(null);
    const sourceId = event.dataTransfer?.getData(ASSET_DRAG_MIME);
    if (!sourceId || !contentEl) return;
    const rect = contentEl.getBoundingClientRect();
    const start = timelineTimeAtClientX(event.clientX, rect.left, pxPerSecond());
    if (start === null) return;
    props.onPlaceAsset(sourceId, trackId, Math.max(0, start));
  }

  onMount(() => {
    const onZoom = (event: Event) => {
      const detail = (event as CustomEvent<{ direction: 1 | -1 }>).detail;
      zoomBy(detail?.direction === 1 ? 1.25 : 0.8);
    };
    window.addEventListener('localcut-timeline-zoom', onZoom);
    onCleanup(() => {
      window.removeEventListener('localcut-timeline-zoom', onZoom);
      if (zoomRaf !== null) cancelAnimationFrame(zoomRaf);
      cleanupScrubListeners?.();
      cleanupMarqueeListeners?.();
    });
  });

  return (
    <section class="timeline panel">
      <div class="timeline-header">
        <div class="timeline-timecodes">
          <span class="timecode cur tabular-nums">{formatTimecode(boundedCurrentTime(), fps())}</span>
          <span class="timecode-sep">/</span>
          <span class="timecode tabular-nums muted">{formatTimecode(props.duration(), fps())}</span>
        </div>
        <div class="timeline-actions" role="group" aria-label="Timeline tools">
          <button
            type="button"
            class="timeline-tool-button"
            onClick={() => props.onAddTrack('video')}
            aria-label="Add video track"
            title="Add video track"
          >
            <Film size={13} aria-hidden="true" />+
          </button>
          <button
            type="button"
            class="timeline-tool-button"
            onClick={() => props.onAddTrack('audio')}
            aria-label="Add audio track"
            title="Add audio track"
          >
            <Music2 size={13} aria-hidden="true" />+
          </button>
          <button
            type="button"
            class="timeline-tool-button"
            onClick={() => props.onAddTitle(boundedCurrentTime())}
            aria-label="Add title clip"
            title="Add title at playhead"
          >
            <Type size={13} aria-hidden="true" />+
          </button>
          <button
            type="button"
            class="timeline-tool-button"
            onClick={() => {
              const marker = markerAt(-1);
              if (marker) seekTo(marker.time);
            }}
            disabled={props.markers().length === 0}
            aria-label="Previous marker"
            title="Previous marker"
          >
            <SkipBack size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            class="timeline-tool-button"
            onClick={() => props.onAddMarker(boundedCurrentTime(), `Marker ${props.markers().length + 1}`)}
            disabled={props.duration() <= 0}
            aria-label="Add marker at playhead"
            title="Add marker at playhead"
          >
            <Flag size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            class="timeline-tool-button"
            onClick={() => {
              const marker = markerAt(1);
              if (marker) seekTo(marker.time);
            }}
            disabled={props.markers().length === 0}
            aria-label="Next marker"
            title="Next marker"
          >
            <SkipForward size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            class={`timeline-tool-button${snapEnabled() ? ' is-active' : ''}`}
            onClick={() => setSnapEnabled((value) => !value)}
            aria-pressed={snapEnabled()}
            aria-label="Toggle snapping"
            title="Toggle snapping"
          >
            <Magnet size={13} aria-hidden="true" />
            Snap
          </button>
          <button
            type="button"
            class="timeline-tool-button"
            onClick={() => props.onCloseGaps(selectedTrackId())}
            disabled={props.timeline().length === 0}
            aria-label="Close gaps"
            title="Close gaps"
          >
            <RotateCcw size={13} aria-hidden="true" />
            Gaps
          </button>
          <button
            type="button"
            class="timeline-tool-button"
            onClick={() => zoomBy(0.8)}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <ZoomOut size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            class="timeline-tool-button"
            onClick={() => zoomBy(1.25)}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <ZoomIn size={13} aria-hidden="true" />
          </button>
        </div>
      </div>
      <Show when={props.hasMedia} fallback={<p class="placeholder-text">Import media to edit</p>}>
        <div class="timeline-track-wrapper">
          <div class="timeline-label-column">
            <For each={props.timeline()}>
              {(track, index) => (
                <TimelineTrack
                  track={track}
                  index={index()}
                  trackCount={props.timeline().length}
                  onRemove={() => props.onRemoveTrack(track.id)}
                  onMoveUp={() => props.onReorderTrack(track.id, index() - 1)}
                  onMoveDown={() => props.onReorderTrack(track.id, index() + 1)}
                  onSetLock={(locked) => props.onSetTrackLock(track.id, locked)}
                  onSetVisible={(visible) => props.onSetTrackVisible(track.id, visible)}
                  onSetSyncLock={(syncLocked) => props.onSetTrackSyncLock(track.id, syncLocked)}
                  onSetEditTarget={(editTarget) => props.onSetTrackEditTarget(track.id, editTarget)}
                />
              )}
            </For>
            <div class="timeline-ruler-label">Ruler</div>
          </div>
          <div
            class="timeline-scroll-viewport"
            ref={(el) => {
              scrollEl = el;
            }}
          >
            <div
              class="timeline-content"
              ref={(el) => {
                contentEl = el;
              }}
              style={{ width: `${contentWidth()}px` }}
              onPointerDown={onContentPointerDown}
            >
              <For each={props.timeline()}>
                {(track) => (
                  <div
                    class={`track-surface${dropTrackId() === track.id ? ' is-drop-target' : ''}`}
                    data-track-id={track.id}
                    style={{ width: `${contentWidth()}px` }}
                    onDragOver={(event) => onTrackDragOver(track.id, event)}
                    onDragLeave={() => onTrackDragLeave(track.id)}
                    onDrop={(event) => onTrackDrop(track.id, event)}
                  >
                    <For each={track.clips as ProtocolTimelineClip[]}>
                      {(clip) => (
                        <TimelineClip
                          trackId={track.id}
                          clip={clip}
                          pxPerSecond={pxPerSecond()}
                          snapEnabled={snapEnabled()}
                          snapTargets={snapTargets()}
                          selected={selectedKeys().has(selectionKey({ trackId: track.id, clipId: clip.id }))}
                          isAudio={track.type === 'audio'}
                          peaks={props.waveformPeaks?.()[`${track.id}:${clip.id}`] ?? null}
                          getThumbnail={props.getThumbnail}
                          thumbnailVersion={props.thumbnailVersion}
                          requestThumbnails={props.onRequestThumbnails}
                          onMove={handleMoveClip}
                          onSplit={props.onSplit}
                          onDelete={props.onDelete}
                          onTrim={props.onTrim}
                          onSelect={(additive, exclusive) => props.onSelectClip(track.id, clip.id, clip.effects, additive, exclusive)}
                        />
                      )}
                    </For>
                  </div>
                )}
              </For>
              <div class="timeline-marker-lane" style={{ width: `${contentWidth()}px` }}>
                <For each={props.markers()}>
                  {(marker) => (
                    <div class="timeline-marker" style={{ left: `${marker.time * pxPerSecond()}px` }}>
                      <button
                        type="button"
                        class="timeline-marker-button"
                        onClick={() => seekTo(marker.time)}
                        title={marker.label}
                      >
                        <Flag size={11} aria-hidden="true" />
                        <span>{marker.label}</span>
                      </button>
                      <button
                        type="button"
                        class="timeline-marker-delete"
                        onClick={() => props.onDeleteMarker(marker.id)}
                        aria-label={`Delete ${marker.label}`}
                        title={`Delete ${marker.label}`}
                      >
                        <X size={10} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </For>
              </div>
              <div
                class={`timeline-ruler-wrap ${isScrubbing() ? 'is-scrubbing' : ''}`}
                style={{ width: `${contentWidth()}px` }}
                onPointerDown={onScrubPointerDown}
                onKeyDown={onScrubKeyDown}
                tabIndex={0}
                role="slider"
                aria-roledescription="timeline seek control"
                aria-label="Timeline"
                aria-valuemin={0}
                aria-valuemax={props.duration()}
                aria-valuenow={boundedCurrentTime()}
                aria-valuetext={formatTimecode(boundedCurrentTime(), fps())}
              >
                <div class="timeline-ruler">
                  <For each={rulerTicks()}>
                    {(tick) => (
                      <span class="timeline-ruler-tick" style={{ left: `${tick.time * pxPerSecond()}px` }}>
                        <span>{tick.label}</span>
                      </span>
                    )}
                  </For>
                </div>
              </div>
              <div class="scrubhead" style={{ left: `${boundedCurrentTime() * pxPerSecond()}px` }} />
              <Show when={marquee()}>
                {(box) => (
                  <div
                    class="timeline-marquee"
                    style={{
                      left: `${box().left}px`,
                      top: `${box().top}px`,
                      width: `${box().width}px`,
                      height: `${box().height}px`,
                    }}
                  />
                )}
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </section>
  );
}
