import { Show } from 'solid-js';
import type { MediaMetadata } from '../protocol';

interface ToolbarProps {
  metadata: MediaMetadata | null;
  playing: () => boolean;
  onImport: () => void;
  onPlay: () => void;
  onPause: () => void;
}

export function Toolbar(props: ToolbarProps) {
  return (
    <header class="toolbar">
      <div class="toolbar-left">
        <h1 class="app-title">Editor</h1>
        <button type="button" class="btn" onClick={() => props.onImport()}>
          Import
        </button>
      </div>
      <div class="toolbar-center">
        <Show when={props.metadata}>
          <span class="file-name">{props.metadata!.fileName}</span>
        </Show>
      </div>
      <div class="toolbar-right">
        <Show when={props.metadata}>
          <button type="button" class="btn" onClick={() => props.onPlay()} disabled={props.playing()}>
            Play
          </button>
          <button type="button" class="btn" onClick={() => props.onPause()} disabled={!props.playing()}>
            Pause
          </button>
        </Show>
      </div>
    </header>
  );
}
