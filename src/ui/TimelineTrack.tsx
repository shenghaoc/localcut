import { Show } from 'solid-js';
import { ChevronDown, ChevronUp, Eye, EyeOff, Film, Headphones, Link2, Lock, Music2, Target, Trash2, Unlock, VolumeX } from 'lucide-solid';
import { type TimelineTrackSnapshot as ProtocolTimelineTrack } from '../protocol';

interface TimelineTrackProps {
  track: ProtocolTimelineTrack;
  index: number;
  trackCount: number;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSetLock: (locked: boolean) => void;
  onSetVisible: (visible: boolean) => void;
  onSetSyncLock: (syncLocked: boolean) => void;
  onSetEditTarget: (editTarget: boolean) => void;
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
          class={`track-control-button${props.track.locked ? ' is-active' : ''}`}
          onClick={() => props.onSetLock(!props.track.locked)}
          aria-label={props.track.locked ? `Unlock ${props.track.id}` : `Lock ${props.track.id}`}
          aria-pressed={props.track.locked}
          title={props.track.locked ? 'Unlock track' : 'Lock track'}
        >
          {props.track.locked ? <Lock size={12} aria-hidden="true" /> : <Unlock size={12} aria-hidden="true" />}
        </button>
        <button
          type="button"
          class={`track-control-button${!props.track.visible ? ' is-active' : ''}`}
          onClick={() => props.onSetVisible(!props.track.visible)}
          aria-label={props.track.visible ? `Hide ${props.track.id}` : `Show ${props.track.id}`}
          aria-pressed={!props.track.visible}
          title={props.track.visible ? 'Hide track' : 'Show track'}
        >
          {props.track.visible ? <Eye size={12} aria-hidden="true" /> : <EyeOff size={12} aria-hidden="true" />}
        </button>
        <button
          type="button"
          class={`track-control-button${props.track.syncLocked ? ' is-active' : ''}`}
          onClick={() => props.onSetSyncLock(!props.track.syncLocked)}
          aria-label={props.track.syncLocked ? `Unsync ${props.track.id}` : `Sync-lock ${props.track.id}`}
          aria-pressed={props.track.syncLocked}
          title={props.track.syncLocked ? 'Disable sync lock' : 'Enable sync lock'}
        >
          <Link2 size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          class={`track-control-button${props.track.editTarget ? ' is-active' : ''}`}
          onClick={() => props.onSetEditTarget(!props.track.editTarget)}
          aria-label={props.track.editTarget ? `Untarget ${props.track.id}` : `Target ${props.track.id}`}
          aria-pressed={props.track.editTarget}
          title={props.track.editTarget ? 'Disable edit target' : 'Enable edit target'}
        >
          <Target size={12} aria-hidden="true" />
        </button>
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
