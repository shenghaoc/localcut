import { createEffect, createSignal, Show, For } from 'solid-js';
import { Mic, BarChart3, Shield, AlertTriangle } from 'lucide-solid';
import { AudioInsertRow } from './AudioInsertRow';
import { Button } from './components/button';
import { RailEmpty } from './RailEmpty';
import type { VoiceCleanupSettings, GateParams, LimiterParams } from '../protocol';

export interface VoiceCleanupPanelProps {
	settings: VoiceCleanupSettings;
	trackNames: ReadonlyMap<string, string>;
	onSettingsChange: (settings: VoiceCleanupSettings) => void;
	onAnalyseLoudness: (targetLufs: number) => void;
	onCancelAnalysis: () => void;
	onApplyNormalisation: (gainDb: number) => void;
	/** Analysis state */
	analysisState: 'idle' | 'running' | 'done' | 'error';
	analysisProgress: number;
	measuredLufs: number;
	proposedGainDb: number;
	normalisedLufs: number;
	analysisError: string;
	latencyMs: number;
	sampleRate: number;
	timelineEmpty: boolean;
	denoiserStatus: 'idle' | 'loading' | 'ready' | 'unavailable';
	denoiserUnavailableReason: string;
	initiallyExpanded?: boolean;
}

function SliderControl(props: {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	unit: string;
	onChange: (value: number) => void;
}) {
	return (
		<div class="slider-control">
			<label>
				<span class="slider-label">{props.label}</span>
				<input
					type="range"
					min={props.min}
					max={props.max}
					step={props.step}
					value={props.value}
					onInput={(e) => props.onChange(parseFloat(e.currentTarget.value))}
					aria-label={props.label}
				/>
				<span class="slider-value">
					{props.value.toFixed(props.step < 1 ? 1 : 0)}
					{props.unit}
				</span>
			</label>
		</div>
	);
}

const LUFS_TARGETS = [
	{ label: '−14 LUFS (streaming)', value: -14 },
	{ label: '−16 LUFS (podcast)', value: -16 },
	{ label: '−23 LUFS (broadcast)', value: -23 }
];

export function isCustomLufsTarget(targetLufs: number): boolean {
	return !LUFS_TARGETS.some((item) => item.value === targetLufs);
}

export function voiceCleanupAnalysisDisabledReason(
	analysisState: VoiceCleanupPanelProps['analysisState'],
	timelineEmpty: boolean
): string | null {
	if (analysisState === 'running') return 'Analysis is already running.';
	if (timelineEmpty) return 'Timeline is empty.';
	return null;
}

export function voiceCleanupLatencyMs(sampleRate: number): number {
	const safeSampleRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48_000;
	return ((128 + 480 + 240) / safeSampleRate) * 1000;
}

export function voiceCleanupLatencyBudget(sampleRate: number): ReadonlyArray<{
	readonly label: string;
	readonly samples: number;
	readonly ms: number;
}> {
	const safeSampleRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48_000;
	return [
		{ label: 'Quantum', samples: 128, ms: (128 / safeSampleRate) * 1000 },
		{ label: 'Denoiser ring', samples: 480, ms: (480 / safeSampleRate) * 1000 },
		{
			label: 'Limiter lookahead',
			samples: 240,
			ms: (240 / safeSampleRate) * 1000
		},
		{ label: 'Gate', samples: 0, ms: 0 }
	];
}

