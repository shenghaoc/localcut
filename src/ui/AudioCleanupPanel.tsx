/**
 * "Local Audio Cleanup (Experimental)" panel — Phase 28.
 *
 * Thin renderer over `CleanupController` state. Everything heavy happens in
 * the lazily spawned Audio Cleanup worker; this component only shows status,
 * drives the four actions, and plays the bounded A/B preview buffers through
 * a short-lived local AudioContext (UI-level playback of a small buffer, not
 * a media pipeline).
 */

import { createEffect, createSignal, onCleanup, Show, type Component } from 'solid-js';
import { X } from 'lucide-solid';
import type { CleanupBackendKind } from '../protocol';
import { Button } from './components/button';
import {
	CLEANUP_PREVIEW_SECONDS,
	CLEANUP_PRIVACY_STATEMENT,
	CLEANUP_UNAVAILABLE_MESSAGE,
	cleanupActionAvailability,
	type CleanupClipTarget,
	type CleanupControllerState
} from './cleanup-controller';

/** Display name for each DTLN inference backend. */
const BACKEND_LABEL: Record<CleanupBackendKind, string> = {
	litert: 'LiteRT DTLN',
	ort: 'ONNX Runtime DTLN'
};

export interface AppliedCleanupInfo {
	trackId: string;
	clipId: string;
	modelId: string;
	modelVersion: string;
}

export interface AudioCleanupPanelProps {
	open: boolean;
	state: CleanupControllerState;
	selectedClip: CleanupClipTarget | null;
	appliedCleanup: AppliedCleanupInfo | null;
	onSelectBackend: (backend: CleanupBackendKind) => void;
	onLoadModel: () => void;
	onPreview: () => void;
	onApply: () => void;
	onCancel: () => void;
	onRemoveCleanup: () => void;
	onClose: () => void;
}

