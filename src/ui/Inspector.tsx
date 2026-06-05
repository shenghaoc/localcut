import { Show } from 'solid-js';
import type { MediaMetadata } from '../protocol';

interface InspectorProps {
  metadata: MediaMetadata | null;
}

export function Inspector(props: InspectorProps) {
  return (
    <aside class="inspector panel">
      <h2 class="panel-title">Inspector</h2>
      <Show when={props.metadata} fallback={<p class="placeholder-text">No clip selected</p>}>
        {(meta) => (
          <dl class="metadata-list">
            <dt>Duration</dt>
            <dd class="tabular-nums">{meta().duration.toFixed(2)}s</dd>
            <dt>Tracks</dt>
            <dd>{meta().trackCount}</dd>
            <Show when={meta().video} keyed>
              {(video) => (
                <>
                  <dt>Video</dt>
                  <dd>
                    {video.width}×{video.height}
                    {video.codec ? ` · ${video.codec}` : ''}
                    {video.frameRate != null ? ` · ${video.frameRate.toFixed(2)} fps` : ''}
                  </dd>
                </>
              )}
            </Show>
            <Show when={meta().audio} keyed>
              {(audio) => (
                <>
                  <dt>Audio</dt>
                  <dd>
                    {audio.channels} ch · {audio.sampleRate} Hz
                    {audio.codec ? ` · ${audio.codec}` : ''}
                  </dd>
                </>
              )}
            </Show>
          </dl>
        )}
      </Show>
    </aside>
  );
}
