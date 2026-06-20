/**
 * BeatPanel -- beat analysis controls for the Media Bin sidebar.
 *
 * Per-source: analyse/progress/enable toggle/BPM summary.
 * Global: offset nudge slider, auto-cut Split/Align buttons.
 */

import { For, Show, createMemo } from 'solid-js';
import type { MediaAssetSnapshot } from '../protocol';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BeatPanelProps {
	assets: () => readonly MediaAssetSnapshot[];
	beatResults: () => ReadonlyMap<string, { tempoBpm: number; beatTimesMs: number[] }>;
	beatSettings: () => { enabledSourceIds: string[]; globalOffsetMs: number };
	analysisProgress: () => ReadonlyMap<string, number>;
	onAnalyse: (sourceId: string) => void;
	onCancel: (sourceId: string) => void;
	onToggleSource: (sourceId: string, enabled: boolean) => void;
	onOffsetChange: (offsetMs: number) => void;
	onAutoCut: (mode: 'split' | 'align') => void;
	selectedClipCount: () => number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BeatPanel(props: BeatPanelProps) {
	const audioSources = createMemo(() => props.assets().filter((a) => a.audio != null));

	const hasBeatData = createMemo(() => props.beatResults().size > 0);
	const hasSelection = createMemo(() => props.selectedClipCount() > 0);
	const autoCutDisabled = createMemo(() => !hasBeatData() || !hasSelection());

	const autoCutTooltip = createMemo(() => {
		if (!hasBeatData()) return 'No beat analysis available';
		if (!hasSelection()) return 'Select clips to auto-cut';
		return '';
	});

	return (
		<div class="beat-panel" role="region" aria-label="Beat analysis">
			<h3 class="beat-panel-title">Beat Detection</h3>

			{/* Per-source rows */}
			<div class="beat-panel-sources">
				<For each={audioSources()}>
					{(source) => {
						const result = () => props.beatResults().get(source.sourceId);
						const progress = () => props.analysisProgress().get(source.sourceId);
						const isEnabled = () => props.beatSettings().enabledSourceIds.includes(source.sourceId);
						const isAnalysing = () => progress() !== undefined;
						const progressPercent = () => Math.round((progress() ?? 0) * 100);

						return (
							<div class="beat-panel-source-row">
								<div class="beat-panel-source-head">
									<div class="beat-panel-source-name" title={source.fileName}>
										{source.fileName}
									</div>
									<Show
										when={isAnalysing()}
										fallback={
											<Show
												when={result()}
												fallback={<span class="beat-panel-state">Not analysed</span>}
											>
												<span class="beat-panel-state is-ready">Ready</span>
											</Show>
										}
									>
										<span class="beat-panel-state is-busy">Analysing {progressPercent()}%</span>
									</Show>
								</div>

								<Show when={result()} keyed>
									{(beatResult) => (
										<div
											class="beat-panel-result"
											aria-label={`${beatResult.tempoBpm.toFixed(0)} BPM, ${beatResult.beatTimesMs.length} beats`}
										>
											<span class="beat-panel-metric">
												<strong>{beatResult.tempoBpm.toFixed(0)}</strong>
												<span>BPM</span>
											</span>
											<span class="beat-panel-metric">
												<strong>{beatResult.beatTimesMs.length}</strong>
												<span>beats</span>
											</span>
										</div>
									)}
								</Show>

								<div class="beat-panel-source-controls">
									<Show
										when={isAnalysing()}
										fallback={
											<button
												type="button"
												class="beat-panel-analyse-btn"
												onClick={() => props.onAnalyse(source.sourceId)}
												aria-label={`${result() ? 'Re-analyse' : 'Analyse'} beats for ${source.fileName}`}
											>
												{result() ? 'Re-analyse' : 'Analyse beats'}
											</button>
										}
									>
										<div class="beat-panel-progress-wrap" role="status" aria-live="polite">
											<div class="beat-panel-progress-track">
												<div
													class="beat-panel-progress-bar"
													role="progressbar"
													aria-valuenow={progressPercent()}
													aria-valuemin={0}
													aria-valuemax={100}
													aria-label="Beat analysis progress"
													style={{ transform: `scaleX(${progress() ?? 0})` }}
												/>
											</div>
											<button
												type="button"
												class="beat-panel-cancel-btn"
												onClick={() => props.onCancel(source.sourceId)}
												aria-label="Cancel beat analysis"
											>
												Cancel
											</button>
										</div>
									</Show>
									<button
										type="button"
										class={`beat-panel-toggle${isEnabled() ? ' is-active' : ''}`}
										onClick={() => props.onToggleSource(source.sourceId, !isEnabled())}
										aria-pressed={isEnabled()}
										aria-label={`${isEnabled() ? 'Hide' : 'Show'} beat grid for ${source.fileName}`}
										title={isEnabled() ? 'Hide beats' : 'Show beats'}
										disabled={!result()}
									>
										{isEnabled() ? 'Grid on' : 'Show grid'}
									</button>
								</div>
							</div>
						);
					}}
				</For>
				<Show when={audioSources().length === 0}>
					<p class="beat-panel-empty">Import some audio to detect beats.</p>
				</Show>
			</div>

			{/* Global controls */}
			<Show when={hasBeatData()}>
				<div class="beat-panel-global">
					<label class="beat-panel-offset-label">
						<span class="beat-panel-field-head">
							<span>Grid offset</span>
							<output>{props.beatSettings().globalOffsetMs} ms</output>
						</span>
						<input
							type="range"
							min={-500}
							max={500}
							step={1}
							value={props.beatSettings().globalOffsetMs}
							onInput={(e) => props.onOffsetChange(Number(e.currentTarget.value))}
							aria-label="Global beat offset in milliseconds"
						/>
					</label>
					<div class="beat-panel-autocut">
						<button
							type="button"
							class="beat-panel-autocut-btn"
							onClick={() => props.onAutoCut('split')}
							disabled={autoCutDisabled()}
							title={autoCutTooltip() || 'Split clips at beats'}
							aria-disabled={autoCutDisabled()}
						>
							Split at beats
						</button>
						<button
							type="button"
							class="beat-panel-autocut-btn"
							onClick={() => props.onAutoCut('align')}
							disabled={autoCutDisabled()}
							title={autoCutTooltip() || 'Align clips to beats'}
							aria-disabled={autoCutDisabled()}
						>
							Align to beats
						</button>
					</div>
				</div>
			</Show>
		</div>
	);
}
