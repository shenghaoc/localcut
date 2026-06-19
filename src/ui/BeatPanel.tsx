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

						return (
							<div class="beat-panel-source-row">
								<div class="beat-panel-source-name" title={source.fileName}>
									{source.fileName}
								</div>
								<div class="beat-panel-source-controls">
									<Show
										when={result()}
										fallback={
											<Show
												when={isAnalysing()}
												fallback={
													<button
														type="button"
														class="beat-panel-analyse-btn"
														onClick={() => props.onAnalyse(source.sourceId)}
														aria-label={`Analyse beats for ${source.fileName}`}
													>
														Analyse
													</button>
												}
											>
												<div class="beat-panel-progress-wrap">
													<div
														class="beat-panel-progress-bar"
														role="progressbar"
														aria-valuenow={Math.round((progress() ?? 0) * 100)}
														aria-valuemin={0}
														aria-valuemax={100}
														aria-label="Beat analysis progress"
														style={{ transform: `scaleX(${progress() ?? 0})` }}
													/>
													<button
														type="button"
														class="beat-panel-cancel-btn"
														onClick={() => props.onCancel(source.sourceId)}
														aria-label="Cancel analysis"
														title="Cancel"
													>
														×
													</button>
												</div>
											</Show>
										}
									>
										<div class="beat-panel-result">
											<span class="beat-panel-bpm">{result()!.tempoBpm.toFixed(0)} BPM</span>
											<span class="beat-panel-count">{result()!.beatTimesMs.length} beats</span>
											<button
												type="button"
												class="beat-panel-analyse-btn"
												onClick={() => props.onAnalyse(source.sourceId)}
												aria-label={`Re-analyse beats for ${source.fileName}`}
												title="Re-analyse"
											>
												↻
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
										{isEnabled() ? 'On' : 'Off'}
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
						Offset: {props.beatSettings().globalOffsetMs}ms
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
							Split
						</button>
						<button
							type="button"
							class="beat-panel-autocut-btn"
							onClick={() => props.onAutoCut('align')}
							disabled={autoCutDisabled()}
							title={autoCutTooltip() || 'Align clips to beats'}
							aria-disabled={autoCutDisabled()}
						>
							Align
						</button>
					</div>
				</div>
			</Show>
		</div>
	);
}
