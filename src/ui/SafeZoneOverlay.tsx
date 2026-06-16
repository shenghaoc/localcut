import { For, type JSX } from 'solid-js';
import type { SafeZonePlatform } from '../engine/safe-zones';

interface SafeZoneOverlayProps {
	platform: SafeZonePlatform | null;
	outputWidth: number;
	outputHeight: number;
}

export function SafeZoneOverlay(props: SafeZoneOverlayProps): JSX.Element {
	return (
		<div
			class="safe-zone-overlay"
			aria-hidden={props.platform ? 'false' : 'true'}
			style={{ 'aspect-ratio': `${props.outputWidth} / ${props.outputHeight}` }}
		>
			<For each={props.platform?.zones ?? []}>
				{(zone) => (
					<div
						class={zone.kind === 'occluded' ? 'safe-zone-rect-occluded' : 'safe-zone-rect-caution'}
						aria-label={zone.label}
						title={zone.label}
						style={{
							left: `${zone.rect.x * 100}%`,
							top: `${zone.rect.y * 100}%`,
							width: `${zone.rect.w * 100}%`,
							height: `${zone.rect.h * 100}%`
						}}
					/>
				)}
			</For>
		</div>
	);
}
