/** Phase 43: Zoom-n-Pan preset panel for the clip Inspector.
 *
 *  Offers named presets as one-click starting points that write real P15
 *  transform keyframes via the existing set-keyframes command.
 */

import { createSignal, Show, For } from 'solid-js';
import type { ClipKeyframesSnapshot } from '../protocol';

interface ZoomPreset {
	id: string;
	label: string;
	scale: number;
	x: number;
	y: number;
}

const PRESETS: ZoomPreset[] = [
	{ id: 'zoom-in-centre', label: 'Zoom In (Centre)', scale: 1.6, x: 0, y: 0 },
	{ id: 'zoom-in-region', label: 'Zoom In (Region)', scale: 1.6, x: 0, y: 0 },
	{ id: 'zoom-out', label: 'Zoom Out', scale: 1, x: 0, y: 0 },
	{ id: 'pan-left-right', label: 'Pan L→R', scale: 1.6, x: -0.2, y: 0 },
	{ id: 'pan-right-left', label: 'Pan R→L', scale: 1.6, x: 0.2, y: 0 }
];

interface ZoomPresetPanelProps {
	trackId: string;
	clipId: string;
	hasExistingKeyframes: boolean;
	onPickRegion?: (onPick: (x: number, y: number) => void) => void;
	onSetKeyframes: (trackId: string, clipId: string, keyframes: ClipKeyframesSnapshot) => void;
}

export function ZoomPresetPanel(props: ZoomPresetPanelProps) {
	const [scale, setScale] = createSignal(1.6);
	const [x, setX] = createSignal(0);
	const [y, setY] = createSignal(0);
	const [entryRampMs, setEntryRampMs] = createSignal(400);
	const [holdMs, setHoldMs] = createSignal(1500);
	const [exitRampMs, setExitRampMs] = createSignal(400);
	const [showWarning, setShowWarning] = createSignal(false);

	const applyPreset = (preset: ZoomPreset) => {
		setScale(preset.scale);
		setX(preset.x);
		setY(preset.y);
		if (preset.id === 'zoom-in-region') {
			props.onPickRegion?.((nx, ny) => {
				setX(nx - 0.5);
				setY(ny - 0.5);
			});
		}
	};

	const handleApply = () => {
		if (props.hasExistingKeyframes && !showWarning()) {
			setShowWarning(true);
			return;
		}
		setShowWarning(false);

		const entryS = entryRampMs() / 1000;
		const holdS = holdMs() / 1000;
		const exitS = exitRampMs() / 1000;

		// Build keyframe tracks: entry-start, entry-end, hold, exit-start, exit-end
		const keyframes: ClipKeyframesSnapshot = {
			scale: [
				{ t: 0, value: 1, easing: 'ease' },
				{ t: entryS, value: scale(), easing: 'linear' },
				{ t: entryS + holdS, value: scale(), easing: 'ease' },
				{ t: entryS + holdS + exitS, value: 1, easing: 'linear' }
			],
			x: [
				{ t: 0, value: 0, easing: 'ease' },
				{ t: entryS, value: x(), easing: 'linear' },
				{ t: entryS + holdS, value: x(), easing: 'ease' },
				{ t: entryS + holdS + exitS, value: 0, easing: 'linear' }
			],
			y: [
				{ t: 0, value: 0, easing: 'ease' },
				{ t: entryS, value: y(), easing: 'linear' },
				{ t: entryS + holdS, value: y(), easing: 'ease' },
				{ t: entryS + holdS + exitS, value: 0, easing: 'linear' }
			]
		};

		props.onSetKeyframes(props.trackId, props.clipId, keyframes);
	};

	return (
		<section class="inspector-section">
			<h3>Zoom-n-Pan</h3>

			<div class="preset-buttons">
				<For each={PRESETS}>
					{(preset) => (
						<button
							type="button"
							class="preset-btn"
							onClick={() => applyPreset(preset)}
							title={preset.label}
						>
							{preset.label}
						</button>
					)}
				</For>
			</div>

			<div class="preset-params">
				<label>
					Scale
					<input
						type="number"
						value={scale()}
						onInput={(e) => setScale(Number(e.currentTarget.value))}
						min={0.1}
						max={3}
						step={0.1}
					/>
				</label>
				<label>
					X
					<input
						type="number"
						value={x()}
						onInput={(e) => setX(Number(e.currentTarget.value))}
						min={-1}
						max={1}
						step={0.01}
					/>
				</label>
				<label>
					Y
					<input
						type="number"
						value={y()}
						onInput={(e) => setY(Number(e.currentTarget.value))}
						min={-1}
						max={1}
						step={0.01}
					/>
				</label>
				<label>
					Entry (ms)
					<input
						type="number"
						value={entryRampMs()}
						onInput={(e) => setEntryRampMs(Number(e.currentTarget.value))}
						min={50}
						max={5000}
						step={50}
					/>
				</label>
				<label>
					Hold (ms)
					<input
						type="number"
						value={holdMs()}
						onInput={(e) => setHoldMs(Number(e.currentTarget.value))}
						min={0}
						max={30000}
						step={100}
					/>
				</label>
				<label>
					Exit (ms)
					<input
						type="number"
						value={exitRampMs()}
						onInput={(e) => setExitRampMs(Number(e.currentTarget.value))}
						min={50}
						max={5000}
						step={50}
					/>
				</label>
			</div>

			<Show when={showWarning()}>
				<div class="warning-dialog" role="alertdialog">
					<p>
						Existing keyframes will be merged — existing values outside this range are preserved.
					</p>
					<button type="button" onClick={handleApply}>
						Confirm
					</button>
					<button type="button" onClick={() => setShowWarning(false)}>
						Cancel
					</button>
				</div>
			</Show>

			<button type="button" class="apply-btn" onClick={handleApply}>
				Apply
			</button>
		</section>
	);
}
