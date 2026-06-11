import { createSignal, onCleanup, onMount, Show, For } from 'solid-js';
import type { TransformParamsSnapshot } from '../protocol';
import { computeFitRect } from '../engine/transform';

export interface PreviewGizmoProps {
	transform: TransformParamsSnapshot;
	sourceWidth: number;
	sourceHeight: number;
	outputWidth: number;
	outputHeight: number;
	/** The live preview <canvas> element, whose displayed rect the gizmo tracks. */
	canvasEl: () => HTMLCanvasElement | undefined;
	/** Streams transform updates during a drag (the worker coalesces them). */
	onChange: (transform: Partial<TransformParamsSnapshot>) => void;
}

interface Box {
	left: number;
	top: number;
	width: number;
	height: number;
}

type DragMode = 'move' | 'scale' | 'rotate';

interface DragState {
	mode: DragMode;
	box: Box;
	centerX: number;
	centerY: number;
	start: TransformParamsSnapshot;
	pointerX: number;
	pointerY: number;
	startDist: number;
	startAngle: number;
}

const CORNERS = [
	{ id: 'tl', x: 0, y: 0 },
	{ id: 'tr', x: 1, y: 0 },
	{ id: 'br', x: 1, y: 1 },
	{ id: 'bl', x: 0, y: 1 }
] as const;

/**
 * DOM-overlay drag/resize/rotate handles for the selected clip's transform. No
 * canvas pixel access — it maps pointer deltas in the canvas's displayed rect to
 * normalized transform params and emits `set-transform` updates.
 */
export function PreviewGizmo(props: PreviewGizmoProps) {
	const [box, setBox] = createSignal<Box | null>(null);
	let drag: DragState | null = null;

	function measure() {
		const canvas = props.canvasEl();
		const parent = canvas?.parentElement;
		if (!canvas || !parent) {
			setBox(null);
			return;
		}
		const c = canvas.getBoundingClientRect();
		const p = parent.getBoundingClientRect();
		setBox({ left: c.left - p.left, top: c.top - p.top, width: c.width, height: c.height });
	}

	onMount(() => {
		measure();
		const observer = new ResizeObserver(() => measure());
		const canvas = props.canvasEl();
		if (canvas) observer.observe(canvas);
		window.addEventListener('resize', measure);
		onCleanup(() => {
			observer.disconnect();
			window.removeEventListener('resize', measure);
		});
	});

	// Normalized layer rect (fit size × user scale) within the output.
	function layerRect() {
		const t = props.transform;
		const fit = computeFitRect(
			props.sourceWidth,
			props.sourceHeight,
			props.outputWidth,
			props.outputHeight,
			t.fit
		);
		return { width: fit.width * t.scale, height: fit.height * t.scale };
	}

	// The gizmo box in canvas-display px (un-rotated; CSS rotates the element).
	function gizmoStyle() {
		const b = box();
		if (!b) return null;
		const rect = layerRect();
		const t = props.transform;
		const w = rect.width * b.width;
		const h = rect.height * b.height;
		const cx = (0.5 + t.x) * b.width;
		const cy = (0.5 + t.y) * b.height;
		return {
			left: `${b.left + cx - w / 2}px`,
			top: `${b.top + cy - h / 2}px`,
			width: `${w}px`,
			height: `${h}px`,
			transform: `rotate(${t.rotation}deg)`
		};
	}

	function beginDrag(mode: DragMode, event: PointerEvent) {
		event.preventDefault();
		event.stopPropagation();
		const b = box();
		if (!b) return;
		const canvas = props.canvasEl();
		const parent = canvas?.parentElement;
		if (!parent) return;
		const p = parent.getBoundingClientRect();
		const t = props.transform;
		const centerX = p.left + b.left + (0.5 + t.x) * b.width;
		const centerY = p.top + b.top + (0.5 + t.y) * b.height;
		const dx = event.clientX - centerX;
		const dy = event.clientY - centerY;
		drag = {
			mode,
			box: b,
			centerX,
			centerY,
			start: { ...t },
			pointerX: event.clientX,
			pointerY: event.clientY,
			startDist: Math.hypot(dx, dy) || 1,
			startAngle: Math.atan2(dy, dx)
		};
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', endDrag);
		window.addEventListener('pointercancel', endDrag);
	}

	function onPointerMove(event: PointerEvent) {
		if (!drag) return;
		if (drag.mode === 'move') {
			const dx = (event.clientX - drag.pointerX) / drag.box.width;
			const dy = (event.clientY - drag.pointerY) / drag.box.height;
			props.onChange({ x: drag.start.x + dx, y: drag.start.y + dy });
		} else if (drag.mode === 'scale') {
			const dist = Math.hypot(event.clientX - drag.centerX, event.clientY - drag.centerY);
			const next = Math.max(0.02, (dist / drag.startDist) * drag.start.scale);
			props.onChange({ scale: next });
		} else {
			const angle = Math.atan2(event.clientY - drag.centerY, event.clientX - drag.centerX);
			const deltaDeg = ((angle - drag.startAngle) * 180) / Math.PI;
			props.onChange({ rotation: drag.start.rotation + deltaDeg });
		}
	}

	function endDrag() {
		drag = null;
		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerup', endDrag);
		window.removeEventListener('pointercancel', endDrag);
	}

	// Unmounting mid-drag (e.g. the selected clip is deleted) would otherwise leave
	// the window pointer listeners — and this component — leaked.
	onCleanup(endDrag);

	return (
		<Show when={gizmoStyle()}>
			{(style) => (
				<div class="preview-gizmo" style={style()} aria-hidden="true">
					<div
						class="preview-gizmo-body"
						onPointerDown={(e) => beginDrag('move', e)}
						title="Drag to reposition"
					/>
					<For each={CORNERS}>{(corner) => (
						<div
							class="preview-gizmo-handle"
							style={{ left: `${corner.x * 100}%`, top: `${corner.y * 100}%` }}
							onPointerDown={(e) => beginDrag('scale', e)}
							title="Drag to scale"
						/>
					)}</For>
					<div
						class="preview-gizmo-rotate"
						onPointerDown={(e) => beginDrag('rotate', e)}
						title="Drag to rotate"
					/>
				</div>
			)}
		</Show>
	);
}
