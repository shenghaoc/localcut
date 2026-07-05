/**
 * "Auto Captions (Experimental)" panel — Phase 29 (on-device Whisper on ONNX
 * Runtime Web).
 *
 * Thin renderer over `AsrController` state. Everything heavy happens in the
 * lazily spawned ASR worker; this component only shows status, drives actions,
 * and displays model-download and transcription progress.
 */
import { createEffect, createSignal, For, Show, type Component } from 'solid-js';
import { X } from 'lucide-solid';
import { Button } from './components/button';
import { ASR_ACCURACY_NOTE, ASR_UNAVAILABLE_MESSAGE } from '../engine/asr/asr-probe';
import {
	ASR_PRIVACY_STATEMENT,
	asrActionAvailability,
	type AsrClipTarget,
	type AsrControllerState
} from './asr-controller';

export interface AutoCaptionsPanelProps {
	open: boolean;
	state: AsrControllerState;
	selectedClip: AsrClipTarget | null;
	onLoadModel: () => void;
	onSelectModel: (id: string) => void;
	onTranscribeClip: (language?: string) => void;
	onTranscribeRange: (language?: string) => void;
	onCancel: () => void;
	onClose: () => void;
}

type ActiveAsrJob = NonNullable<AsrControllerState['job']>;

function formatBytes(bytes: number | null): string {
	if (bytes === null) return '—';
	if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
	if (bytes >= 1000) return `${(bytes / 1000).toFixed(0)} KB`;
	return `${bytes} B`;
}

function formatDuration(ms: number | null): string {
	if (ms === null) return '—';
	if (ms >= 60000) return `${(ms / 60000).toFixed(1)} min`;
	return `${(ms / 1000).toFixed(2)} s`;
}

function formatLanguage(lang: string | null): string {
	if (!lang) return 'Auto-detect';
	switch (lang) {
		case 'zh':
			return 'Chinese (zh)';
		case 'en':
			return 'English (en)';
		default:
			return lang;
	}
}

function clampFraction(value: number | null | undefined): number {
	return Math.min(Math.max(value ?? 0, 0), 1);
}

function formatProgressPercent(value: number | null | undefined): string {
	return `${Math.round(clampFraction(value) * 100)}%`;
}

function asrJobLabel(job: ActiveAsrJob): string {
	switch (job.phase) {
		case 'extracting':
			return 'Preparing audio';
		case 'creating-track':
			return 'Creating caption track';
		case 'transcribing':
			return 'Transcribing audio';
	}
}

