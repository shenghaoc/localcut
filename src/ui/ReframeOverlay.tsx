/**
 * Reframe overlay (Phase 33) — CSS overlay on the programme monitor showing
 * the proposed crop rectangle and action-safe zone at the current playhead.
 * Pure CSS positioning — no GPU passes, no Canvas2D readback (R7.4).
 */

import { createMemo, Show, type Component } from 'solid-js';
import type { ClipKeyframesSnapshot } from '../protocol';
import { sampleKeyframes } from './keyframes';
import { computeReframeScale } from '../engine/reframe/keyframe-generator';

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export interface ReframeOverlayProps {
	/** Whether the overlay is visible (between analysis and apply/discard). */
	visible: boolean;
	/** The generated keyframes to preview. */
	keyframes: ClipKeyframesSnapshot | null;
	/** Current playhead time in clip-local seconds. */
	currentTime: number;
	/** Source aspect ratio (width / height). */
	sourceAspect: number;
	/** Target aspect ratio value (e.g. 9/16). */
	targetAspect: number;
}

/**
 * Compute the proposed crop rectangle (CSS percentages of the un-reframed
 * source preview) at the current playhead. The target-aspect viewport covers a
 * fraction `1/rectW × 1/rectH` of the source, where `rectW`/`rectH` are the
 * `fit: 'fill'` rect dimensions (the cropped axis carries the fill-crop factor,
 * the other is 1), shrunk by any extra `scale` zoom. Its centre is where the
 * compositor samples the output centre — `0.5 − x/rectW` — so this overlay
 * matches what the rendered/exported frame will show (the `x` keyframes already
 * fold in `rectW`; see the keyframe generator).
 */
function computeCropRect(
	keyframes: ClipKeyframesSnapshot,
	currentTime: number,
	sourceAspect: number,
	targetAspect: number
): { left: number; top: number; width: number; height: number } {
	const x = sampleKeyframes(keyframes.x, currentTime, 0);
	const y = sampleKeyframes(keyframes.y, currentTime, 0);
	const scale = Math.max(1, sampleKeyframes(keyframes.scale, currentTime, 1));

	const fillCrop = computeReframeScale(sourceAspect, targetAspect); // ≥ 1
	const rectW = sourceAspect >= targetAspect ? fillCrop : 1;
	const rectH = sourceAspect >= targetAspect ? 1 : fillCrop;
	const cropW = Math.min(1, 1 / rectW / scale);
	const cropH = Math.min(1, 1 / rectH / scale);

	const centreX = clamp(0.5 - x / rectW, cropW / 2, 1 - cropW / 2);
	const centreY = clamp(0.5 - y / rectH, cropH / 2, 1 - cropH / 2);

	return {
		left: (centreX - cropW / 2) * 100,
		top: (centreY - cropH / 2) * 100,
		width: cropW * 100,
		height: cropH * 100
	};
}

export const ReframeOverlay: Component<ReframeOverlayProps> = (props) => {
	const cropRect = createMemo(() => {
		if (!props.keyframes) return null;
		return computeCropRect(
			props.keyframes,
			props.currentTime,
			props.sourceAspect,
			props.targetAspect
		);
	});

	const safeZoneStyle = createMemo(() => {
		// Action-safe zone: 90% of output, centered
		const margin = 5; // (100 - 90) / 2
		return {
			left: `${margin}%`,
			top: `${margin}%`,
			width: '90%',
			height: '90%'
		};
	});

	return (
		<Show when={props.visible && cropRect()}>
			<div
				class="reframe-overlay"
				aria-hidden="true"
				style={{
					position: 'absolute',
					inset: '0',
					'pointer-events': 'none',
					'z-index': '10'
				}}
			>
				{/* Hardware-accelerated positioning: a full-size wrapper (inset: 0) makes the
				    percentage translate values resolve to the same pixels as left/top on the
				    container. CSS `translate` always resolves percentages against the element's
				    own size, but because the wrapper is the same size as the container the offset
				    is identical — and translate skips layout entirely, composited by the GPU,
				    avoiding main-thread layout thrashing when X/Y animate during playback. */}
				<div
					class="reframe-crop-wrapper"
					style={{
						position: 'absolute',
						inset: '0',
						translate: `${cropRect()!.left}% ${cropRect()!.top}%`,
						'will-change': 'translate'
					}}
				>
					{/* Semi-transparent crop rectangle */}
					<div
						class="reframe-crop-rect"
						style={{
							position: 'absolute',
							left: '0',
							top: '0',
							width: `${cropRect()!.width}%`,
							height: `${cropRect()!.height}%`,
							border: '2px solid rgba(74, 144, 226, 0.8)',
							'box-shadow': '0 0 0 9999px rgba(0, 0, 0, 0.4)',
							'border-radius': '2px'
						}}
					>
						{/* Action-safe zone (dashed inner rectangle) */}
						<div
							class="reframe-safe-zone"
							style={{
								position: 'absolute',
								left: `${safeZoneStyle().left}`,
								top: `${safeZoneStyle().top}`,
								width: `${safeZoneStyle().width}`,
								height: `${safeZoneStyle().height}`,
								border: '1px dashed rgba(255, 255, 255, 0.5)',
								'border-radius': '1px'
							}}
						/>
					</div>
				</div>
			</div>
		</Show>
	);
};
