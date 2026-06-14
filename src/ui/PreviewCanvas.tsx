import { onMount } from 'solid-js';

interface PreviewCanvasProps {
	onOffscreenReady: (canvas: OffscreenCanvas) => void;
	/** Exposes the live <canvas> element so an overlay (e.g. the transform gizmo)
	 *  can measure its displayed rect. */
	onCanvasEl?: (canvas: HTMLCanvasElement) => void;
}

export function PreviewCanvas(props: PreviewCanvasProps) {
	// eslint-disable-next-line eslint/no-unassigned-vars — SolidJS ref assigns via JSX
	let canvasEl: HTMLCanvasElement | undefined;

	onMount(() => {
		if (!canvasEl) return;
		props.onCanvasEl?.(canvasEl);
		const offscreen = canvasEl.transferControlToOffscreen();
		props.onOffscreenReady(offscreen);
	});

	return (
		<canvas
			ref={canvasEl}
			class="preview-canvas"
			width={1280}
			height={720}
			aria-label="Video preview"
		/>
	);
}