export function VoiceCleanupPanel(props: VoiceCleanupPanelProps) {
	const [expanded, setExpanded] = createSignal(props.initiallyExpanded ?? false);
	const [customTargetLufs, setCustomTargetLufs] = createSignal(-14);
	const [useCustomTarget, setUseCustomTarget] = createSignal(false);

	createEffect(() => {
		const target = props.settings.normalisationTargetLufs;
		const custom = isCustomLufsTarget(target);
		setUseCustomTarget(custom);
		if (custom) setCustomTargetLufs(target);
	});

	const currentTarget = () =>
		useCustomTarget() ? customTargetLufs() : props.settings.normalisationTargetLufs;

	const gateBypass = () => props.settings.gateParams.bypass;
	const limiterBypass = () => props.settings.limiterParams.bypass;

	function updateSettings(patch: Partial<VoiceCleanupSettings>) {
		props.onSettingsChange({ ...props.settings, ...patch });
	}

	function updateGateParams(patch: Partial<GateParams>) {
		updateSettings({ gateParams: { ...props.settings.gateParams, ...patch } });
	}

	function updateLimiterParams(patch: Partial<LimiterParams>) {
		updateSettings({
			limiterParams: { ...props.settings.limiterParams, ...patch }
		});
	}

	function toggleTrackDenoiser(trackId: string) {
		if (props.denoiserStatus === 'unavailable') return;
		const current = props.settings.denoiserEnabledTracks;
		const next = current.includes(trackId)
			? current.filter((id) => id !== trackId)
			: [...current, trackId];
		updateSettings({ denoiserEnabledTracks: next });
	}

	return (
		<div class="live-audio-chain-panel voice-cleanup-panel panel">
			<button
				class="collapse-header"
				type="button"
				onClick={() => setExpanded(!expanded())}
				aria-expanded={expanded()}
				aria-controls={expanded() ? 'voice-cleanup-body' : undefined}
			>
				<span class="panel-title">Voice Cleanup</span>
				<span class="latency-display">Latency: {props.latencyMs.toFixed(1)} ms</span>
			</button>
			<Show when={expanded()}>
				<div class="collapse-body" id="voice-cleanup-body">
					<Show when={props.timelineEmpty}>
						<RailEmpty compact title="Add audio to clean it up">
							Import a clip and place it on an audio track. Denoise and loudness tools activate once
							timeline audio is present.
						</RailEmpty>
					</Show>
					{/* Section (a): Denoiser */}
					<AudioInsertRow
						label="Denoiser"
						icon={<Mic size={14} aria-hidden="true" />}
						bypass={props.settings.denoiserEnabledTracks.length === 0}
						onToggleBypass={() => {
							if (props.settings.denoiserEnabledTracks.length > 0) {
								updateSettings({ denoiserEnabledTracks: [] });
							}
							// Enabling requires selecting tracks below
						}}
					>
						<div class="denoiser-tracks">
							<Show when={props.trackNames.size === 0 && !props.timelineEmpty}>
								<p class="placeholder-text">
									Add audio clips to the timeline to enable per-track denoising.
								</p>
							</Show>
							<Show when={props.trackNames.size === 0 && props.timelineEmpty}>
								<p class="placeholder-text">No audio tracks yet.</p>
							</Show>
							<Show when={props.trackNames.size > 0}>
								<p class="insert-hint">
									Enable per-track denoising. The denoiser runs on the monitor bus and export chain.
								</p>
							</Show>
							<Show when={props.denoiserStatus === 'unavailable'}>
								<div class="analysis-error" role="alert">
									<AlertTriangle size={14} />
									<span>Denoiser unavailable: {props.denoiserUnavailableReason}</span>
								</div>
							</Show>
							<Show when={props.denoiserStatus === 'loading'}>
								<p class="insert-hint" role="status" aria-live="polite" aria-atomic="true">
									Loading RNNoise WASM…
								</p>
							</Show>
							<Show when={props.denoiserStatus === 'ready'}>
								<p class="insert-hint" role="status" aria-live="polite" aria-atomic="true">
									RNNoise WASM ready.
								</p>
							</Show>
							<table class="latency-budget-table">
								<thead>
									<tr>
										<th scope="col">Stage</th>
										<th scope="col">Samples</th>
										<th scope="col">ms</th>
									</tr>
								</thead>
								<tbody>
									<For each={voiceCleanupLatencyBudget(props.sampleRate)}>
										{(row) => (
											<tr>
												<th scope="row">{row.label}</th>
												<td>{row.samples}</td>
												<td>{row.ms.toFixed(2)}</td>
											</tr>
										)}
									</For>
									<tr>
										<th scope="row">Total</th>
										<td>848</td>
										<td>{props.latencyMs.toFixed(2)}</td>
									</tr>
								</tbody>
							</table>
							<For each={[...props.trackNames.entries()]}>
								{([trackId, name]) => (
									<label class="track-toggle">
										<input
											type="checkbox"
											checked={props.settings.denoiserEnabledTracks.includes(trackId)}
											disabled={props.denoiserStatus === 'unavailable'}
											onChange={() => toggleTrackDenoiser(trackId)}
										/>
										<span>{name}</span>
									</label>
								)}
							</For>
						</div>
					</AudioInsertRow>

					{/* Section (b): Loudness Normalisation */}
					<AudioInsertRow
						label="Loudness Normalisation"
						icon={<BarChart3 size={14} aria-hidden="true" />}
						bypass={props.settings.normaliseGainDb === 0}
						onToggleBypass={() => {
							if (props.settings.normaliseGainDb !== 0) {
								updateSettings({ normaliseGainDb: 0 });
								props.onApplyNormalisation(0);
							}
						}}
					>
						<div class="loudness-controls">
							<div class="target-selector">
								<span class="slider-label">Target</span>
								<For each={LUFS_TARGETS}>
									{(target) => (
										<Button
											variant={
												!useCustomTarget() &&
												props.settings.normalisationTargetLufs === target.value
													? 'default'
													: 'secondary'
											}
											size="sm"
											onClick={() => {
												setUseCustomTarget(false);
												updateSettings({
													normalisationTargetLufs: target.value
												});
											}}
										>
											{target.label}
										</Button>
									)}
								</For>
								<Button
									variant={useCustomTarget() ? 'default' : 'secondary'}
									size="sm"
									onClick={() => setUseCustomTarget(true)}
								>
									Custom
								</Button>
							</div>
							<Show when={useCustomTarget()}>
								<SliderControl
									label="Custom"
									value={customTargetLufs()}
									min={-36}
									max={-6}
									step={0.5}
									unit=" LUFS"
									onChange={(v) => {
										setCustomTargetLufs(v);
										updateSettings({ normalisationTargetLufs: v });
									}}
								/>
							</Show>
							<div class="analysis-actions">
								<Show
									when={props.analysisState !== 'running'}
									fallback={
										<div class="analysis-progress">
											<progress value={props.analysisProgress} max={1} />
											<span>{(props.analysisProgress * 100).toFixed(0)}%</span>
											<Button variant="secondary" size="sm" onClick={props.onCancelAnalysis}>
												Cancel
											</Button>
										</div>
									}
								>
									<Button
										variant="default"
										size="sm"
										disabled={
											voiceCleanupAnalysisDisabledReason(
												props.analysisState,
												props.timelineEmpty
											) !== null
										}
										title={
											voiceCleanupAnalysisDisabledReason(
												props.analysisState,
												props.timelineEmpty
											) ?? undefined
										}
										onClick={() => props.onAnalyseLoudness(currentTarget())}
									>
										Analyse &amp; Normalise
									</Button>
								</Show>
							</div>
							<Show when={props.analysisState === 'done'}>
								<div class="analysis-result">
									<dl class="diagnostics-grid">
										<dt>Measured</dt>
										<dd>
											{Number.isFinite(props.measuredLufs)
												? `${props.measuredLufs.toFixed(1)} LUFS`
												: '−∞ LUFS'}
										</dd>
										<dt>Correction</dt>
										<dd>
											{props.proposedGainDb >= 0 ? '+' : ''}
											{props.proposedGainDb.toFixed(1)} dB
										</dd>
										<dt>Result</dt>
										<dd>
											{Number.isFinite(props.normalisedLufs)
												? `${props.normalisedLufs.toFixed(1)} LUFS`
												: '−∞ LUFS'}
										</dd>
									</dl>
									<Button
										variant="default"
										size="sm"
										onClick={() => props.onApplyNormalisation(props.proposedGainDb)}
									>
										Apply ({props.proposedGainDb >= 0 ? '+' : ''}
										{props.proposedGainDb.toFixed(1)} dB)
									</Button>
									<Button
										variant="secondary"
										size="sm"
										onClick={() => props.onApplyNormalisation(0)}
									>
										Reset
									</Button>
								</div>
							</Show>
							<Show when={props.analysisState === 'error'}>
								<div class="analysis-error" role="alert">
									<AlertTriangle size={14} />
									<span>{props.analysisError}</span>
								</div>
							</Show>
							<Show when={props.settings.normaliseGainDb !== 0}>
								<p class="insert-hint">
									Active correction: {props.settings.normaliseGainDb >= 0 ? '+' : ''}
									{props.settings.normaliseGainDb.toFixed(1)} dB
								</p>
							</Show>
						</div>
					</AudioInsertRow>

					{/* Section (c): Gate */}
					<AudioInsertRow
						label="Gate"
						icon={<Shield size={14} aria-hidden="true" />}
						bypass={gateBypass()}
						onToggleBypass={() => updateGateParams({ bypass: !gateBypass() })}
					>
						<SliderControl
							label="Threshold"
							value={props.settings.gateParams.thresholdDb}
							min={-80}
							max={0}
							step={1}
							unit=" dB"
							onChange={(v) => updateGateParams({ thresholdDb: v })}
						/>
						<SliderControl
							label="Range"
							value={props.settings.gateParams.rangeDb}
							min={-80}
							max={0}
							step={1}
							unit=" dB"
							onChange={(v) => updateGateParams({ rangeDb: v })}
						/>
						<SliderControl
							label="Attack"
							value={props.settings.gateParams.attackMs}
							min={0.1}
							max={50}
							step={0.1}
							unit=" ms"
							onChange={(v) => updateGateParams({ attackMs: v })}
						/>
						<SliderControl
							label="Hold"
							value={props.settings.gateParams.holdMs}
							min={0}
							max={500}
							step={1}
							unit=" ms"
							onChange={(v) => updateGateParams({ holdMs: v })}
						/>
						<SliderControl
							label="Release"
							value={props.settings.gateParams.releaseMs}
							min={1}
							max={500}
							step={1}
							unit=" ms"
							onChange={(v) => updateGateParams({ releaseMs: v })}
						/>
					</AudioInsertRow>

					{/* Section (d): Limiter */}
					<AudioInsertRow
						label="Limiter"
						icon={<AlertTriangle size={14} aria-hidden="true" />}
						bypass={limiterBypass()}
						onToggleBypass={() => updateLimiterParams({ bypass: !limiterBypass() })}
					>
						<SliderControl
							label="Ceiling"
							value={props.settings.limiterCeilingDbtp}
							min={-9}
							max={-0.1}
							step={0.1}
							unit=" dBTP"
							onChange={(v) => updateSettings({ limiterCeilingDbtp: v })}
						/>
						<SliderControl
							label="Attack"
							value={props.settings.limiterParams.attackUs}
							min={10}
							max={1000}
							step={10}
							unit=" µs"
							onChange={(v) => updateLimiterParams({ attackUs: v })}
						/>
						<SliderControl
							label="Release"
							value={props.settings.limiterParams.releaseMs}
							min={1}
							max={200}
							step={1}
							unit=" ms"
							onChange={(v) => updateLimiterParams({ releaseMs: v })}
						/>
					</AudioInsertRow>
				</div>
			</Show>
		</div>
	);
}
