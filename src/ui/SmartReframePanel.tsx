/**
 * Smart Reframe panel (Phase 33). Stateless view over the {@link ReframeController}
 * state: target-aspect selector, analysis trigger, progress, review actions, and
 * adjust mode. All worker/file plumbing lives in App + the controller; this panel
 * only emits intent via callbacks (R7.3). Uses the shared diagnostics-dialog
 * shell for styling, focus management, and Escape-to-close.
 */

import { createEffect, createSignal, For, Show, type Component } from 'solid-js';
import { X } from 'lucide-solid';
import { Button } from './components/button';
import type { ReframeTargetAspect } from '../protocol';
import type { ReframeControllerState } from './reframe-controller';

export interface ReframeAnalyseSettings {
	targetAspect: ReframeTargetAspect;
	velocityBound: number;
	accelerationBound: number;
	analysisFps: number;
}

export interface SmartReframePanelProps {
	open: boolean;
	/** Observable controller state (status, progress, stats, result, error). */
	state: ReframeControllerState;
	/** Currently selected video clip, or null if none is selected. */
	selectedClip: { id: string; trackId: string; hasKeyframes: boolean } | null;
	/** Capability probe results. */
	faceDetectionSupported: boolean;
	workerAvailable: boolean;
	onClose: () => void;
	/** Download + initialise the face model — ORT/ONNX if configured, MediaPipe
	 *  BlazeFace otherwise (explicit user action). */
	onLoadFaceModel: () => void;
	onAnalyse: (settings: ReframeAnalyseSettings) => void;
	onCancel: () => void;
	onApply: () => void;
	onDiscard: () => void;
}

const ASPECT_OPTIONS: ReframeTargetAspect[] = ['9:16', '1:1', '4:5', '16:9', '4:3'];

function formatPercent(value: number): string {
	return `${Math.round(value * 100)}%`;
}

