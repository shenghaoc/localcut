import { createSignal, Show } from 'solid-js';
import { AudioInsertRow } from './AudioInsertRow';
import type { LiveAudioChainConfig } from '../protocol';

export interface LiveAudioChainPanelProps {
	config: LiveAudioChainConfig;
	onConfigChange: (config: Partial<LiveAudioChainConfig>) => void;
	latencyMs: number;
	crossOriginIsolated: boolean;
	isCapturing: boolean;
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
					aria-valuemin={props.min}
					aria-valuemax={props.max}
					aria-valuenow={props.value}
				/>
				<span class="slider-value" style={{ 'font-variant-numeric': 'tabular-nums' }}>
					{props.value.toFixed(1)}
					{props.unit}
				</span>
			</label>
		</div>
	);
}

export function LiveAudioChainPanel(props: LiveAudioChainPanelProps) {
	const [expanded, setExpanded] = createSignal(props.initiallyExpanded ?? false);

	const cfg = () => props.config;

	return (
		<div class="live-audio-chain-panel panel">
			<button
				class="collapse-header"
				type="button"
				onClick={() => setExpanded(!expanded())}
				aria-expanded={expanded()}
				aria-controls="live-audio-chain-body"
			>
				<span class="panel-title">Live Audio Chain</span>
				<span class="latency-display">Latency: {props.latencyMs.toFixed(1)} ms</span>
			</button>

			<Show when={expanded()}>
				<div class="collapse-body" id="live-audio-chain-body">
					<Show when={!props.crossOriginIsolated}>
						<div class="capability-warning" role="alert">
							Live Audio Chain requires cross-origin isolation.
						</div>
					</Show>

					<Show when={props.crossOriginIsolated}>
						{/* Gate */}
						<AudioInsertRow
							label="Gate"
							bypass={cfg().gate.bypass}
							onToggleBypass={() =>
								props.onConfigChange({
									gate: { ...cfg().gate, bypass: !cfg().gate.bypass }
								})
							}
						>
							<SliderControl
								label="Threshold"
								value={cfg().gate.thresholdDb}
								min={-80}
								max={0}
								step={0.5}
								unit=" dB"
								onChange={(v) => props.onConfigChange({ gate: { ...cfg().gate, thresholdDb: v } })}
							/>
							<SliderControl
								label="Range"
								value={cfg().gate.rangeDb}
								min={-120}
								max={0}
								step={1}
								unit=" dB"
								onChange={(v) => props.onConfigChange({ gate: { ...cfg().gate, rangeDb: v } })}
							/>
							<SliderControl
								label="Attack"
								value={cfg().gate.attackMs}
								min={0.01}
								max={10}
								step={0.01}
								unit=" ms"
								onChange={(v) => props.onConfigChange({ gate: { ...cfg().gate, attackMs: v } })}
							/>
							<SliderControl
								label="Hold"
								value={cfg().gate.holdMs}
								min={0}
								max={500}
								step={1}
								unit=" ms"
								onChange={(v) => props.onConfigChange({ gate: { ...cfg().gate, holdMs: v } })}
							/>
							<SliderControl
								label="Release"
								value={cfg().gate.releaseMs}
								min={1}
								max={1000}
								step={1}
								unit=" ms"
								onChange={(v) => props.onConfigChange({ gate: { ...cfg().gate, releaseMs: v } })}
							/>
						</AudioInsertRow>

						{/* Compressor */}
						<AudioInsertRow
							label="Compressor"
							bypass={cfg().compressor.bypass}
							onToggleBypass={() =>
								props.onConfigChange({
									compressor: { ...cfg().compressor, bypass: !cfg().compressor.bypass }
								})
							}
						>
							<SliderControl
								label="Threshold"
								value={cfg().compressor.thresholdDb}
								min={-60}
								max={0}
								step={0.5}
								unit=" dB"
								onChange={(v) =>
									props.onConfigChange({ compressor: { ...cfg().compressor, thresholdDb: v } })
								}
							/>
							<SliderControl
								label="Ratio"
								value={cfg().compressor.ratio}
								min={1}
								max={20}
								step={0.1}
								unit=":1"
								onChange={(v) =>
									props.onConfigChange({ compressor: { ...cfg().compressor, ratio: v } })
								}
							/>
							<SliderControl
								label="Attack"
								value={cfg().compressor.attackMs}
								min={0.1}
								max={100}
								step={0.1}
								unit=" ms"
								onChange={(v) =>
									props.onConfigChange({ compressor: { ...cfg().compressor, attackMs: v } })
								}
							/>
							<SliderControl
								label="Release"
								value={cfg().compressor.releaseMs}
								min={10}
								max={2000}
								step={1}
								unit=" ms"
								onChange={(v) =>
									props.onConfigChange({ compressor: { ...cfg().compressor, releaseMs: v } })
								}
							/>
							<SliderControl
								label="Knee"
								value={cfg().compressor.kneeDb}
								min={0}
								max={24}
								step={0.5}
								unit=" dB"
								onChange={(v) =>
									props.onConfigChange({ compressor: { ...cfg().compressor, kneeDb: v } })
								}
							/>
							<SliderControl
								label="Makeup Gain"
								value={cfg().compressor.makeupGainDb}
								min={-12}
								max={24}
								step={0.5}
								unit=" dB"
								onChange={(v) =>
									props.onConfigChange({ compressor: { ...cfg().compressor, makeupGainDb: v } })
								}
							/>
						</AudioInsertRow>

						{/* Limiter */}
						<AudioInsertRow
							label="Limiter"
							bypass={cfg().limiter.bypass}
							onToggleBypass={() =>
								props.onConfigChange({
									limiter: { ...cfg().limiter, bypass: !cfg().limiter.bypass }
								})
							}
						>
							<SliderControl
								label="Ceiling"
								value={cfg().limiter.ceilingDb}
								min={-12}
								max={0}
								step={0.1}
								unit=" dB"
								onChange={(v) =>
									props.onConfigChange({ limiter: { ...cfg().limiter, ceilingDb: v } })
								}
							/>
							<SliderControl
								label="Attack"
								value={cfg().limiter.attackUs}
								min={10}
								max={10000}
								step={10}
								unit=" µs"
								onChange={(v) =>
									props.onConfigChange({ limiter: { ...cfg().limiter, attackUs: v } })
								}
							/>
							<SliderControl
								label="Release"
								value={cfg().limiter.releaseMs}
								min={1}
								max={500}
								step={1}
								unit=" ms"
								onChange={(v) =>
									props.onConfigChange({ limiter: { ...cfg().limiter, releaseMs: v } })
								}
							/>
						</AudioInsertRow>

						{/* Print to recording toggle */}
						<Show when={props.isCapturing}>
							<div class="print-toggle">
								<label>
									<input
										type="checkbox"
										checked={cfg().printToRecording}
										onChange={(e) =>
											props.onConfigChange({ printToRecording: e.currentTarget.checked })
										}
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
