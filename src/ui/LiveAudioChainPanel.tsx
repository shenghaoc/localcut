import { createSignal, Show, type JSX } from 'solid-js';
import { Power, PowerOff } from 'lucide-solid';
import { Button } from './components/button';
import type { LiveAudioChainConfig } from '../protocol';

export interface LiveAudioChainPanelProps {
	config: LiveAudioChainConfig;
	onConfigChange: (config: Partial<LiveAudioChainConfig>) => void;
	latencyMs: number;
	crossOriginIsolated: boolean;
	isCapturing: boolean;
}

function InsertRow(props: {
	label: string;
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
				<span class="insert-name">{props.label}</span>
				<span class={`insert-status ${props.bypass ? 'bypassed' : 'active'}`}>
					{props.bypass ? 'Bypassed' : 'Active'}
				</span>
			</div>
			<Show when={expanded()}>
				<div class="insert-params">
					{props.children}
				</div>
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
					aria-valuemin={props.min}
					aria-valuemax={props.max}
					aria-valuenow={props.value}
				/>
				<span class="slider-value" style="font-variant-numeric: tabular-nums">
					{props.value.toFixed(1)}{props.unit}
				</span>
			</label>
		</div>
	);
}

export function LiveAudioChainPanel(props: LiveAudioChainPanelProps) {
	const [expanded, setExpanded] = createSignal(false);

	const cfg = () => props.config;

	return (
		<div class="live-audio-chain-panel panel">
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
				<span class="panel-title">Live Audio Chain</span>
				<span class="latency-display" aria-live="polite">
					Latency: {props.latencyMs.toFixed(1)} ms
				</span>
			</div>

			<Show when={expanded()}>
				<div class="collapse-body">
					<Show when={!props.crossOriginIsolated}>
						<div class="capability-warning" role="alert">
							Live Audio Chain requires cross-origin isolation.
						</div>
					</Show>

					<Show when={props.crossOriginIsolated}>
						{/* Gate */}
						<InsertRow
							label="Gate"
							bypass={cfg().gate.bypass}
							onToggleBypass={() => props.onConfigChange({
								gate: { ...cfg().gate, bypass: !cfg().gate.bypass }
							})}
						>
							<SliderControl label="Threshold" value={cfg().gate.thresholdDb} min={-80} max={0} step={0.5} unit=" dB"
								onChange={(v) => props.onConfigChange({ gate: { ...cfg().gate, thresholdDb: v } })} />
							<SliderControl label="Range" value={cfg().gate.rangeDb} min={-120} max={0} step={1} unit=" dB"
								onChange={(v) => props.onConfigChange({ gate: { ...cfg().gate, rangeDb: v } })} />
							<SliderControl label="Attack" value={cfg().gate.attackMs} min={0.01} max={10} step={0.01} unit=" ms"
								onChange={(v) => props.onConfigChange({ gate: { ...cfg().gate, attackMs: v } })} />
							<SliderControl label="Hold" value={cfg().gate.holdMs} min={0} max={500} step={1} unit=" ms"
								onChange={(v) => props.onConfigChange({ gate: { ...cfg().gate, holdMs: v } })} />
							<SliderControl label="Release" value={cfg().gate.releaseMs} min={1} max={1000} step={1} unit=" ms"
								onChange={(v) => props.onConfigChange({ gate: { ...cfg().gate, releaseMs: v } })} />
						</InsertRow>

						{/* Denoiser (reserved) */}
						<div class="insert-row disabled">
							<div class="insert-header">
								<Button variant="ghost" size="icon" disabled aria-label="Denoiser unavailable">
									<PowerOff size={14} />
								</Button>
								<span class="insert-name">Noise Suppression</span>
								<span class="insert-status bypassed">Available in a future update</span>
							</div>
						</div>

						{/* Compressor */}
						<InsertRow
							label="Compressor"
							bypass={cfg().compressor.bypass}
							onToggleBypass={() => props.onConfigChange({
								compressor: { ...cfg().compressor, bypass: !cfg().compressor.bypass }
							})}
						>
							<SliderControl label="Threshold" value={cfg().compressor.thresholdDb} min={-60} max={0} step={0.5} unit=" dB"
								onChange={(v) => props.onConfigChange({ compressor: { ...cfg().compressor, thresholdDb: v } })} />
							<SliderControl label="Ratio" value={cfg().compressor.ratio} min={1} max={20} step={0.1} unit=":1"
								onChange={(v) => props.onConfigChange({ compressor: { ...cfg().compressor, ratio: v } })} />
							<SliderControl label="Attack" value={cfg().compressor.attackMs} min={0.1} max={100} step={0.1} unit=" ms"
								onChange={(v) => props.onConfigChange({ compressor: { ...cfg().compressor, attackMs: v } })} />
							<SliderControl label="Release" value={cfg().compressor.releaseMs} min={10} max={2000} step={1} unit=" ms"
								onChange={(v) => props.onConfigChange({ compressor: { ...cfg().compressor, releaseMs: v } })} />
							<SliderControl label="Knee" value={cfg().compressor.kneeDb} min={0} max={24} step={0.5} unit=" dB"
								onChange={(v) => props.onConfigChange({ compressor: { ...cfg().compressor, kneeDb: v } })} />
							<SliderControl label="Makeup Gain" value={cfg().compressor.makeupGainDb} min={-12} max={24} step={0.5} unit=" dB"
								onChange={(v) => props.onConfigChange({ compressor: { ...cfg().compressor, makeupGainDb: v } })} />
						</InsertRow>

						{/* Limiter */}
						<InsertRow
							label="Limiter"
							bypass={cfg().limiter.bypass}
							onToggleBypass={() => props.onConfigChange({
								limiter: { ...cfg().limiter, bypass: !cfg().limiter.bypass }
							})}
						>
							<SliderControl label="Ceiling" value={cfg().limiter.ceilingDb} min={-12} max={0} step={0.1} unit=" dB"
								onChange={(v) => props.onConfigChange({ limiter: { ...cfg().limiter, ceilingDb: v } })} />
							<SliderControl label="Attack" value={cfg().limiter.attackUs} min={10} max={10000} step={10} unit=" µs"
								onChange={(v) => props.onConfigChange({ limiter: { ...cfg().limiter, attackUs: v } })} />
							<SliderControl label="Release" value={cfg().limiter.releaseMs} min={1} max={500} step={1} unit=" ms"
								onChange={(v) => props.onConfigChange({ limiter: { ...cfg().limiter, releaseMs: v } })} />
						</InsertRow>

						{/* Print to recording toggle */}
						<Show when={props.isCapturing}>
							<div class="print-toggle">
								<label>
									<input
										type="checkbox"
										checked={cfg().printToRecording}
										onChange={(e) => props.onConfigChange({ printToRecording: e.currentTarget.checked })}
									/>
									Print chain to recording
								</label>
								<p class="print-toggle-hint">
									Applies the chain to recorded audio in the pipeline worker. Monitor output is
									unprocessed in this version.
								</p>
							</div>
						</Show>
					</Show>
				</div>
			</Show>
		</div>
	);
}
