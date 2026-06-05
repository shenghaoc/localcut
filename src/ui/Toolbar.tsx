import { Show, type JSX } from 'solid-js';
import { cn } from '../lib/utils';
import { Button, buttonVariants } from './components/button';
import type { MediaMetadata } from '../protocol';

interface ToolbarProps {
  metadata: MediaMetadata | null;
  playing: () => boolean;
  importAccept: string;
  onImportFile: (file: File) => void;
  onPlay: () => void;
  onPause: () => void;
  onStep: (direction: 1 | -1) => void;
  disabled?: boolean;
  exportControl?: JSX.Element;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export function Toolbar(props: ToolbarProps) {
  const hasVideo = () => props.metadata?.video != null;
  const transportDisabled = () => props.disabled || !hasVideo();
  const handleImportInput = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (file) props.onImportFile(file);
  };

  return (
    <header class="toolbar">
      <div class="toolbar-left">
        <div class="app-brand">
          <span class="app-glyph" aria-hidden="true" />
          <h1 class="app-title">Browser Editor</h1>
        </div>
        <label
          class={cn(
            buttonVariants({ variant: 'default' }),
            'import-picker',
            props.disabled && 'is-disabled pointer-events-none',
          )}
        >
          Import
          <input
            class="import-picker-input"
            type="file"
            accept={props.importAccept}
            onChange={handleImportInput}
            disabled={props.disabled}
            aria-label="Import media"
          />
        </label>
      </div>
      <div class="toolbar-center">
        <span class="file-name">
          <Show when={props.metadata} fallback="No media loaded">
            {(meta) => meta().fileName}
          </Show>
        </span>
      </div>
      <div class="toolbar-right">
        <div class="transport-controls" role="group" aria-label="Transport">
          <Button
            size="icon"
            onClick={() => props.onStep(-1)}
            disabled={transportDisabled()}
            aria-label="Step back one frame"
            title="Step back one frame"
          >
            ⏮
          </Button>
          <Button
            class="transport-play"
            onClick={() => props.onPlay()}
            disabled={transportDisabled() || props.playing()}
          >
            Play
          </Button>
          <Button
            onClick={() => props.onPause()}
            disabled={props.disabled || !props.playing()}
          >
            Pause
          </Button>
          <Button
            size="icon"
            onClick={() => props.onStep(1)}
            disabled={transportDisabled()}
            aria-label="Step forward one frame"
            title="Step forward one frame"
          >
            ⏭
          </Button>
        </div>
        {props.exportControl}
        <Button
          size="icon"
          onClick={() => props.onToggleTheme()}
          aria-label={props.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={props.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {props.theme === 'dark' ? '☀' : '☾'}
        </Button>
      </div>
    </header>
  );
}
