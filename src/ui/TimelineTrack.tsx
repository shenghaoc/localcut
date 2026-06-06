import { Show, type JSX } from 'solid-js';
import { Film, Headphones, Music2, VolumeX } from 'lucide-solid';
import { type TimelineTrackSnapshot as ProtocolTimelineTrack } from '../protocol';

interface TimelineTrackProps {
  track: ProtocolTimelineTrack;
  totalDuration: number;
  children?: JSX.Element | JSX.Element[];
}

/** Track row renderer for timeline mirror models. */
export function TimelineTrack(props: TimelineTrackProps) {
  return (
    <div class="timeline-track-row">
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
      </div>
      <div class="track-surface">
        {props.children}
      </div>
    </div>
  );
}
