import { createEffect, onMount } from 'solid-js';
import type { WaveformPeaks } from '../protocol';

interface WaveformProps {
	peaks: WaveformPeaks | null;
	width: number;
	height: number;
}

/** Paints min/max peak buckets on an audio-lane canvas. */
export function Waveform(props: WaveformProps) {
	// eslint-disable-next-line eslint/no-unassigned-vars — SolidJS ref assigns via JSX
	let canvas: HTMLCanvasElement | undefined;

	function paint() {
		const el = canvas;
		if (!el) return;
		const ctx = el.getContext('2d');
		if (!ctx) return;
		const w = Math.max(1, props.width);
		const h = Math.max(1, props.height);
		el.width = w;
		el.height = h;
		ctx.clearRect(0, 0, w, h);

		const peaks = props.peaks;
		if (!peaks || peaks.length < 2) return;

		const buckets = peaks.length / 2;
		const mid = h / 2;
		ctx.fillStyle = 'rgba(91, 141, 239, 0.85)';
		for (let i = 0; i < buckets; i += 1) {
			const min = peaks[i * 2] ?? 0;
			const max = peaks[i * 2 + 1] ?? 0;
			const x = (i / buckets) * w;
			const barW = Math.max(1, w / buckets);
			const y0 = mid - max * mid;
			const y1 = mid - min * mid;
			ctx.fillRect(x, y0, barW, Math.max(1, y1 - y0));
		}
	}

	onMount(paint);
	createEffect(paint);

	return (
		<canvas
			ref={canvas}
			class="waveform-canvas"
			style={{ width: `${props.width}px`, height: `${props.height}px` }}
			aria-hidden="true"
		/>
	);
}
