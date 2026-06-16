/** Phase 43: Callout tool — toolbar button + placement overlay.
 *
 *  When active, shows a floating kind picker and switches the preview to a
 *  drag-to-place mode. On release, dispatches add-callout.
 */

import { createSignal, Show, For } from 'solid-js';
import type { CalloutKind, CalloutPayload, CalloutGeometry } from '../protocol';

const CALLOUT_KINDS: { kind: CalloutKind; label: string }[] = [
	{ kind: 'arrow', label: 'Arrow' },
	{ kind: 'box', label: 'Box' },
	{ kind: 'step', label: 'Step' },
	{ kind: 'spotlight', label: 'Spotlight' },
	{ kind: 'blur', label: 'Blur' }
];

interface CalloutToolProps {
	active: boolean;
	capabilityTier: string;
	onActivate: () => void;
	onDeactivate: () => void;
	onAddCallout: (payload: CalloutPayload) => void;
}

export function CalloutTool(props: CalloutToolProps) {
	const [selectedKind, setSelectedKind] = createSignal<CalloutKind>('arrow');
	const [showPicker, setShowPicker] = createSignal(false);

	const isDisabled = () => props.capabilityTier !== 'core-webgpu';

	const handleToolbarClick = () => {
		if (isDisabled()) return;
		if (props.active) {
			props.onDeactivate();
			setShowPicker(false);
		} else {
			props.onActivate();
			setShowPicker(true);
		}
	};

	const handleKindSelect = (kind: CalloutKind) => {
		setSelectedKind(kind);
		setShowPicker(false);
	};

	const handlePlacementComplete = (geometry: CalloutGeometry) => {
		const payload: CalloutPayload = {
			calloutKind: selectedKind(),
			geometry,
			style: {
				color: '#FFD700',
				strokeWidth: 3,
				fillOpacity: selectedKind() === 'spotlight' ? 0.15 : 0,
				fontSize: 28,
				arrowheadSize: 14,
				blurRadius: 12,
				darkenStrength: 0.7
			}
		};
		props.onAddCallout(payload);
		props.onDeactivate();
	};

	return (
		<div class="callout-tool">
			<button
				type="button"
				class={`toolbar-btn ${props.active ? 'toolbar-btn--active' : ''}`}
				onClick={handleToolbarClick}
				disabled={isDisabled()}
				title={isDisabled() ? 'Requires WebGPU (accelerated tier)' : 'Callout tool'}
				aria-label="Callout tool"
			>
				{/* Callout icon placeholder */}
				<svg
					viewBox="0 0 24 24"
					width="18"
					height="18"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M12 2L2 22h20L12 2z" />
				</svg>
			</button>

			<Show when={showPicker()}>
				<div
					class="callout-kind-picker"
					role="listbox"
					aria-label="Select callout kind"
					onKeyDown={(e) => {
						if (e.key === 'Escape') {
							setShowPicker(false);
							props.onDeactivate();
						}
					}}
				>
					<For each={CALLOUT_KINDS}>
						{(item) => (
							<button
								type="button"
								role="option"
								aria-selected={selectedKind() === item.kind}
								class={`kind-option ${selectedKind() === item.kind ? 'kind-option--selected' : ''}`}
								onClick={() => handleKindSelect(item.kind)}
							>
								{item.label}
							</button>
						)}
					</For>
				</div>
			</Show>

			<Show when={props.active && !showPicker()}>
				<div
					class="callout-placement-overlay"
					role="application"
					aria-label="Draw callout"
					onKeyDown={(e) => {
						if (e.key === 'Escape') props.onDeactivate();
					}}
					onPointerDown={(e) => {
						const target = e.currentTarget as HTMLElement;
						const rect = target.getBoundingClientRect();
						const startX = (e.clientX - rect.left) / rect.width;
						const startY = (e.clientY - rect.top) / rect.height;

						const onPointerUp = (upEvent: PointerEvent) => {
							const endX = Math.max(0, Math.min(1, (upEvent.clientX - rect.left) / rect.width));
							const endY = Math.max(0, Math.min(1, (upEvent.clientY - rect.top) / rect.height));

							const kind = selectedKind();
							let geometry: CalloutGeometry;

							if (kind === 'arrow') {
								geometry = { kind: 'arrow', x1: startX, y1: startY, x2: endX, y2: endY };
							} else if (kind === 'box') {
								geometry = {
									kind: 'box',
									x: Math.min(startX, endX),
									y: Math.min(startY, endY),
									w: Math.abs(endX - startX),
									h: Math.abs(endY - startY)
								};
							} else if (kind === 'step') {
								geometry = { kind: 'step', cx: startX, cy: startY, r: 0.05, number: 1 };
							} else {
								geometry = { kind } as CalloutGeometry;
							}

							handlePlacementComplete(geometry);
							target.removeEventListener('pointerup', onPointerUp);
						};

						target.addEventListener('pointerup', onPointerUp);
					}}
				>
					<p>Drag to place {selectedKind()} callout. Press Escape to cancel.</p>
				</div>
			</Show>
		</div>
	);
}
