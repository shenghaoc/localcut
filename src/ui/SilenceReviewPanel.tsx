/** Silence Review Panel — Phase 44 T4.
 *
 *  Non-modal panel rendered in the Inspector region. Displays detected silent
 *  regions with per-region Apply / Skip controls. No media objects or GPU
 *  handles leak into this component.
 */

import { createSignal, For, Show, onCleanup } from 'solid-js';
import { Button } from './components/button';
import type {
	SilenceDetectionParams,
	SilenceRegion,
	WorkerCommand,
	WorkerStateMessage
} from '../protocol';
import { SILENCE_DEFAULTS } from '../engine/silence-detector';

export interface SilenceReviewPanelProps {
	/** Currently selected audio track IDs (or every audio track if no
	 *  selection — see {@link SilenceReviewPanelProps.selectionScope}). */
	trackIds: string[];
	/** Where {@link SilenceReviewPanelProps.trackIds} came from. Drives the
	 *  status line so users understand why they're seeing regions from tracks
	 *  they may not have intentionally selected. */
	selectionScope?: 'selection' | 'all-audio';
	/** Send a command to the pipeline worker. */
	sendCommand: (cmd: WorkerCommand) => void;
	/** Register a handler for worker state messages; returns an unsubscribe function. */
	onWorkerMessage: (handler: (msg: WorkerStateMessage) => void) => () => void;
	/** Apply a single silent region (ripple-delete clips within boundaries). */
	onApplyRegion: (region: SilenceRegion) => void;
	/** Apply all non-skipped regions. */
	onApplyAll: (regions: SilenceRegion[]) => void;
	/** Called when the panel wants to close. */
	onClose?: () => void;
}