export const AutoCaptionsPanel: Component<AutoCaptionsPanelProps> = (props) => {
	let panelRef: HTMLElement | undefined;
	const [language, setLanguage] = createSignal<string>('en');

	createEffect(() => {
		if (props.open) {
			requestAnimationFrame(() => panelRef?.focus());
		}
	});

	const availability = () => asrActionAvailability(props.state, props.selectedClip);
	const engineLabel = () => {
		if (props.state.recommendedEngine !== 'ort-whisper') return 'Unavailable';
		const accel = props.state.accelerator ?? 'wasm';
		return `ONNX Whisper (${accel.toUpperCase()})`;
	};
	const isLoading = () => props.state.modelStatus === 'loading';
	const isCompilingModel = () =>
		isLoading() &&
		props.state.modelSizeBytes !== null &&
		props.state.downloadedBytes !== null &&
		props.state.downloadedBytes >= props.state.modelSizeBytes;
	const modelProgressLabel = () =>
		isCompilingModel()
			? `Compiling ${props.state.model.name}`
			: `Downloading ${props.state.model.name}`;
	const modelProgressMeta = () =>
		isCompilingModel()
			? `Verified ${formatBytes(props.state.modelSizeBytes)} · compiling ${engineLabel()}`
			: `${formatBytes(props.state.downloadedBytes)} / ${formatBytes(props.state.modelSizeBytes)}`;

	return (
		<Show when={props.open}>
			<div class="capability-backdrop" onClick={() => props.onClose()} aria-hidden="true" />
			<aside
				ref={(el) => (panelRef = el)}
				class="diagnostics-panel panel"
				role="dialog"
				aria-modal="true"
				aria-labelledby="auto-captions-panel-title"
				tabIndex={-1}
				onKeyDown={(e) => {
					if (e.key === 'Escape') props.onClose();
				}}
			>
				<header class="capability-panel-header">
					<div>
						<p class="panel-title" id="auto-captions-panel-title">
							Auto Captions (Experimental)
						</p>
						<p class="capability-panel-tier">{ASR_PRIVACY_STATEMENT}</p>
					</div>
					<Button
						size="icon"
						variant="ghost"
						onClick={props.onClose}
						aria-label="Close auto captions panel"
					>
						<X size={16} aria-hidden="true" />
					</Button>
				</header>

				<Show
					when={props.state.available}
					fallback={<p class="capability-panel-note">{ASR_UNAVAILABLE_MESSAGE}</p>}
				>
					<Show when={isLoading() || props.state.job}>
						<section class="diagnostics-section">
							<h2>Progress</h2>
							<Show
								when={isLoading()}
								fallback={
									<Show when={props.state.job}>
										{(job) => (
											<div
												class="asr-progress-block"
												role="status"
												aria-live="polite"
												aria-atomic="true"
											>
												<div class="asr-progress-row">
													<span class="asr-progress-label">{asrJobLabel(job())}</span>
													<span class="asr-progress-value tabular-nums">
														{formatProgressPercent(job().fraction)}
													</span>
												</div>
												<progress
													class="asr-progress-bar"
													value={clampFraction(job().fraction)}
													max={1}
													aria-label="Auto captions progress"
												/>
												<div class="asr-progress-meta">
													<span>{job().clip?.fileName ?? 'Timeline range'}</span>
													<span class="tabular-nums">
														{job().processedSeconds.toFixed(0)} / {job().totalSeconds.toFixed(0)} s
													</span>
												</div>
											</div>
										)}
									</Show>
								}
							>
								<div class="asr-progress-block" role="status" aria-live="polite" aria-atomic="true">
									<div class="asr-progress-row">
										<span class="asr-progress-label">{modelProgressLabel()}</span>
										<span class="asr-progress-value tabular-nums">
											{formatProgressPercent(props.state.downloadFraction)}
										</span>
									</div>
									<progress
										class="asr-progress-bar"
										value={clampFraction(props.state.downloadFraction)}
										max={1}
										aria-label="Model download progress"
									/>
									<div class="asr-progress-meta">
										<span class="tabular-nums">{modelProgressMeta()}</span>
										<span>{engineLabel()}</span>
									</div>
								</div>
							</Show>
						</section>
					</Show>

					<section class="diagnostics-section">
						<h2>Model</h2>
						<Show when={props.state.models.length > 1}>
							<label style={{ display: 'block', 'margin-bottom': '0.4rem' }}>
								<span class="capability-panel-note">Choose a model</span>
								<select
									value={props.state.model.id}
									disabled={props.state.modelStatus === 'loading' || props.state.job !== null}
									onChange={(e) => props.onSelectModel(e.currentTarget.value)}
									style={{ display: 'block', 'margin-top': '0.2rem', width: '100%' }}
								>
									<For each={props.state.models}>
										{(model) => <option value={model.id}>{model.name}</option>}
									</For>
								</select>
							</label>
						</Show>
						<p style={{ margin: '0', 'font-weight': '600' }}>{props.state.model.name}</p>
						<p class="capability-panel-note">{props.state.model.description}</p>
						<p class="capability-panel-note">
							{props.state.model.provider} · {props.state.model.license} ·{' '}
							{formatBytes(props.state.model.sizeBytes)}
							{' · '}
							<a href={props.state.model.infoUrl} target="_blank" rel="noopener noreferrer">
								Learn more ↗
							</a>
						</p>
						<Show when={props.state.modelStatus === 'loaded' && props.state.cached}>
							<p class="capability-panel-note">
								Loaded from this device's cache — no download needed.
							</p>
						</Show>
					</section>

					<section class="diagnostics-section">
						<h2>Engine</h2>
						<dl class="diagnostics-grid">
							<div>
								<dt>Detected engine</dt>
								<dd>
									{engineLabel()}
									<span
										class="capability-panel-note"
										style={{ display: 'block', 'margin-top': '0.3rem' }}
									>
										{ASR_ACCURACY_NOTE}
									</span>
								</dd>
							</div>
							<div>
								<dt>Model status</dt>
								<dd>{props.state.modelStatus}</dd>
							</div>
							<div>
								<dt>Model size</dt>
								<dd>{formatBytes(props.state.modelSizeBytes)}</dd>
							</div>
							<div>
								<dt>Last transcription</dt>
								<dd>{formatDuration(props.state.lastDurationMs)}</dd>
							</div>
						</dl>
						<Show when={props.state.error}>
							<p class="capability-panel-note" role="alert">
								{props.state.error}
							</p>
						</Show>
					</section>

					<section class="diagnostics-section">
						<h2>Language</h2>
						<div style={{ display: 'flex', gap: '0.5rem', 'flex-wrap': 'wrap' }}>
							<label style={{ display: 'flex', 'align-items': 'center', gap: '0.25rem' }}>
								<input
									type="radio"
									name="asr-lang"
									value=""
									checked={language() === ''}
									onChange={() => setLanguage('')}
								/>
								Auto-detect
							</label>
							<label style={{ display: 'flex', 'align-items': 'center', gap: '0.25rem' }}>
								<input
									type="radio"
									name="asr-lang"
									value="zh"
									checked={language() === 'zh'}
									onChange={() => setLanguage('zh')}
								/>
								Chinese (zh)
							</label>
							<label style={{ display: 'flex', 'align-items': 'center', gap: '0.25rem' }}>
								<input
									type="radio"
									name="asr-lang"
									value="en"
									checked={language() === 'en'}
									onChange={() => setLanguage('en')}
								/>
								English (en)
							</label>
						</div>
					</section>

					<section class="diagnostics-section">
						<h2>Clip</h2>
						<Show
							when={props.selectedClip}
							fallback={
								<p class="capability-panel-note">Select a clip on the timeline to transcribe.</p>
							}
						>
							{(clip) => (
								<p class="capability-panel-note">
									{clip().fileName} — {clip().durationS.toFixed(1)} s
								</p>
							)}
						</Show>
					</section>

					<section class="diagnostics-section">
						<h2>Actions</h2>
						<div style={{ display: 'flex', gap: '0.5rem', 'flex-wrap': 'wrap' }}>
							<Button
								variant="secondary"
								size="sm"
								disabled={!availability().loadModel.enabled}
								title={
									availability().loadModel.reason ??
									'Download and compile the selected Whisper model (cached for offline reuse)'
								}
								onClick={props.onLoadModel}
							>
								Load model
							</Button>
							<Button
								variant="secondary"
								size="sm"
								disabled={!availability().transcribeClip.enabled}
								title={
									availability().transcribeClip.reason ??
									`Transcribe the selected clip${language() ? ' as ' + formatLanguage(language()) : ''}`
								}
								onClick={() => props.onTranscribeClip(language() || undefined)}
							>
								Transcribe selected clip
							</Button>
							<Button
								variant="secondary"
								size="sm"
								disabled={!availability().transcribeRange.enabled}
								title={
									availability().transcribeRange.reason ?? 'Transcribe the visible timeline range'
								}
								onClick={() => props.onTranscribeRange(language() || undefined)}
							>
								Transcribe timeline range
							</Button>
							<Button
								variant="secondary"
								size="sm"
								disabled={!availability().cancel.enabled}
								title={
									availability().cancel.reason ?? 'Cancel the running model load or transcription'
								}
								onClick={props.onCancel}
							>
								Cancel
							</Button>
						</div>
					</section>
				</Show>

				<footer class="capability-panel-note">
					Model: Whisper (MIT, OpenAI) run on-device by ONNX Runtime Web. Assets load from this
					app's own origin only after you click "Load model".
				</footer>
			</aside>
		</Show>
	);
};

export default AutoCaptionsPanel;
