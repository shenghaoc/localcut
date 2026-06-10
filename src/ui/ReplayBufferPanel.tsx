import { createSignal, Show } from 'solid-js';
import { Circle, Save, Video, VideoOff, Clock } from 'lucide-solid';
import type { CaptureSessionState, RingBufferState } from '../protocol';

export interface ReplayBufferPanelProps {
	captureState: CaptureSessionState | null;
	ringBufferState: RingBufferState | null;
	onStartCapture: (source: 'display') => void;
	onStopCapture: () => void;
	onSaveLastN: (nSeconds?: number) => void;
	saveInProgress: boolean;
	isSupported: boolean;
	supportedReason: string | null;
	crossOriginIsolated: boolean;
}

export function ReplayBufferPanel(props: ReplayBufferPanelProps) {
	const [expanded, setExpanded] = createSignal(false);

	const isCapturing = () => props.captureState?.active ?? false;
	const elapsed = () => {
		const s = props.captureState?.elapsedS ?? 0;
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		const sec = Math.floor(s % 60);
		return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
	};

	const bufferPercent = () => {
		const state = props.ringBufferState;
		if (!state) return 0;
		return Math.min(100, (state.stats.totalDurationS / state.config.maxDurationS) * 100);
	};

	return (
		<div class="replay-buffer-panel">
			<div class="panel-header" onClick={() => setExpanded(!expanded())} role="button" aria-expanded={expanded()} tabIndex={0}>
				<span class="panel-title">Replay Buffer</span>
				<Show when={isCapturing()}>
					<span class="recording-indicator" aria-label="Recording">
						<Circle size={10} fill="var(--color-error)" color="var(--color-error)" />
						<span>Recording</span>
					</span>
				</Show>
			</div>

			<Show when={expanded()}>
				<div class="panel-body">
					<Show when={!props.isSupported}>
						<div class="capability-warning" role="alert">
							{props.supportedReason ?? 'Replay Buffer is not available in this browser.'}
						</div>
					</Show>

					<Show when={props.isSupported}>
						<div class="capture-controls">
							<Show when={!isCapturing()}>
								<button
									class="btn btn-primary"
									onClick={() => props.onStartCapture('display')}
									aria-label="Start Capture"
								>
									<Video size={16} /> Start Capture
								</button>
							</Show>
							<Show when={isCapturing()}>
								<button
									class="btn btn-danger"
									onClick={() => props.onStopCapture()}
									aria-label="Stop Capture"
								>
									<VideoOff size={16} /> Stop Capture
								</button>
							</Show>
						</div>

						<Show when={isCapturing()}>
							<div class="capture-status">
								<div class="elapsed-time" aria-label="Elapsed time">
									<Clock size={14} />
									<span style="font-variant-numeric: tabular-nums">{elapsed()}</span>
								</div>
								<div class="buffer-indicator">
									<div class="buffer-bar-bg">
										<div class="buffer-bar-fill" style={`width: ${bufferPercent()}%`} />
									</div>
									<span class="buffer-label">{bufferPercent().toFixed(0)}%</span>
								</div>
							</div>

							<div class="save-controls">
								<button
									class="btn btn-secondary"
									onClick={() => props.onSaveLastN()}
									disabled={props.saveInProgress || bufferPercent() === 0}
									aria-label="Save Last 30 Seconds"
								>
									<Save size={16} />
									{props.saveInProgress ? 'Saving...' : 'Save Last 30s'}
								</button>
							</div>
						</Show>

						<Show when={!props.crossOriginIsolated}>
							<div class="capability-note">
								Live audio chain requires cross-origin isolation.
							</div>
						</Show>
					</Show>
				</div>
			</Show>
		</div>
	);
}
