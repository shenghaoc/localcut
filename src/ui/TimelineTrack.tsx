import { Show } from 'solid-js';
import { ChevronDown, ChevronUp, Film, Headphones, Music2, Trash2, VolumeX } from 'lucide-solid';
import { type TimelineTrackSnapshot as ProtocolTimelineTrack } from '../protocol';

interface TimelineTrackProps {
  track: ProtocolTimelineTrack;
  index: number;
  trackCount: number;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

/** Track label + management controls (reorder / remove) for timeline mirror models. */
export function TimelineTrack(props: TimelineTrackProps) {
  return (
    <div class="track-label">
      <span class="track-label-main">
        {props.track.type === 'video' ? (
          <Film size={13} aria-hidden="true" />
        ) : (
          <Music2 size={13} aria-hidden="true" />
        )}
        <span>{props.track.id}</span>
      </span>
      <span class="track-label-meta">
        {props.track.clips.length} clip{props.track.clips.length === 1 ? '' : 's'}
      </span>
      <Show when={props.track.solo || props.track.muted}>
        <span class="track-badges">
          {props.track.solo ? (
            <span class="track-badge">
              <Headphones size={11} aria-hidden="true" />
              Solo
            </span>
          ) : null}
          {props.track.muted ? (
            <span class="track-badge is-muted">
              <VolumeX size={11} aria-hidden="true" />
              Muted
            </span>
          ) : null}
        </span>
      </Show>
      <span class="track-controls">
        <button
          type="button"
          class="track-control-button"
          onClick={() => props.onMoveUp()}
          disabled={props.index === 0}
          aria-label={`Move ${props.track.id} up`}
          title="Move track up"
        >
          <ChevronUp size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          class="track-control-button"
          onClick={() => props.onMoveDown()}
          disabled={props.index >= props.trackCount - 1}
          aria-label={`Move ${props.track.id} down`}
          title="Move track down"
        >
          <ChevronDown size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          class="track-control-button is-danger"
          onClick={() => props.onRemove()}
          aria-label={`Remove ${props.track.id}`}
          title="Remove track"
        >
          <Trash2 size={12} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}
