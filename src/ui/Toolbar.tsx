import { Show, type JSX } from 'solid-js';
import {
  Activity,
  Cpu,
  FolderOpen,
  Gauge,
  Info,
  Pause,
  Play,
  Scissors,
  ShieldCheck,
  SkipBack,
  SkipForward,
} from 'lucide-solid';
import { cn } from '../lib/utils';
import { Button, buttonVariants } from './components/button';
import type { CapabilityTier } from './capabilities';
import type { MediaMetadata } from '../protocol';

interface ToolbarProps {
  metadata: MediaMetadata | null;
  playing: () => boolean;
  importAccept: string;
  onImportFile: (file: File) => void;
  onPlay: () => void;
  onPause: () => void;
  onStep: (direction: 1 | -1) => void;
  transportDisabled?: boolean;
  importBlocked?: boolean;
  importHint?: string | null;
  crossOriginIsolated: boolean;
  pipelineMode: CapabilityTier;
  previewLabel: string | null;
  encodeFps: number | null;
  onOpenCapabilities?: () => void;
  exportControl?: JSX.Element;
}

export function Toolbar(props: ToolbarProps) {
  const hasVideo = () => props.metadata?.video != null;
  const transportDisabled = () => props.transportDisabled || !hasVideo();
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
          <span class="app-glyph" aria-hidden="true">
            <Scissors size={15} />
          </span>
          <div class="app-brand-copy">
            <h1 class="app-title">LocalCut Studio</h1>
            <span class="app-kicker">Browser-native NLE</span>
          </div>
        </div>
        <label
          class={cn(
            buttonVariants({ variant: 'default' }),
            'import-picker',
            props.importBlocked && 'is-disabled pointer-events-none',
          )}
          title={props.importHint ?? undefined}
        >
          <FolderOpen size={14} aria-hidden="true" />
          Import
          <input
            class="import-picker-input"
            type="file"
            accept={props.importAccept}
            onChange={handleImportInput}
            disabled={props.importBlocked}
            aria-label="Import media"
            title={props.importHint ?? undefined}
          />
        </label>
      </div>
      <div class="toolbar-center">
        <div class="pipeline-strip" aria-label="Pipeline status">
          <span
            class={cn(
              'pipeline-chip',
              props.pipelineMode === 'accelerated' && 'is-ok',
              props.pipelineMode === 'limited' && 'is-warn',
              props.pipelineMode === 'starting' && 'is-waiting',
              props.pipelineMode === 'blocked' && 'is-warn',
            )}
          >
            <Gauge size={13} aria-hidden="true" />
            {props.pipelineMode === 'accelerated'
              ? 'Accelerated'
              : props.pipelineMode === 'limited'
                ? 'Limited shell'
                : props.pipelineMode === 'blocked'
                  ? 'Blocked'
                  : 'Starting pipeline'}
          </span>
          <span class="pipeline-chip">
            <Cpu size={13} aria-hidden="true" />
            Client compute
          </span>
          <span class={cn('pipeline-chip', props.crossOriginIsolated ? 'is-ok' : 'is-warn')}>
            <ShieldCheck size={13} aria-hidden="true" />
            {props.crossOriginIsolated ? 'COOP/COEP OK' : 'COOP/COEP needed'}
          </span>
          <Show when={props.previewLabel !== null}>
            <span class="pipeline-chip">
              <Activity size={13} aria-hidden="true" />
              Preview {props.previewLabel}
            </span>
          </Show>
          <Show when={props.encodeFps !== null}>
            <span class="pipeline-chip">
              <Gauge size={13} aria-hidden="true" />
              Encode {Math.round(props.encodeFps!)} fps
            </span>
          </Show>
          <button
            type="button"
            class="pipeline-chip pipeline-chip-button"
            onClick={() => props.onOpenCapabilities?.()}
            title="View browser capabilities and recovery steps"
          >
            <Info size={13} aria-hidden="true" />
            Capabilities
          </button>
        </div>
        <span class="file-name" title={props.metadata?.fileName ?? 'No source loaded'}>
          <Show when={props.metadata} fallback="No source">
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
            disabled={props.transportDisabled || !props.playing()}
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
