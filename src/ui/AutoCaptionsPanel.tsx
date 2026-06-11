/**
 * "Auto Captions (Experimental)" panel — Phase 29.
 *
 * Thin renderer over `AsrController` state. Everything heavy happens in
 * the lazily spawned ASR worker; this component only shows status,
 * drives actions, and displays progress.
 */
import { createEffect, createSignal, Show, type Component } from 'solid-js';
import { X } from 'lucide-solid';
import { Button } from './components/button';
import { ASR_CHROME_SPEECH_TOOLTIP, ASR_UNAVAILABLE_MESSAGE } from '../engine/asr/asr-probe';
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
	onTranscribeClip: (language?: string) => void;
	onTranscribeRange: (language?: string) => void;
	onCancel: () => void;
	onClose: () => void;
}

function formatEngine(recommended: string, speechRecognition: string): string {
	switch (recommended) {
		case 'webnn-whisper':
			return 'WebNN Whisper';
		case 'chrome-speech':
			return `Browser Speech${speechRecognition === 'supported' ? ' (phrase-level)' : ''}`;
		default:
			return 'Unavailable';
	}
}

function formatDuration(ms: number | null): string {
	if (ms === null) return '\u2014';
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

export const AutoCaptionsPanel: Component<AutoCaptionsPanelProps> = (props) => {
	let panelRef: HTMLElement | undefined;
	const [language, setLanguage] = createSignal<string>('');

	createEffect(() => {
		if (props.open) {
			requestAnimationFrame(() => panelRef?.focus());
		}
	});

	const availability = () => asrActionAvailability(props.state, props.selectedClip);
	const engineLabel = () => formatEngine(
		props.state.recommendedEngine,
		props.state.probe?.speechRecognition ?? 'unknown'
	);
	const showChromeSpeechTooltip = () =>
		props.state.recommendedEngine === 'chrome-speech';

	return (
		<Show when={props.open}>
			<div class="capability-backdrop" onClick={() => props.onClose()} aria-hidden="true" />
			<aside
				ref={panelRef}
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
					<section class="diagnostics-section">
						<h2>Engine</h2>
						<dl class="diagnostics-grid">
							<div>
								<dt>Detected engine</dt>
								<dd>
									{engineLabel()}
									<Show when={showChromeSpeechTooltip()}>
										<span
											class="capability-panel-note"
											style={{ display: 'block', 'margin-top': '0.3rem' }}
										>
											{ASR_CHROME_SPEECH_TOOLTIP}
										</span>
									</Show>
								</dd>
							</div>
							<div>
								<dt>Model status</dt>
								<dd>{props.state.modelStatus}</dd>
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
								<p class="capability-panel-note">
									Select a clip on the timeline to transcribe.
								</p>
							}
						>
							{(clip) => (
								<p class="capability-panel-note">
									{clip().fileName} — {clip().durationS.toFixed(1)} s
								</p>
							)}
						</Show>
						<Show when={props.state.job}>
							{(job) => (
								<p class="capability-panel-note" aria-live="polite">
									{job().phase === 'extracting'
										? 'Extracting audio\u2026'
										: job().phase === 'creating-track'
											? 'Creating caption track\u2026'
											: `Transcribing\u2026 ${Math.round(job().fraction * 100)}%`}
									<progress
										value={job().fraction}
										max={1}
										aria-label="Transcription progress"
										style={{
											width: '100%',
											display: 'block',
											'margin-top': '0.4rem'
										}}
									/>
									<span style={{ 'font-size': '0.85em' }}>
										{job().processedSeconds.toFixed(0)} / {job().totalSeconds.toFixed(0)} s
									</span>
								</p>
							)}
						</Show>
					</section>

					<section class="diagnostics-section">
						<h2>Actions</h2>
						<div style={{ display: 'flex', gap: '0.5rem', 'flex-wrap': 'wrap' }}>
							<Show when={props.state.recommendedEngine === 'webnn-whisper'}>
								<Button
									variant="secondary"
									size="sm"
									disabled={!availability().loadModel.enabled}
									title={
										availability().loadModel.reason ??
										'Load the Whisper model (WebNN) for word-level transcription'
									}
									onClick={props.onLoadModel}
								>
									Load model
								</Button>
							</Show>
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
									availability().transcribeRange.reason ??
									'Transcribe the visible timeline range (Chrome Speech only)'
								}
								onClick={() => props.onTranscribeRange(language() || undefined)}
							>
								Transcribe timeline range
							</Button>
							<Button
								variant="secondary"
								size="sm"
								disabled={!availability().cancel.enabled}
								title={availability().cancel.reason ?? 'Cancel the running transcription'}
								onClick={props.onCancel}
							>
								Cancel
							</Button>
						</div>
					</section>
				</Show>

				<footer class="capability-panel-note">
					Models: Whisper (MIT, OpenAI) via WebNN / Chrome on-device speech recognition.
					Weights load from this app's own origin only after you click "Load model".
				</footer>
			</aside>
		</Show>
	);
};

export default AutoCaptionsPanel;
