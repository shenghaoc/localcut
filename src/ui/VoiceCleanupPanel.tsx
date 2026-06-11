import { createSignal, Show, For, type JSX } from 'solid-js';
import { Power, PowerOff, Mic, BarChart3, Shield, AlertTriangle } from 'lucide-solid';
import { Button } from './components/button';
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
	analysisError: string;
	latencyMs: number;
}

function InsertRow(props: {
	label: string;
	icon: JSX.Element;
	bypass: boolean;
	onToggleBypass: () => void;
	children?: JSX.Element;
}) {
	const [expanded, setExpanded] = createSignal(false);

	return (
		<div class="insert-row">
			<div
				class="insert-header"
				onClick={() => setExpanded(!expanded())}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						setExpanded(!expanded());
					}
				}}
				role="button"
				aria-expanded={expanded()}
				tabIndex={0}
			>
				<Button
					variant="ghost"
					size="icon"
					onClick={(e: MouseEvent) => {
						e.stopPropagation();
						props.onToggleBypass();
					}}
					aria-label={props.bypass ? `Enable ${props.label}` : `Bypass ${props.label}`}
					aria-pressed={!props.bypass}
				>
					<Show when={props.bypass} fallback={<Power size={14} />}>
						<PowerOff size={14} />
					</Show>
				</Button>
				{props.icon}
				<span class="insert-name">{props.label}</span>
				<span class={`insert-status ${props.bypass ? 'bypassed' : 'active'}`}>
					{props.bypass ? 'Bypassed' : 'Active'}
				</span>
			</div>
			<Show when={expanded()}>
				<div class="insert-params">{props.children}</div>
			</Show>
		</div>
	);
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
	{ label: '−23 LUFS (broadcast)', value: -23 },
];

export function VoiceCleanupPanel(props: VoiceCleanupPanelProps) {
	const [expanded, setExpanded] = createSignal(false);
	const [customTargetLufs, setCustomTargetLufs] = createSignal(-14);
	const [useCustomTarget, setUseCustomTarget] = createSignal(false);

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
		updateSettings({ limiterParams: { ...props.settings.limiterParams, ...patch } });
	}

	function toggleTrackDenoiser(trackId: string) {
		const current = props.settings.denoiserEnabledTracks;
		const next = current.includes(trackId)
			? current.filter((id) => id !== trackId)
			: [...current, trackId];
		updateSettings({ denoiserEnabledTracks: next });
	}

	return (
		<div class="live-audio-chain-panel voice-cleanup-panel panel">
			<div
				class="collapse-header"
				onClick={() => setExpanded(!expanded())}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						setExpanded(!expanded());
					}
				}}
				role="button"
				aria-expanded={expanded()}
				tabIndex={0}
			>
				<span class="panel-title">Voice Cleanup</span>
				<span class="latency-display" aria-live="polite">
					Latency: {props.latencyMs.toFixed(1)} ms
				</span>
			</div>
			<Show when={expanded()}>
				<div class="collapse-body">
					{/* Section (a): Denoiser */}
					<InsertRow
						label="Denoiser"
						icon={<Mic size={14} />}
						bypass={props.settings.denoiserEnabledTracks.length === 0}
						onToggleBypass={() => {
							if (props.settings.denoiserEnabledTracks.length > 0) {
								updateSettings({ denoiserEnabledTracks: [] });
							}
							// Enabling requires selecting tracks below
						}}
					>
						<div class="denoiser-tracks">
							<p class="insert-hint">
								Enable per-track denoising. The WASM RNNoise denoiser
								runs on the monitor bus and export chain.
							</p>
							<For each={[...props.trackNames.entries()]}>
								{([trackId, name]) => (
									<label class="track-toggle">
										<input
											type="checkbox"
											checked={props.settings.denoiserEnabledTracks.includes(trackId)}
											onChange={() => toggleTrackDenoiser(trackId)}
										/>
										<span>{name}</span>
									</label>
								)}
							</For>
						</div>
					</InsertRow>

					{/* Section (b): Loudness Normalisation */}
					<InsertRow
						label="Loudness Normalisation"
						icon={<BarChart3 size={14} />}
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
												updateSettings({ normalisationTargetLufs: target.value });
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
									onChange={setCustomTargetLufs}
								/>
							</Show>
							<div class="analysis-actions">
								<Show
									when={props.analysisState !== 'running'}
									fallback={
										<div class="analysis-progress">
											<progress value={props.analysisProgress} max={1} />
											<span>{(props.analysisProgress * 100).toFixed(0)}%</span>
											<Button
												variant="secondary"
												size="sm"
												onClick={props.onCancelAnalysis}
											>
												Cancel
											</Button>
										</div>
									}
								>
									<Button
										variant="default"
										size="sm"
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
									</dl>
									<Button
										variant="default"
										size="sm"
										onClick={() =>
											props.onApplyNormalisation(props.proposedGainDb)
										}
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
					</InsertRow>

					{/* Section (c): Gate */}
					<InsertRow
						label="Gate"
						icon={<Shield size={14} />}
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
					</InsertRow>

					{/* Section (d): Limiter */}
					<InsertRow
						label="Limiter"
						icon={<AlertTriangle size={14} />}
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
					</InsertRow>
				</div>
			</Show>
		</div>
	);
}
