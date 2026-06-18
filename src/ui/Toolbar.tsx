import { createSignal, For, Show, type JSX } from 'solid-js';
import { Popover } from '@ark-ui/solid/popover';
import {
	Activity,
	AudioWaveform,
	Command,
	Cpu,
	Crosshair,
	Crop,
	FolderOpen,
	Globe,
	Gauge,
	Keyboard,
	Languages,
	CircleQuestionMark,
	Info,
	Pause,
	Play,
	Radio,
	Redo2,
	Search,
	ShieldCheck,
	SkipBack,
	SkipForward,
	Undo2,
	VolumeX
} from 'lucide-solid';
import { cn } from '../lib/utils';
import { Button } from './components/button';
import type { CapabilityTier } from './capabilities';
import type { MediaMetadata } from '../protocol';
import { MeterStrip } from './MeterStrip';

interface ToolbarProps {
	metadata: MediaMetadata | null;
	playing: () => boolean;
	currentTime: () => number;
	duration: () => number;
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
	onOpenAutoCaptions?: () => void;
	onOpenSmartReframe?: () => void;
	onOpenSilenceReview?: () => void;
	onImportKeystrokeOverlay?: () => void;
	keystrokeOverlayAvailable?: boolean;
	onOpenLanguageTools?: () => void;
	onOpenPublish?: () => void;
	calloutTool?: JSX.Element;
	/** True while a publish session is connecting/live/reconnecting. */
	publishLive?: boolean;
	masterGain: number;
	meterSab: SharedArrayBuffer | null;
	onMasterGain: (gain: number) => void;
	exportControl?: JSX.Element;
}

interface CommandAction {
	label: string;
	detail: string;
	disabled?: boolean;
	onSelect: () => void | Promise<void>;
}

function formatToolbarTimecode(seconds: number, fps: number | null): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return '00:00:00:00';
	const rate = fps && Number.isFinite(fps) && fps > 0 ? Math.round(fps) : 30;
	const totalFrames = Math.max(0, Math.round(seconds * rate));
	const frames = totalFrames % rate;
	const totalSeconds = Math.floor(totalFrames / rate);
	const secs = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const mins = totalMinutes % 60;
	const hours = Math.floor(totalMinutes / 60);
	return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs
		.toString()
		.padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
}

function formatToolbarDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return '00:00:00';
	const rounded = Math.round(seconds);
	const secs = rounded % 60;
	const totalMinutes = Math.floor(rounded / 60);
	const mins = totalMinutes % 60;
	const hours = Math.floor(totalMinutes / 60);
	return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs
		.toString()
		.padStart(2, '0')}`;
}

export function Toolbar(props: ToolbarProps) {
	const hasVideo = () => props.metadata?.video != null;
	const transportDisabled = () => props.transportDisabled || !hasVideo();
	const [commandOpen, setCommandOpen] = createSignal(false);
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
	const openCommandPalette = () => {
		setCommandOpen(true);
	};
	const sourceFormatLabel = () => {
		const video = props.metadata?.video;
		if (!video) return 'No source';
		const fps = video.frameRate ? `${Math.round(video.frameRate)} FPS` : 'FPS ?';
		return `${video.width}×${video.height} · ${fps}`;
	};
	const commandActions = (): CommandAction[] => [
		{
			label: 'Import media',
			detail: props.importHint ?? 'Add clips, images, or audio',
			disabled: props.importBlocked,
			onSelect: openImport
		},
		{
			label: props.playing() ? 'Pause transport' : 'Play transport',
			detail: 'Preview playback',
			disabled: transportDisabled(),
			onSelect: props.playing() ? props.onPause : props.onPlay
		},
		{
			label: 'Go live',
			detail: 'Open WHIP publish controls',
			onSelect: () => props.onOpenPublish?.()
		},
		{
			label: 'Auto captions',
			detail: 'On-device speech recognition',
			onSelect: () => props.onOpenAutoCaptions?.()
		},
		{
			label: 'Smart reframe',
			detail: 'Generate crop-path keyframes',
			onSelect: () => props.onOpenSmartReframe?.()
		},
		{
			label: 'Capabilities',
			detail: 'Inspect browser pipeline support',
			onSelect: () => props.onOpenCapabilities?.()
		},
		{
			label: 'User guide',
			detail: 'Open in-app documentation',
			onSelect: () => props.onOpenHelp?.()
		}
	];
	const runCommand = (action: CommandAction) => {
		if (action.disabled) return;
		void action.onSelect();
		setCommandOpen(false);
	};

	return (
		<header class="toolbar">
			<div class="toolbar-menu">
				<div class="app-brand">
					<span class="app-glyph" aria-hidden="true">
						<Crosshair size={20} strokeWidth={1.6} />
					</span>
					<div class="app-brand-copy">
						<h1 class="app-title">Browser Editor</h1>
						<span class="app-kicker">Client NLE</span>
					</div>
				</div>
				<nav class="toolbar-menu-nav" aria-label="Application menu">
					<button
						type="button"
						class="toolbar-menu-item"
						onClick={openCommandPalette}
						aria-haspopup="dialog"
						title="Open project actions"
					>
						Project
					</button>
					<button
						type="button"
						class="toolbar-menu-item"
						onClick={openCommandPalette}
						aria-haspopup="dialog"
						title="Open edit actions"
					>
						Edit
					</button>
					<button
						type="button"
						class="toolbar-menu-item"
						onClick={openCommandPalette}
						aria-haspopup="dialog"
						title="Open clip actions"
					>
						Clip
					</button>
					<button
						type="button"
						class="toolbar-menu-item"
						onClick={openCommandPalette}
						aria-haspopup="dialog"
						title="Open timeline actions"
					>
						Timeline
					</button>
					<button
						type="button"
						class="toolbar-menu-item"
						onClick={openCommandPalette}
						aria-haspopup="dialog"
						title="Open view actions"
					>
						View
					</button>
					<button
						type="button"
						class="toolbar-menu-item"
						onClick={openCommandPalette}
						aria-haspopup="dialog"
						title="Open help actions"
					>
						Help
					</button>
				</nav>
				<Popover.Root
					open={commandOpen()}
					onOpenChange={(details) => setCommandOpen(details.open)}
					positioning={{ placement: 'bottom-end', gutter: 8 }}
				>
					<Popover.Trigger class="command-search" aria-label="Search actions">
						<Search size={13} aria-hidden="true" />
						<span>Search actions, panels, clips…</span>
						<kbd>⌘</kbd>
						<kbd>K</kbd>
					</Popover.Trigger>
					<Popover.Positioner>
						<Popover.Content class="command-popover">
							<header class="command-popover-header">
								<Command size={14} aria-hidden="true" />
								<span>Command palette</span>
							</header>
							<ul class="command-list">
								<For each={commandActions()}>
									{(action) => (
										<li>
											<button
												type="button"
												class="command-action"
												disabled={action.disabled}
												onClick={() => runCommand(action)}
											>
												<span>{action.label}</span>
												<small>{action.detail}</small>
											</button>
										</li>
									)}
								</For>
							</ul>
						</Popover.Content>
					</Popover.Positioner>
				</Popover.Root>
			</div>
			<div class="toolbar-main">
				<div class="toolbar-left">
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
					<span class="source-format">{sourceFormatLabel()}</span>
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
					<div class="toolbar-timecode" aria-label="Playback timecode">
						<span>
							{formatToolbarTimecode(props.currentTime(), props.metadata?.video?.frameRate ?? null)}
						</span>
						<small>/</small>
						<span>{formatToolbarDuration(props.duration())}</span>
					</div>
					<div class="timeline-toggles" role="status" aria-label="Timeline edit modes">
						<span class="timeline-toggle-status is-on" title="Snapping is enabled">
							Snap
						</span>
						<span class="timeline-toggle-status" title="Ripple editing is inactive">
							Ripple
						</span>
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
					<Gauge size={11} aria-hidden="true" />
					{props.pipelineLabel}
				</span>
				<span class="pipeline-chip">
					<Cpu size={11} aria-hidden="true" />
					Client
				</span>
				<span class={cn('pipeline-chip', props.crossOriginIsolated ? 'is-ok' : 'is-warn')}>
					<ShieldCheck size={11} aria-hidden="true" />
					{props.crossOriginIsolated ? 'COOP/COEP' : 'NO ISOLATE'}
				</span>
				<Show when={props.previewLabel !== null}>
					<span class="pipeline-chip">
						<Activity size={11} aria-hidden="true" />
						PV {props.previewLabel}
					</span>
				</Show>
				<Show when={props.encodeFps !== null}>
					<span class="pipeline-chip">
						<Gauge size={11} aria-hidden="true" />
						{Math.round(props.encodeFps ?? 0)} fps
					</span>
				</Show>
				<span class="pipeline-tools-divider" aria-hidden="true" />
				<button
					type="button"
					class={cn('pipeline-chip pipeline-chip-button is-tool', props.publishLive && 'is-live')}
					onClick={() => props.onOpenPublish?.()}
					title="Stream the program output to a WHIP endpoint"
				>
					<Radio size={11} aria-hidden="true" />
					{props.publishLive ? 'Live' : 'Go Live'}
				</button>
				<button
					type="button"
					class="pipeline-chip pipeline-chip-button is-tool"
					onClick={() => props.onOpenAudioCleanup?.()}
					title="Local Audio Cleanup (Experimental) — on-device noise suppression"
				>
					<AudioWaveform size={11} aria-hidden="true" />
					Cleanup
				</button>
				<button
					type="button"
					class="pipeline-chip pipeline-chip-button is-tool"
					onClick={() => props.onOpenAutoCaptions?.()}
					title="Auto Captions (Experimental) — on-device speech recognition"
				>
					<Languages size={11} aria-hidden="true" />
					Captions
				</button>
				<Show when={props.onOpenLanguageTools}>
					<button
						type="button"
						class="pipeline-chip pipeline-chip-button is-tool"
						onClick={() => props.onOpenLanguageTools?.()}
						title="Language Tools — translate captions and draft copy on-device"
					>
						<Globe size={11} aria-hidden="true" />
						Translate
					</button>
				</Show>
				<button
					type="button"
					class="pipeline-chip pipeline-chip-button is-tool"
					onClick={() => props.onOpenSmartReframe?.()}
					title="Smart Reframe (Experimental) — auto crop-path between aspect ratios"
				>
					<Crop size={11} aria-hidden="true" />
					Reframe
				</button>
				<button
					type="button"
					class="pipeline-chip pipeline-chip-button is-tool"
					onClick={() => props.onOpenSilenceReview?.()}
					title="Silence Review — propose ripple-delete cuts at detected dead air"
				>
					<VolumeX size={11} aria-hidden="true" />
					Silence
				</button>
				{props.calloutTool}
				<Show when={props.keystrokeOverlayAvailable}>
					<button
						type="button"
						class="pipeline-chip pipeline-chip-button is-tool"
						onClick={() => props.onImportKeystrokeOverlay?.()}
						title="Import recorded shortcuts from the active capture session as a keystroke overlay track"
					>
						<Keyboard size={11} aria-hidden="true" />
						Keys
					</button>
				</Show>
				<button
					type="button"
					class="pipeline-chip pipeline-chip-button is-tool"
					onClick={() => props.onOpenCapabilities?.()}
					title="View browser capabilities and recovery steps"
				>
					<Info size={11} aria-hidden="true" />
					Capabilities
				</button>
				<button
					type="button"
					class="pipeline-chip pipeline-chip-button is-tool"
					onClick={() => props.onOpenHelp?.()}
					title="Open help and user guide"
				>
					<CircleQuestionMark size={11} aria-hidden="true" />
					Help
				</button>
			</div>
		</header>
	);
}