export const SmartReframePanel: Component<SmartReframePanelProps> = (props) => {
	let panelRef: HTMLElement | undefined;
	const [targetAspect, setTargetAspect] = createSignal<ReframeTargetAspect>('9:16');
	const [velocityBound, setVelocityBound] = createSignal(0.3);
	const [accelerationBound, setAccelerationBound] = createSignal(0.5);
	const [analysisFps, setAnalysisFps] = createSignal(2);
	const [showAdjust, setShowAdjust] = createSignal(false);
	const [confirmReplace, setConfirmReplace] = createSignal(false);

	const status = () => props.state.status;
	const busy = () => status() === 'resolving' || status() === 'analysing';
	const faceModelStatus = () => props.state.faceModelStatus;
	/** Human-readable name for the engine the worker reported on load — keeps
	 *  the "ready" notice honest once a real ORT model is vendored. */
	const faceEngineLabel = () => {
		switch (props.state.faceModelEngine) {
			case 'ort-onnx':
				return 'ONNX face detector';
			case 'mediapipe-blazeface':
				return 'MediaPipe BlazeFace';
			default:
				return null;
		}
	};

	// ARIA modal dialog pattern: move focus into the panel when it opens.
	createEffect(() => {
		if (props.open) requestAnimationFrame(() => panelRef?.focus());
	});

	function settings(): ReframeAnalyseSettings {
		return {
			targetAspect: targetAspect(),
			velocityBound: velocityBound(),
			accelerationBound: accelerationBound(),
			analysisFps: analysisFps()
		};
	}

	function handleAnalyse() {
		const clip = props.selectedClip;
		if (!clip || !props.workerAvailable || busy()) return;
		// Guard against clobbering hand-authored keyframes without confirmation (R6.8).
		if (clip.hasKeyframes && !confirmReplace()) {
			setConfirmReplace(true);
			return;
		}
		setConfirmReplace(false);
		props.onAnalyse(settings());
	}

	function handleReanalyse() {
		setConfirmReplace(false);
		props.onAnalyse(settings());
	}

	return (
		<Show when={props.open}>
			<div class="capability-backdrop" onClick={() => props.onClose()} aria-hidden="true" />
			<aside
				ref={(el) => (panelRef = el)}
				class="diagnostics-panel panel"
				role="dialog"
				aria-modal="true"
				aria-labelledby="smart-reframe-panel-title"
				tabIndex={-1}
				onKeyDown={(e) => {
					if (e.key === 'Escape') props.onClose();
				}}
			>
				<header class="capability-panel-header">
					<div>
						<p class="panel-title" id="smart-reframe-panel-title">
							Smart Reframe (Experimental)
						</p>
						<p class="capability-panel-tier">
							Generates editable transform keyframes on-device — no frames leave your browser.
						</p>
					</div>
					<Button
						size="icon"
						variant="ghost"
						onClick={() => props.onClose()}
						aria-label="Close Smart Reframe panel"
					>
						<X size={16} aria-hidden="true" />
					</Button>
				</header>

				{/* Capability notices */}
				<Show when={!props.workerAvailable}>
					<p class="capability-panel-note" role="alert">
						Analysis worker unavailable in this browser.
					</p>
				</Show>

				{/* Face model — downloaded on explicit action (Phase 28/29 pattern). */}
				<Show when={props.workerAvailable && props.faceDetectionSupported}>
					<section class="diagnostics-section">
						<h2>Face detection</h2>
						<Show
							when={faceModelStatus() === 'loaded'}
							fallback={
								<>
									<p class="capability-panel-note">
										{faceModelStatus() === 'loading'
											? 'Loading the face model…'
											: faceModelStatus() === 'failed'
												? (props.state.faceModelError ?? 'Face model failed to load.')
												: 'Using visual saliency. Load the optional face detector (ONNX if configured, MediaPipe BlazeFace otherwise) for face-aware reframing.'}
									</p>
									<Button
										size="sm"
										variant="secondary"
										disabled={faceModelStatus() === 'loading'}
										onClick={() => props.onLoadFaceModel()}
									>
										{faceModelStatus() === 'failed' ? 'Retry load' : 'Load face model'}
									</Button>
								</>
							}
						>
							<p class="capability-panel-note">
								Face detection ready{faceEngineLabel() ? ` (${faceEngineLabel()}).` : '.'}
							</p>
						</Show>
					</section>
				</Show>

				<section class="diagnostics-section">
					<h2>Target</h2>
					<div style={{ display: 'flex', 'align-items': 'center', gap: '0.5rem' }}>
						<label for="reframe-aspect">Aspect ratio</label>
						<select
							id="reframe-aspect"
							value={targetAspect()}
							onChange={(e) => setTargetAspect(e.currentTarget.value as ReframeTargetAspect)}
							disabled={busy()}
						>
							<For each={ASPECT_OPTIONS}>
								{(aspect) => <option value={aspect}>{aspect}</option>}
							</For>
						</select>
					</div>
					<Show when={!props.selectedClip}>
						<p class="capability-panel-note">Select a video clip on the timeline to reframe.</p>
					</Show>
				</section>

				<section class="diagnostics-section">
					<h2>Analyse</h2>
					<Show
						when={busy()}
						fallback={
							<Button
								size="sm"
								disabled={!props.selectedClip || !props.workerAvailable}
								onClick={handleAnalyse}
								aria-label="Analyse clip for Smart Reframe"
							>
								Analyse
							</Button>
						}
					>
						<p class="capability-panel-note" aria-live="polite">
							{status() === 'resolving'
								? 'Loading source…'
								: `Analysing… ${formatPercent(props.state.progress)} (${props.state.framesProcessed}/${props.state.totalFrames})`}
							<progress
								value={props.state.progress}
								max={1}
								aria-label="Analysis progress"
								style={{ width: '100%', display: 'block', 'margin-top': '0.4rem' }}
							/>
						</p>
						<Button size="sm" variant="secondary" onClick={() => props.onCancel()}>
							Cancel
						</Button>
					</Show>

					{/* Confirm replace dialog (R6.8) */}
					<Show when={confirmReplace()}>
						<p class="capability-panel-note" role="alert">
							This clip already has transform keyframes. Replace them?
						</p>
						<div style={{ display: 'flex', gap: '0.5rem' }}>
							<Button size="sm" variant="destructive" onClick={handleReanalyse}>
								Replace
							</Button>
							<Button size="sm" variant="secondary" onClick={() => setConfirmReplace(false)}>
								Cancel
							</Button>
						</div>
					</Show>

					<Show when={status() === 'error' && props.state.error}>
						<p class="capability-panel-note" role="alert">
							{props.state.error}
						</p>
					</Show>
				</section>

				{/* Results / review (R7.3) */}
				<Show when={status() === 'review' && props.state.stats}>
					{(_present) => {
						const stats = () => props.state.stats!;
						return (
							<section class="diagnostics-section">
								<h2>Review</h2>
								<dl class="diagnostics-grid">
									<div>
										<dt>Mode</dt>
										<dd>{stats().mode}</dd>
									</div>
									<div>
										<dt>Frames analysed</dt>
										<dd>{stats().framesAnalysed}</dd>
									</div>
									<div>
										<dt>Faces detected</dt>
										<dd>{stats().facesDetected}</dd>
									</div>
									<div>
										<dt>Shot boundaries</dt>
										<dd>{stats().shotBoundaries}</dd>
									</div>
									<div>
										<dt>Keyframes generated</dt>
										<dd>{stats().keyframesGenerated}</dd>
									</div>
									<div>
										<dt>Safe zone compliance</dt>
										<dd>{formatPercent(stats().safeZoneCompliance)}</dd>
									</div>
								</dl>
								<Show when={stats().safeZoneCompliance < 0.95}>
									<p class="capability-panel-note">
										The subject leaves the safe zone in some frames; widen the bounds in Adjust or
										edit the keyframes by hand after applying.
									</p>
								</Show>

								<div style={{ display: 'flex', gap: '0.5rem', 'flex-wrap': 'wrap' }}>
									<Button size="sm" onClick={() => props.onApply()}>
										Apply
									</Button>
									<Button size="sm" variant="secondary" onClick={() => props.onDiscard()}>
										Discard
									</Button>
									<Button
										size="sm"
										variant="secondary"
										onClick={() => setShowAdjust(!showAdjust())}
									>
										Adjust
									</Button>
								</div>

								{/* Adjust mode */}
								<Show when={showAdjust()}>
									<div
										style={{
											display: 'flex',
											'flex-direction': 'column',
											gap: '0.35rem',
											'margin-top': '0.5rem'
										}}
									>
										<label for="reframe-velocity">
											Velocity bound ({velocityBound().toFixed(2)} /s)
										</label>
										<input
											id="reframe-velocity"
											type="range"
											min="0.05"
											max="1.0"
											step="0.05"
											value={velocityBound()}
											onInput={(e) => setVelocityBound(parseFloat(e.currentTarget.value))}
										/>
										<label for="reframe-accel">
											Acceleration bound ({accelerationBound().toFixed(2)} /s²)
										</label>
										<input
											id="reframe-accel"
											type="range"
											min="0.1"
											max="2.0"
											step="0.1"
											value={accelerationBound()}
											onInput={(e) => setAccelerationBound(parseFloat(e.currentTarget.value))}
										/>
										<label for="reframe-fps">Analysis rate ({analysisFps()} fps)</label>
										<input
											id="reframe-fps"
											type="range"
											min="1"
											max="6"
											step="1"
											value={analysisFps()}
											onInput={(e) => setAnalysisFps(parseInt(e.currentTarget.value, 10))}
										/>
										<Button size="sm" onClick={handleReanalyse}>
											Re-analyse
										</Button>
									</div>
								</Show>
							</section>
						);
					}}
				</Show>
			</aside>
		</Show>
	);
};