function formatBytes(bytes: number | null): string {
	if (bytes === null) return '—';
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${Math.round(bytes / 1024)} KB`;
}

export const AudioCleanupPanel: Component<AudioCleanupPanelProps> = (props) => {
	// eslint-disable-next-line eslint/no-unassigned-vars — SolidJS ref assigns via JSX
	let panelRef: HTMLElement | undefined;
	let audioContext: AudioContext | null = null;
	let activeSource: AudioBufferSourceNode | null = null;
	const [playing, setPlaying] = createSignal<'original' | 'cleaned' | null>(null);

	function stopPlayback() {
		if (activeSource) {
			try {
				activeSource.stop();
			} catch {
				// Already stopped.
			}
			activeSource.disconnect();
			activeSource = null;
		}
		setPlaying(null);
	}

	function playBuffer(which: 'original' | 'cleaned') {
		const preview = props.state.preview;
		if (!preview) return;
		stopPlayback();
		audioContext ??= new AudioContext();
		void audioContext.resume();
		const interleaved = which === 'original' ? preview.original : preview.cleaned;
		const channels = which === 'original' ? Math.max(1, preview.originalChannels) : 1;
		const frames = Math.floor(interleaved.length / channels);
		if (frames === 0) return;
		const buffer = audioContext.createBuffer(channels, frames, preview.sampleRate);
		for (let channel = 0; channel < channels; channel++) {
			const data = buffer.getChannelData(channel);
			for (let frame = 0; frame < frames; frame++) {
				data[frame] = interleaved[frame * channels + channel] ?? 0;
			}
		}
		const source = audioContext.createBufferSource();
		source.buffer = buffer;
		source.connect(audioContext.destination);
		source.onended = () => {
			if (activeSource === source) {
				activeSource = null;
				setPlaying(null);
			}
		};
		source.start();
		activeSource = source;
		setPlaying(which);
	}

	onCleanup(() => {
		stopPlayback();
		audioContext?.close().catch(() => undefined);
		audioContext = null;
	});

	createEffect(() => {
		if (props.open) {
			requestAnimationFrame(() => panelRef?.focus());
		}
	});

	const availability = () => cleanupActionAvailability(props.state, props.selectedClip);
	// Switching engines tears down the worker + reloads, so block it mid-flight.
	const engineBusy = () => props.state.job !== null || props.state.modelStatus === 'loading';

	return (
		<Show when={props.open}>
			<div class="capability-backdrop" onClick={() => props.onClose()} aria-hidden="true" />
			<aside
				ref={panelRef}
				class="diagnostics-panel panel"
				role="dialog"
				aria-modal="true"
				aria-labelledby="audio-cleanup-panel-title"
				tabIndex={-1}
				onKeyDown={(e) => {
					if (e.key === 'Escape') props.onClose();
				}}
			>
				<header class="capability-panel-header">
					<div>
						<p class="panel-title" id="audio-cleanup-panel-title">
							Local Audio Cleanup (Experimental)
						</p>
						<p class="capability-panel-tier">{CLEANUP_PRIVACY_STATEMENT}</p>
					</div>
					<Button
						size="icon"
						variant="ghost"
						onClick={props.onClose}
						aria-label="Close audio cleanup panel"
					>
						<X size={16} aria-hidden="true" />
					</Button>
				</header>

				<Show
					when={props.state.available}
					fallback={<p class="capability-panel-note">{CLEANUP_UNAVAILABLE_MESSAGE}</p>}
				>
					<section class="diagnostics-section">
						<h2>Status</h2>
						<dl class="diagnostics-grid">
							<div>
								<dt>Engine</dt>
								<dd>
									<div
										role="group"
										aria-label="Cleanup engine"
										style={{ display: 'flex', gap: '0.25rem', 'flex-wrap': 'wrap' }}
									>
										<Button
											size="sm"
											variant={props.state.backend === 'litert' ? 'default' : 'secondary'}
											aria-pressed={props.state.backend === 'litert'}
											disabled={engineBusy()}
											title="Original LiteRT / TFLite DTLN runtime"
											onClick={() => props.onSelectBackend('litert')}
										>
											{BACKEND_LABEL.litert}
										</Button>
										<Button
											size="sm"
											variant={props.state.backend === 'ort' ? 'default' : 'secondary'}
											aria-pressed={props.state.backend === 'ort'}
											disabled={engineBusy()}
											title="Experimental ONNX Runtime Web DTLN backend"
											onClick={() => props.onSelectBackend('ort')}
										>
											{BACKEND_LABEL.ort}
										</Button>
									</div>
								</dd>
							</div>
							<div>
								<dt>Model</dt>
								<dd>
									{props.state.modelStatus}
									<Show when={props.state.accelerator}> via {props.state.accelerator}</Show>
								</dd>
							</div>
							<div>
								<dt>Model size</dt>
								<dd>{formatBytes(props.state.modelSizeBytes)}</dd>
							</div>
							<div>
								<dt>Last analysis</dt>
								<dd>
									{props.state.lastAnalysisMs === null
										? '—'
										: `${(props.state.lastAnalysisMs / 1000).toFixed(2)} s`}
								</dd>
							</div>
						</dl>
						<Show when={props.state.error}>
							<p class="capability-panel-note" role="alert">
								{props.state.error}
							</p>
						</Show>
					</section>

					<section class="diagnostics-section">
						<h2>Clip</h2>
						<Show
							when={props.selectedClip}
							fallback={<p class="capability-panel-note">Select an audio clip on the timeline.</p>}
						>
							{(clip) => (
								<p class="capability-panel-note">
									{clip().fileName} — {clip().durationS.toFixed(1)} s
									<Show when={props.appliedCleanup}>
										{(applied) => (
											<>
												{' '}
												· cleanup applied ({applied().modelId} {applied().modelVersion})
											</>
										)}
									</Show>
								</p>
							)}
						</Show>
						<Show when={props.state.job}>
							{(job) => (
								<p class="capability-panel-note" aria-live="polite">
									{job().phase === 'extracting'
										? 'Extracting audio…'
										: job().phase === 'applying'
											? 'Creating cleaned audio asset…'
											: `Cleaning… ${Math.round(job().fraction * 100)}%`}
									<progress
										value={job().fraction}
										max={1}
										aria-label="Cleanup progress"
										style={{ width: '100%', display: 'block', 'margin-top': '0.4rem' }}
									/>
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
								title={availability().loadModel.reason ?? 'Fetch and verify the local model'}
								onClick={props.onLoadModel}
							>
								Load model
							</Button>
							<Button
								variant="secondary"
								size="sm"
								disabled={!availability().preview.enabled}
								title={
									availability().preview.reason ??
									`Clean the first ${CLEANUP_PREVIEW_SECONDS} s for A/B comparison (loads the model first if needed)`
								}
								onClick={props.onPreview}
							>
								Preview cleanup
							</Button>
							<Button
								variant="secondary"
								size="sm"
								disabled={!availability().cancel.enabled}
								title={availability().cancel.reason ?? 'Cancel the running operation'}
								onClick={props.onCancel}
							>
								Cancel
							</Button>
							<Button
								variant="default"
								size="sm"
								disabled={!availability().apply.enabled}
								title={
									availability().apply.reason ??
									'Create a cleaned audio asset and route this clip through it (loads the model first if needed)'
								}
								onClick={props.onApply}
							>
								Apply to export / create cleaned audio asset
							</Button>
							<Show when={props.appliedCleanup}>
								<Button
									variant="outline"
									size="sm"
									title="Return this clip to its original audio (undoable)"
									onClick={props.onRemoveCleanup}
								>
									Remove cleanup
								</Button>
							</Show>
						</div>
					</section>

					<Show when={props.state.preview}>
						{(preview) => (
							<section class="diagnostics-section">
								<h2>A/B preview ({preview().durationS.toFixed(1)} s)</h2>
								<div style={{ display: 'flex', gap: '0.5rem', 'flex-wrap': 'wrap' }}>
									<Button
										variant={playing() === 'original' ? 'default' : 'secondary'}
										size="sm"
										onClick={() => playBuffer('original')}
									>
										Play original
									</Button>
									<Button
										variant={playing() === 'cleaned' ? 'default' : 'secondary'}
										size="sm"
										onClick={() => playBuffer('cleaned')}
									>
										Play cleaned
									</Button>
									<Button
										variant="outline"
										size="sm"
										disabled={playing() === null}
										onClick={stopPlayback}
									>
										Stop
									</Button>
								</div>
							</section>
						)}
					</Show>
				</Show>

				<footer class="capability-panel-note">
					Model: DTLN (MIT, Interspeech 2020) via{' '}
					{props.state.backend === 'ort' ? 'ONNX Runtime Web' : 'LiteRT'}. Weights load from this
					app's own origin only after you click "Load model".
				</footer>
			</aside>
		</Show>
	);
};

export default AudioCleanupPanel;
