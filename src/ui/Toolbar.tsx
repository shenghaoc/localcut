import { Show, type JSX } from 'solid-js';
import {
	Activity,
	AudioWaveform,
	Cpu,
	FolderOpen,
	Gauge,
	CircleQuestionMark,
	Info,
	Pause,
	Play,
	Redo2,
	ShieldCheck,
	SkipBack,
	SkipForward,
	Undo2
} from 'lucide-solid';
import { cn } from '../lib/utils';
import { Button } from './components/button';
import type { CapabilityTier } from './capabilities';
import type { MediaMetadata } from '../protocol';
import { MeterStrip } from './MeterStrip';

interface ToolbarProps {
	metadata: MediaMetadata | null;
	playing: () => boolean;
	importAccept: string;
	onImportFile: (file: File) => void;
	onPickImport?: () => Promise<boolean>;
	onPlay: () => void;
	onPause: () => void;
	onStep: (direction: 1 | -1) => void;
	canUndo: boolean;
	canRedo: boolean;
	onUndo: () => void;
	onRedo: () => void;
	transportDisabled?: boolean;
	importBlocked?: boolean;
	importHint?: string | null;
	crossOriginIsolated: boolean;
	pipelineMode: CapabilityTier;
	pipelineLabel: string;
	previewLabel: string | null;
	encodeFps: number | null;
	onOpenCapabilities?: () => void;
	onOpenHelp?: () => void;
	onOpenAudioCleanup?: () => void;
	masterGain: number;
	meterSab: SharedArrayBuffer | null;
	onMasterGain: (gain: number) => void;
	exportControl?: JSX.Element;
}

export function Toolbar(props: ToolbarProps) {
	const hasVideo = () => props.metadata?.video != null;
	const transportDisabled = () => props.transportDisabled || !hasVideo();
	let importInput: HTMLInputElement | undefined;
	const handleImportInput = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		for (const file of files) {
			props.onImportFile(file);
		}
	};
	const openImport = async () => {
		if (props.importBlocked) return;
		const handled = (await props.onPickImport?.()) ?? false;
		if (!handled) importInput?.click();
	};

	return (
		<header class="toolbar">
			<div class="toolbar-main">
				<div class="toolbar-left">
					<div class="app-brand">
						<span class="app-glyph" aria-hidden="true" />
						<div class="app-brand-copy">
							<h1 class="app-title">Browser Editor</h1>
							<span class="app-kicker">Browser-native NLE</span>
						</div>
					</div>
					<Button
						variant="default"
						class="import-picker"
						onClick={() => void openImport()}
						disabled={props.importBlocked}
						title={props.importHint ?? undefined}
					>
						<FolderOpen size={14} aria-hidden="true" />
						Import
					</Button>
					<input
						ref={(el) => {
							importInput = el;
						}}
						type="file"
						accept={props.importAccept}
						multiple
						onChange={handleImportInput}
						disabled={props.importBlocked}
						aria-label="Import media"
						title={props.importHint ?? undefined}
						hidden
					/>
				</div>
				<div class="toolbar-center">
					<span class="file-name" title={props.metadata?.fileName ?? 'No source loaded'}>
						<Show when={props.metadata} fallback="No source">
							{(meta) => meta().fileName}
						</Show>
					</span>
				</div>
				<div class="toolbar-right">
					<div class="edit-controls" role="group" aria-label="Edit history">
						<Button
							size="icon"
							onClick={() => props.onUndo()}
							disabled={!props.canUndo}
							aria-label="Undo"
							title="Undo"
						>
							<Undo2 size={14} aria-hidden="true" />
						</Button>
						<Button
							size="icon"
							onClick={() => props.onRedo()}
							disabled={!props.canRedo}
							aria-label="Redo"
							title="Redo"
						>
							<Redo2 size={14} aria-hidden="true" />
						</Button>
					</div>
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
							aria-label="Play transport"
						>
							<Play size={14} aria-hidden="true" />
							Play
						</Button>
						<Button
							onClick={() => props.onPause()}
							disabled={transportDisabled() || !props.playing()}
							aria-label="Pause transport"
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
					<div class="master-mix" role="group" aria-label="Master mix">
						<MeterStrip meterSab={props.meterSab} />
						<label class="master-fader">
							<span class="master-fader-label">Master</span>
							<input
								type="range"
								class="master-fader-input"
								min={0}
								max={2}
								step={0.01}
								value={props.masterGain}
								onInput={(e) =>
									props.onMasterGain(Number((e.currentTarget as HTMLInputElement).value))
								}
								aria-valuetext={
									Number.isFinite(props.masterGain) ? props.masterGain.toFixed(2) : '0.00'
								}
							/>
							<span class="master-fader-value tabular-nums">
								{Number.isFinite(props.masterGain) ? props.masterGain.toFixed(2) : '0.00'}
							</span>
						</label>
					</div>
					{props.exportControl}
				</div>
			</div>
			<div class="pipeline-strip" aria-label="Pipeline status">
				<span
					class={cn(
						'pipeline-chip',
						props.pipelineMode === 'accelerated' && 'is-ok',
						props.pipelineMode === 'limited' && 'is-warn',
						props.pipelineMode === 'starting' && 'is-waiting',
						props.pipelineMode === 'blocked' && 'is-warn'
					)}
				>
					<Gauge size={13} aria-hidden="true" />
					{props.pipelineLabel}
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
						Encode {Math.round(props.encodeFps ?? 0)} fps
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
				<button
					type="button"
					class="pipeline-chip pipeline-chip-button"
					onClick={() => props.onOpenAudioCleanup?.()}
					title="Local Audio Cleanup (Experimental) — on-device noise suppression"
				>
					<AudioWaveform size={13} aria-hidden="true" />
					Audio Cleanup
				</button>
				<button
					type="button"
					class="pipeline-chip pipeline-chip-button"
					onClick={() => props.onOpenHelp?.()}
					title="Open help and user guide"
				>
					<CircleQuestionMark size={13} aria-hidden="true" />
					Help
				</button>
			</div>
		</header>
	);
}
