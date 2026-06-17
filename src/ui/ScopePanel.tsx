/** Scope diagnostics panel — Phase 21.
 *
 *  Renders histogram, luma waveform, RGB parade, and vectorscope on small
 *  canvases via Canvas2D from a SharedArrayBuffer ring-buffer filled by the
 *  pipeline worker. No getImageData / CPU pixel readback — the worker writes
 *  to the SAB via WebGPU compute; the main thread only paints bins/strokes/
 *  hit-count squares on a 2D canvas.
 */

import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import {
	SCOPE_HISTOGRAM_BINS,
	SCOPE_HISTOGRAM_CHANNELS,
	SCOPE_HISTOGRAM_DATA_FLOATS,
	SCOPE_RES_X,
	SCOPE_VECTORSCOPE_SIZE,
	histogramSlotOffset,
	paradeSlotOffset,
	readScopeResult,
	scopeParadeDataFloats,
	scopeVectorscopeDataFloats,
	scopeWaveformDataFloats,
	vectorscopeSlotOffset,
	waveformSlotOffset
} from '../engine/scopes';

export interface ScopePanelProps {
	/** SAB ring buffer filled by the worker compositor. `null` on tiers without SAB. */
	scopeSab: SharedArrayBuffer | null;
	/** Collapsed state signal (read+write). */
	collapsed: () => boolean;
	setCollapsed: (v: boolean) => void;
}

const HIST_CANVAS_W = 256;
const HIST_CANVAS_H = 128;
const WF_CANVAS_W = SCOPE_RES_X;
const WF_CANVAS_H = 128;
const VEC_CANVAS_SIZE = SCOPE_VECTORSCOPE_SIZE;

export default function ScopePanel(props: ScopePanelProps) {
	const [fullscreenScope, setFullscreenScope] = createSignal<string | null>(null);

	let histCanvas: HTMLCanvasElement | undefined;
	let wfCanvas: HTMLCanvasElement | undefined;
	let paradeCanvas: HTMLCanvasElement | undefined;
	let vecCanvas: HTMLCanvasElement | undefined;

	// Reactive view of the SAB. createMemo so the rAF effect below can track it —
	// a plain let-binding written from one createEffect and read from another
	// breaks SolidJS's dependency graph (the read effect wouldn't re-run on SAB swap).
	const sabView = createMemo(() => {
		const sab = props.scopeSab;
		return sab ? new Float32Array(sab) : null;
	});

	let rafHandle: number | null = null;
	createEffect(() => {
		// Re-arm whenever collapsed state flips or SAB swaps.
		const collapsed = props.collapsed();
		const view = sabView();
		if (rafHandle !== null) {
			cancelAnimationFrame(rafHandle);
			rafHandle = null;
		}
		if (collapsed || !view) return;

		const tick = () => {
			paintFrame(view);
			rafHandle = requestAnimationFrame(tick);
		};
		rafHandle = requestAnimationFrame(tick);
	});

	onCleanup(() => {
		if (rafHandle !== null) cancelAnimationFrame(rafHandle);
		rafHandle = null;
	});

	function paintFrame(view: Float32Array): void {
		if (histCanvas) {
			const r = readScopeResult(view, histogramSlotOffset(), SCOPE_HISTOGRAM_DATA_FLOATS);
			if (r) paintHistogram(histCanvas, r.data);
		}
		if (wfCanvas) {
			const r = readScopeResult(
				view,
				waveformSlotOffset(SCOPE_RES_X),
				scopeWaveformDataFloats(SCOPE_RES_X)
			);
			if (r) paintWaveform(wfCanvas, r.data);
		}
		if (paradeCanvas) {
			const r = readScopeResult(
				view,
				paradeSlotOffset(SCOPE_RES_X),
				scopeParadeDataFloats(SCOPE_RES_X)
			);
			if (r) paintParade(paradeCanvas, r.data);
		}
		if (vecCanvas) {
			const r = readScopeResult(
				view,
				vectorscopeSlotOffset(SCOPE_RES_X),
				scopeVectorscopeDataFloats()
			);
			if (r) paintVectorscope(vecCanvas, r.data);
		}
	}

	return (
		<section
			class="scope-panel"
			classList={{ 'scope-panel--collapsed': props.collapsed() }}
			role="region"
			aria-label="Video scopes"
		>
			<header class="scope-panel__header">
				<button
					class="scope-panel__toggle"
					onClick={() => props.setCollapsed(!props.collapsed())}
					aria-expanded={!props.collapsed()}
				>
					Scopes <span class="text-xs text-muted-foreground font-normal">(Experimental)</span>{' '}
					{props.collapsed() ? '▸' : '▾'}
				</button>
			</header>

			{!props.collapsed() && (
				<div class="scope-panel__grid">
					<ScopeView
						label="Histogram"
						width={HIST_CANVAS_W}
						height={HIST_CANVAS_H}
						fullscreen={fullscreenScope() === 'histogram'}
						onToggleFullscreen={() =>
							setFullscreenScope(fullscreenScope() === 'histogram' ? null : 'histogram')
						}
						ref={(el) => (histCanvas = el)}
					/>
					<ScopeView
						label="Waveform"
						width={WF_CANVAS_W}
						height={WF_CANVAS_H}
						fullscreen={fullscreenScope() === 'waveform'}
						onToggleFullscreen={() =>
							setFullscreenScope(fullscreenScope() === 'waveform' ? null : 'waveform')
						}
						ref={(el) => (wfCanvas = el)}
					/>
					<ScopeView
						label="Parade"
						width={WF_CANVAS_W}
						height={WF_CANVAS_H}
						fullscreen={fullscreenScope() === 'parade'}
						onToggleFullscreen={() =>
							setFullscreenScope(fullscreenScope() === 'parade' ? null : 'parade')
						}
						ref={(el) => (paradeCanvas = el)}
					/>
					<ScopeView
						label="Vectorscope"
						width={VEC_CANVAS_SIZE}
						height={VEC_CANVAS_SIZE}
						fullscreen={fullscreenScope() === 'vectorscope'}
						onToggleFullscreen={() =>
							setFullscreenScope(fullscreenScope() === 'vectorscope' ? null : 'vectorscope')
						}
						ref={(el) => (vecCanvas = el)}
					/>
				</div>
			)}
		</section>
	);
}

