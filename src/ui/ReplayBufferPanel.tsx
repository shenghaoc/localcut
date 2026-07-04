import { createSignal, Show } from 'solid-js';
import { Circle, Save, Video, VideoOff, Clock } from 'lucide-solid';
import { Button } from './components/button';
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
	initiallyExpanded?: boolean;
}

export function ReplayBufferPanel(props: ReplayBufferPanelProps) {
	const [expanded, setExpanded] = createSignal(props.initiallyExpanded ?? false);

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

	const saveSeconds = () => Math.round(props.ringBufferState?.config.saveDurationS ?? 30);

	return (
		<div class="replay-buffer-panel panel">
			<button
				class="collapse-header"
				type="button"
				onClick={() => setExpanded(!expanded())}
				aria-expanded={expanded()}
			>
				<span class="panel-title">Replay Buffer</span>
				<Show when={isCapturing()}>
					<span class="recording-indicator" aria-label="Recording">
						<Circle size={10} fill="var(--destructive)" color="var(--destructive)" />
						<span>Recording</span>
					</span>
				</Show>
			</button>

			<Show when={expanded()}>
				<div class="collapse-body">
					<Show when={!props.isSupported}>
						<div class="capability-warning" role="alert">
							{props.supportedReason ?? 'Replay Buffer is not available in this browser.'}
						</div>
					</Show>

					<Show when={props.isSupported}>
						<div class="capture-controls">
							<Show when={!isCapturing()}>
								<Button variant="default" onClick={() => props.onStartCapture('display')}>
									<Video size={16} /> Start Capture
								</Button>
							</Show>
							<Show when={isCapturing()}>
								<Button variant="destructive" onClick={() => props.onStopCapture()}>
									<VideoOff size={16} /> Stop Capture
								</Button>
							</Show>
						</div>

						<Show when={isCapturing()}>
							<div class="capture-status">
								<div class="elapsed-time" aria-label="Elapsed time">
									<Clock size={14} />
									<span style={{ 'font-variant-numeric': 'tabular-nums' }}>{elapsed()}</span>
								</div>
								<div class="buffer-indicator">
									<div class="buffer-bar-bg">
										<div
											class="buffer-bar-fill"
											style={{
												transform: `scaleX(${(bufferPercent() || 0) / 100})`,
												'will-change': 'transform'
											}}
										/>
									</div>
									<span class="buffer-label">{(bufferPercent() || 0).toFixed(0)}%</span>
								</div>
							</div>

							<div class="save-controls">
								<Button
									variant="secondary"
									onClick={() => props.onSaveLastN()}
									disabled={props.saveInProgress || !bufferPercent()}
									aria-label={`Save last ${saveSeconds()} seconds`}
								>
									<Save size={16} />
									{props.saveInProgress ? 'Saving…' : `Save Last ${saveSeconds()}s`}
								</Button>
							</div>
						</Show>

						<Show when={!props.crossOriginIsolated}>
							<div class="capability-note">Live audio chain requires cross-origin isolation.</div>
						</Show>
					</Show>
				</div>
			</Show>
		</div>
	);
}
