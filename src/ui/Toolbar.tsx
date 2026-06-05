import { Show, type JSX } from 'solid-js';
import { FolderOpen, Pause, Play, SkipBack, SkipForward } from 'lucide-solid';
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
        <h1 class="app-title">Browser Editor</h1>
        <label
          class={cn(
            buttonVariants({ variant: 'default' }),
            'import-picker',
            props.disabled && 'is-disabled',
          )}
        >
          <FolderOpen size={14} aria-hidden="true" />
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
            {props.metadata!.fileName}
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
            <SkipBack size={14} aria-hidden="true" />
          </Button>
          <Button
            class="transport-play"
            onClick={() => props.onPlay()}
            disabled={transportDisabled() || props.playing()}
          >
            <Play size={14} aria-hidden="true" />
            Play
          </Button>
          <Button
            onClick={() => props.onPause()}
            disabled={props.disabled || !props.playing()}
          >
            <Pause size={14} aria-hidden="true" />
            Pause
          </Button>
          <Button
            size="icon"
            onClick={() => props.onStep(1)}
            disabled={transportDisabled()}
            aria-label="Step forward one frame"
            title="Step forward one frame"
          >
            <SkipForward size={14} aria-hidden="true" />
          </Button>
        </div>
        {props.exportControl}
      </div>
    </header>
  );
}