interface ScopeViewProps {
	label: string;
	width: number;
	height: number;
	fullscreen: boolean;
	onToggleFullscreen: () => void;
	ref: (el: HTMLCanvasElement) => void;
}

function ScopeView(props: ScopeViewProps) {
	return (
		<div class="scope-view" classList={{ 'scope-view--fullscreen': props.fullscreen }}>
			<div class="scope-view__header">
				<span class="scope-view__label">{props.label}</span>
				<button
					class="scope-view__fullscreen-btn"
					onClick={() => props.onToggleFullscreen()}
					aria-label={`Toggle ${props.label} fullscreen`}
				>
					⛶
				</button>
			</div>
			<canvas
				ref={props.ref}
				class="scope-view__canvas"
				width={props.width}
				height={props.height}
			/>
		</div>
	);
}

// ─── Canvas2D paint routines ───────────────────────────────────────────
//
// Data comes from the worker as raw u32 counts converted to f32 (histogram +
// vectorscope) or as 16-bit-quantized min/max columns dequantized to 0..1
// (waveform/parade). The paint passes never touch the source frame; they only
// translate already-summarized scope data into bars/strokes/squares.

function paintHistogram(canvas: HTMLCanvasElement, data: Float32Array): void {
	const ctx = canvas.getContext('2d');
	if (!ctx) return;
	const w = canvas.width;
	const h = canvas.height;
	ctx.fillStyle = '#000';
	ctx.fillRect(0, 0, w, h);

	// data layout: [R bins…][G bins…][B bins…][Y bins…], each SCOPE_HISTOGRAM_BINS long.
	const bins = SCOPE_HISTOGRAM_BINS;
	const channels = SCOPE_HISTOGRAM_CHANNELS;
	let peak = 0;
	for (let i = 0; i < bins * channels; i++) {
		const v = data[i] ?? 0;
		if (v > peak) peak = v;
	}
	if (peak <= 0) return;

	const colours = ['rgba(220,60,60,0.7)', 'rgba(60,200,80,0.7)', 'rgba(80,120,230,0.7)'];
	const binW = w / bins;
	for (let c = 0; c < 3; c++) {
		ctx.fillStyle = colours[c]!;
		const off = c * bins;
		for (let b = 0; b < bins; b++) {
			const v = data[off + b] ?? 0;
			const barH = (v / peak) * h;
			ctx.fillRect(b * binW, h - barH, Math.max(1, binW), barH);
		}
	}
	// Luma overlaid as a thin line on top.
	const yOff = 3 * bins;
	ctx.strokeStyle = 'rgba(240,240,240,0.85)';
	ctx.lineWidth = 1;
	ctx.beginPath();
	for (let b = 0; b < bins; b++) {
		const v = data[yOff + b] ?? 0;
		const y = h - (v / peak) * h;
		const x = b * binW + binW * 0.5;
		if (b === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	}
	ctx.stroke();
}

function paintWaveform(canvas: HTMLCanvasElement, data: Float32Array): void {
	const ctx = canvas.getContext('2d');
	if (!ctx) return;
	const w = canvas.width;
	const h = canvas.height;
	ctx.fillStyle = '#000';
	ctx.fillRect(0, 0, w, h);
	// Reference lines at 0%, 50%, 100%.
	ctx.strokeStyle = 'rgba(255,255,255,0.12)';
	ctx.beginPath();
	for (const frac of [0, 0.5, 1]) {
		const y = h - frac * h;
		ctx.moveTo(0, y);
		ctx.lineTo(w, y);
	}
	ctx.stroke();

	// Layout: pairs (min, max) per column, X columns total.
	const X = SCOPE_RES_X;
	const colW = w / X;
	ctx.strokeStyle = 'rgba(180,255,180,0.85)';
	ctx.lineWidth = Math.max(1, colW);
	ctx.beginPath();
	for (let i = 0; i < X; i++) {
		const min = data[i * 2] ?? 0;
		const max = data[i * 2 + 1] ?? 0;
		const x = (i + 0.5) * colW;
		const yMin = h - min * h;
		const yMax = h - max * h;
		ctx.moveTo(x, yMin);
		ctx.lineTo(x, yMax);
	}
	ctx.stroke();
}

function paintParade(canvas: HTMLCanvasElement, data: Float32Array): void {
	const ctx = canvas.getContext('2d');
	if (!ctx) return;
	const w = canvas.width;
	const h = canvas.height;
	ctx.fillStyle = '#000';
	ctx.fillRect(0, 0, w, h);

	// Three side-by-side panels: R, G, B. Each is X columns × h tall.
	const X = SCOPE_RES_X;
	const panelW = w / 3;
	const colW = panelW / X;
	const channelColours = ['rgba(220,90,90,0.85)', 'rgba(90,220,110,0.85)', 'rgba(110,140,235,0.85)'];

	for (let c = 0; c < 3; c++) {
		const baseOff = c * X * 2; // Each channel: X pairs of (min, max).
		const xOffset = c * panelW;
		ctx.strokeStyle = channelColours[c]!;
		ctx.lineWidth = Math.max(1, colW);
		ctx.beginPath();
		for (let i = 0; i < X; i++) {
			const min = data[baseOff + i * 2] ?? 0;
			const max = data[baseOff + i * 2 + 1] ?? 0;
			const x = xOffset + (i + 0.5) * colW;
			const yMin = h - min * h;
			const yMax = h - max * h;
			ctx.moveTo(x, yMin);
			ctx.lineTo(x, yMax);
		}
		ctx.stroke();

		// Faint divider between panels.
		if (c < 2) {
			ctx.strokeStyle = 'rgba(255,255,255,0.15)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(xOffset + panelW, 0);
			ctx.lineTo(xOffset + panelW, h);
			ctx.stroke();
		}
	}
}

// Reused 128×128 RGBA8 buffer for the vectorscope paint. Allocating a fresh
// ImageData at frame rate would churn the GC; we own the underlying ArrayBuffer
// for the panel's lifetime instead.
const vectorscopePixels = new Uint8ClampedArray(
	SCOPE_VECTORSCOPE_SIZE * SCOPE_VECTORSCOPE_SIZE * 4
);

function paintVectorscope(canvas: HTMLCanvasElement, data: Float32Array): void {
	const ctx = canvas.getContext('2d');
	if (!ctx) return;
	const size = SCOPE_VECTORSCOPE_SIZE;
	const w = canvas.width;
	const h = canvas.height;
	ctx.fillStyle = '#000';
	ctx.fillRect(0, 0, w, h);

	// Find peak for normalization (typical scope is bright skin-tone clusters).
	let peak = 0;
	for (let i = 0; i < data.length; i++) {
		const v = data[i] ?? 0;
		if (v > peak) peak = v;
	}
	if (peak > 0) {
		// 16,384 cells filled via per-pixel ImageData rather than per-cell fillRect:
		// one putImageData call replaces N fillRect calls.
		const px = vectorscopePixels;
		px.fill(0);
		const invLog = 1 / Math.log(peak + 1);
		for (let y = 0; y < size; y++) {
			// Flip vertically: GPU bin y=0 is bottom, canvas y=0 is top.
			const dstRow = (size - 1 - y) * size;
			const srcRow = y * size;
			for (let x = 0; x < size; x++) {
				const v = data[srcRow + x] ?? 0;
				if (v <= 0) continue;
				const a = Math.log(v + 1) * invLog;
				const idx = (dstRow + x) * 4;
				px[idx] = 180;
				px[idx + 1] = 220;
				px[idx + 2] = 255;
				px[idx + 3] = Math.round(a * 255);
			}
		}
		// Canvas is fixed to SCOPE_VECTORSCOPE_SIZE × SCOPE_VECTORSCOPE_SIZE (1:1
		// with the GPU hit-count grid), so a single putImageData paints the whole
		// scope. Any future upsampling should drawImage from an offscreen buffer.
		ctx.putImageData(new ImageData(px, size, size), 0, 0);
	}

	// Crosshair reference at the center (neutral grey lands here).
	ctx.strokeStyle = 'rgba(255,255,255,0.15)';
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(w * 0.5, 0);
	ctx.lineTo(w * 0.5, h);
	ctx.moveTo(0, h * 0.5);
	ctx.lineTo(w, h * 0.5);
	ctx.stroke();
}