/** Format seconds as HH:MM:SS.mmm. */
function formatTime(s: number): string {
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec.toFixed(3).padStart(6, '0')}`;
}

export function SilenceReviewPanel(props: SilenceReviewPanelProps) {
	const [regions, setRegions] = createSignal<SilenceRegion[]>([]);
	const [skipped, setSkipped] = createSignal<Set<number>>(new Set<number>());
	const [applied, setApplied] = createSignal<Set<number>>(new Set<number>());
	const [detecting, setDetecting] = createSignal(false);
	const [progress, setProgress] = createSignal(0);
	const [error, setError] = createSignal<string | null>(null);
	const [showParams, setShowParams] = createSignal(true);

	// Tunable parameters (local draft).
	const [openThreshold, setOpenThreshold] = createSignal(SILENCE_DEFAULTS.openThreshold);
	const [closeThreshold, setCloseThreshold] = createSignal(SILENCE_DEFAULTS.closeThreshold);
	const [minSilence, setMinSilence] = createSignal(SILENCE_DEFAULTS.minSilence);
	const [keepPadding, setKeepPadding] = createSignal(SILENCE_DEFAULTS.keepPadding);
	const [minKeptSegment, setMinKeptSegment] = createSignal(SILENCE_DEFAULTS.minKeptSegment);

	let currentRequestId: string | null = null;

	// Listen for worker messages.
	// oxlint-disable-next-line solid/reactivity -- one-time subscription set up at mount, not a render-time read
	const unsubscribe = props.onWorkerMessage((msg) => {
		if (msg.type === 'silence-progress' && msg.requestId === currentRequestId) {
			setProgress(msg.progressFraction);
		} else if (msg.type === 'silence-result' && msg.requestId === currentRequestId) {
			setRegions(msg.regions);
			setSkipped(new Set<number>());
			setApplied(new Set<number>());
			setDetecting(false);
			setProgress(0);
			currentRequestId = null;
		} else if (msg.type === 'silence-error' && msg.requestId === currentRequestId) {
			setError(msg.message);
			setDetecting(false);
			setProgress(0);
			currentRequestId = null;
		}
	});
	onCleanup(unsubscribe);

	// Cancel in-flight detection on unmount.
	onCleanup(() => {
		if (currentRequestId) {
			props.sendCommand({ type: 'cancel-silence-detection', requestId: currentRequestId });
			currentRequestId = null;
		}
	});

	/** True when at least one detected region has neither been applied nor
	 *  explicitly skipped. */
	function hasUnreviewed(): boolean {
		const r = regions();
		if (r.length === 0) return false;
		const a = applied();
		const s = skipped();
		return r.some((_, i) => !a.has(i) && !s.has(i));
	}

	/** Wraps `props.onClose` with a confirmation dialog when unreviewed regions
	 *  remain. The previous implementation ran the prompt inside `onCleanup`,
	 *  which fires AFTER the panel has already been removed — the boolean
	 *  result was ignored, so "Cancel" did nothing. Pushing the guard into the
	 *  close handler means the panel only unmounts when the user confirms. */
	function requestClose(): void {
		if (hasUnreviewed()) {
			// eslint-disable-next-line no-alert
			const proceed = window.confirm('You have unreviewed silence regions. Discard them?');
			if (!proceed) return;
		}
		props.onClose?.();
	}

	function handleDetect() {
		if (detecting()) return;
		if (props.trackIds.length === 0) return;
		setError(null);
		setRegions([]);
		setSkipped(new Set<number>());
		setApplied(new Set<number>());
		setDetecting(true);
		setProgress(0);
		const requestId = crypto.randomUUID();
		currentRequestId = requestId;
		const params: SilenceDetectionParams = {
			openThreshold: openThreshold(),
			closeThreshold: closeThreshold(),
			minSilence: minSilence(),
			keepPadding: keepPadding(),
			minKeptSegment: minKeptSegment(),
			sampleRate: SILENCE_DEFAULTS.sampleRate,
			windowSamples: SILENCE_DEFAULTS.windowSamples,
			hopSamples: SILENCE_DEFAULTS.hopSamples
		};
		props.sendCommand({ type: 'detect-silence', requestId, trackIds: props.trackIds, params });
	}

	function handleRetry() {
		setError(null);
		handleDetect();
	}

	function toggleSkip(index: number) {
		setSkipped((prev: Set<number>) => {
			const next = new Set<number>(prev);
			if (next.has(index)) next.delete(index);
			else next.add(index);
			return next;
		});
	}

	function handleApply(index: number) {
		const r = regions();
		const target = r[index];
		if (!target) return;
		props.onApplyRegion(target);
		setApplied((prev: Set<number>) => {
			const next = new Set<number>(prev);
			next.add(index);
			return next;
		});
		// Every applied region shifts the timeline left by its (endS - startS).
		// Without rebasing, the next Apply searches the post-ripple timeline
		// with stale pre-ripple timestamps and removes the wrong clips
		// (or none). Subtract this region's length from every LATER region's
		// startS/endS so subsequent Applies hit the right material.
		const shift = target.endS - target.startS;
		setRegions((prev) =>
			prev.map((region, i) =>
				i > index ? { ...region, startS: region.startS - shift, endS: region.endS - shift } : region
			)
		);
	}

	function handleApplyAll() {
		const r = regions();
		const s = skipped();
		const nonSkipped = r.filter((_, i) => !s.has(i));
		if (nonSkipped.length === 0) return;
		props.onApplyAll(nonSkipped);
		const allApplied = new Set<number>(r.map((_, i) => i).filter((i) => !s.has(i)));
		setApplied((prev: Set<number>) => new Set<number>([...prev, ...allApplied]));
	}

	const allResolved = () => {
		const r = regions();
		if (r.length === 0) return true;
		const a = applied();
		const s = skipped();
		return r.every((_, i) => a.has(i) || s.has(i));
	};

	const nonSkippedCount = () => {
		const r = regions();
		const s = skipped();
		return r.filter((_, i) => !s.has(i)).length;
	};

	const audioDisabled = () => props.trackIds.length === 0;

	return (
		<div class="silence-review-panel" role="region" aria-label="Silence Detection">
			<div class="silence-review-header">
				<h3>Silence Detection</h3>
				{props.onClose && (
					<button
						type="button"
						class="silence-review-close"
						aria-label="Close panel"
						title="Close panel"
						onClick={requestClose}
					>
						×
					</button>
				)}
			</div>

			{/* Parameter controls */}
			<details open={showParams()} onToggle={(e) => setShowParams(e.currentTarget.open)}>
				<summary>Detection Parameters</summary>
				<div class="silence-params">
					<label>
						<span>Open threshold (dBFS)</span>
						<input
							type="range"
							min={-60}
							max={-20}
							step={1}
							value={openThreshold()}
							disabled={detecting()}
							onInput={(e) => setOpenThreshold(Number(e.currentTarget.value))}
							aria-label="Open threshold"
						/>
						<span class="silence-param-value">{openThreshold()}</span>
					</label>
					<label>
						<span>Close threshold (dBFS)</span>
						<input
							type="range"
							min={-60}
							max={-20}
							step={1}
							value={closeThreshold()}
							disabled={detecting()}
							onInput={(e) => setCloseThreshold(Number(e.currentTarget.value))}
							aria-label="Close threshold"
						/>
						<span class="silence-param-value">{closeThreshold()}</span>
					</label>
					<label>
						<span>Min silence (s)</span>
						<input
							type="range"
							min={0.1}
							max={10}
							step={0.1}
							value={minSilence()}
							disabled={detecting()}
							onInput={(e) => setMinSilence(Number(e.currentTarget.value))}
							aria-label="Minimum silence duration"
						/>
						<span class="silence-param-value">{minSilence().toFixed(1)}</span>
					</label>
					<label>
						<span>Keep padding (s)</span>
						<input
							type="range"
							min={0}
							max={1}
							step={0.05}
							value={keepPadding()}
							disabled={detecting()}
							onInput={(e) => setKeepPadding(Number(e.currentTarget.value))}
							aria-label="Keep padding"
						/>
						<span class="silence-param-value">{keepPadding().toFixed(2)}</span>
					</label>
					<label>
						<span>Min kept segment (s)</span>
						<input
							type="range"
							min={0.1}
							max={2}
							step={0.1}
							value={minKeptSegment()}
							disabled={detecting()}
							onInput={(e) => setMinKeptSegment(Number(e.currentTarget.value))}
							aria-label="Minimum kept segment"
						/>
						<span class="silence-param-value">{minKeptSegment().toFixed(1)}</span>
					</label>
				</div>
			</details>

			{/* Detect button */}
			<div class="silence-actions">
				<Button
					variant="default"
					disabled={detecting() || audioDisabled()}
					onClick={handleDetect}
					title={audioDisabled() ? 'Select at least one audio track to detect silence.' : undefined}
				>
					{detecting() ? 'Detecting…' : 'Detect Silence'}
				</Button>
				<Show when={!audioDisabled()}>
					<span class="silence-scope-hint">
						{props.selectionScope === 'selection'
							? `Scanning ${props.trackIds.length} selected audio track${props.trackIds.length === 1 ? '' : 's'}.`
							: `No audio selection — scanning all ${props.trackIds.length} audio track${props.trackIds.length === 1 ? '' : 's'}. Select an audio clip to narrow.`}
					</span>
				</Show>
			</div>

			{/* Progress bar */}
			<Show when={detecting()}>
				<div
					class="silence-progress"
					role="progressbar"
					aria-valuenow={Math.round(progress() * 100)}
				>
					<progress max="1" value={progress()} />
					<span>{Math.round(progress() * 100)}%</span>
				</div>
			</Show>

			{/* Error display */}
			<Show when={error()}>
				{(err) => (
					<div class="silence-error" role="alert">
						<p>{err()}</p>
						<Button variant="secondary" onClick={handleRetry}>
							Retry
						</Button>
					</div>
				)}
			</Show>

			{/* Region list */}
			<Show when={regions().length > 0}>
				<div class="silence-region-list">
					<table>
						<thead>
							<tr>
								<th>Start</th>
								<th>End</th>
								<th>Duration</th>
								<th>Peak dB</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							<For each={regions()}>
								{(region, i) => {
									const isSkipped = () => skipped().has(i());
									const isApplied = () => applied().has(i());
									const duration = () => region.endS - region.startS;
									return (
										<tr
											style={{
												opacity: isSkipped() ? '0.4' : '1',
												'text-decoration': isApplied() ? 'line-through' : 'none'
											}}
										>
											<td>{formatTime(region.startS)}</td>
											<td>{formatTime(region.endS)}</td>
											<td>{duration().toFixed(2)}s</td>
											<td>{region.peakDb.toFixed(1)} dB</td>
											<td>
												<button
													type="button"
													class="silence-btn-apply"
													disabled={isApplied() || isSkipped()}
													onClick={() => handleApply(i())}
													aria-label={`Apply region ${i() + 1}`}
												>
													{isApplied() ? 'Applied' : 'Apply'}
												</button>
												<button
													type="button"
													class="silence-btn-skip"
													disabled={isApplied()}
													onClick={() => toggleSkip(i())}
													aria-label={
														isSkipped() ? `Unskip region ${i() + 1}` : `Skip region ${i() + 1}`
													}
												>
													{isSkipped() ? 'Unskip' : 'Skip'}
												</button>
											</td>
										</tr>
									);
								}}
							</For>
						</tbody>
					</table>
					<div class="silence-apply-all">
						<Button
							variant="default"
							disabled={allResolved() || nonSkippedCount() === 0}
							onClick={handleApplyAll}
						>
							Apply All ({nonSkippedCount()})
						</Button>
					</div>
				</div>
			</Show>
		</div>
	);
}
