/** Phase 43: Callout style Inspector section.
 *
 *  Renders style controls for the selected callout clip and dispatches
 *  set-callout on change with 80 ms debounce.
 */

import { createSignal, createEffect, Show, onCleanup } from 'solid-js';
import type { CalloutPayload, CalloutStyle } from '../protocol';

interface CalloutInspectorProps {
	trackId: string;
	clipId: string;
	callout: CalloutPayload;
	onSetCallout: (trackId: string, clipId: string, payload: CalloutPayload) => void;
}

const PARAM_DEBOUNCE_MS = 80;

export function CalloutInspector(props: CalloutInspectorProps) {
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	// oxlint-disable-next-line solid/reactivity -- intentional initial seed; createEffect below syncs external changes
	const [localStyle, setLocalStyle] = createSignal<CalloutStyle>({ ...props.callout.style });

	// Sync when external callout changes
	createEffect(() => {
		setLocalStyle({ ...props.callout.style });
	});

	const updateStyle = (patch: Partial<CalloutStyle>) => {
		const next = { ...localStyle(), ...patch };
		setLocalStyle(next);

		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			props.onSetCallout(props.trackId, props.clipId, {
				calloutKind: props.callout.calloutKind,
				geometry: props.callout.geometry,
				style: next
			});
		}, PARAM_DEBOUNCE_MS);
	};

	onCleanup(() => {
		if (debounceTimer) clearTimeout(debounceTimer);
	});

	const kind = () => props.callout.calloutKind;

	return (
		<section class="inspector-section">
			<h3>Callout</h3>

			<div class="callout-style-controls">
				<label>
					Colour
					<input
						type="color"
						value={localStyle().color}
						onInput={(e) => updateStyle({ color: e.currentTarget.value })}
					/>
				</label>

				<label>
					Stroke width
					<input
						type="range"
						min={1}
						max={16}
						step={1}
						value={localStyle().strokeWidth}
						onInput={(e) => updateStyle({ strokeWidth: Number(e.currentTarget.value) })}
					/>
					<span>{localStyle().strokeWidth} px</span>
				</label>

				<Show when={kind() === 'box' || kind() === 'spotlight'}>
					<label>
						Fill opacity
						<input
							type="range"
							min={0}
							max={1}
							step={0.01}
							value={localStyle().fillOpacity}
							onInput={(e) => updateStyle({ fillOpacity: Number(e.currentTarget.value) })}
						/>
						<span>{localStyle().fillOpacity.toFixed(2)}</span>
					</label>
				</Show>

				<Show when={kind() === 'step'}>
					<label>
						Font size
						<input
							type="range"
							min={8}
							max={128}
							step={1}
							value={localStyle().fontSize}
							onInput={(e) => updateStyle({ fontSize: Number(e.currentTarget.value) })}
						/>
						<span>{localStyle().fontSize} px</span>
					</label>
				</Show>

				<Show when={kind() === 'arrow'}>
					<label>
						Arrowhead size
						<input
							type="range"
							min={4}
							max={48}
							step={1}
							value={localStyle().arrowheadSize}
							onInput={(e) => updateStyle({ arrowheadSize: Number(e.currentTarget.value) })}
						/>
						<span>{localStyle().arrowheadSize} px</span>
					</label>
				</Show>

				<Show when={kind() === 'blur'}>
					<label>
						Blur radius
						<input
							type="range"
							min={1}
							max={48}
							step={1}
							value={localStyle().blurRadius}
							onInput={(e) => updateStyle({ blurRadius: Number(e.currentTarget.value) })}
						/>
						<span>{localStyle().blurRadius} px</span>
					</label>
				</Show>

				<Show when={kind() === 'spotlight'}>
					<label>
						Darken strength
						<input
							type="range"
							min={0}
							max={1}
							step={0.01}
							value={localStyle().darkenStrength}
							onInput={(e) => updateStyle({ darkenStrength: Number(e.currentTarget.value) })}
						/>
						<span>{localStyle().darkenStrength.toFixed(2)}</span>
					</label>
				</Show>
			</div>
		</section>
	);
}
