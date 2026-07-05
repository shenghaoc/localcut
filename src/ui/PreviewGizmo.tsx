import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
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
	const [drag, setDrag] = createSignal<DragState | null>(null);

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
		const d = drag();
		// Fixed 100px proxy: scale in local axes (before rotation) keeps handles
		// aligned for non-square, rotated clips. CSS transforms compose right-to-left
		// so `rotate(deg) scaleX(sx) scaleY(sy)` applies scale in the un-rotated frame.
		const centerTranslate = `${b.left + cx - 50}px ${b.top + cy - 50}px`;
		const centeredTransform = `rotate(${t.rotation}deg) scaleX(${w / 100}) scaleY(${h / 100})`;
		return {
			left: '0px',
			top: '0px',
			width: '100px',
			height: '100px',
			translate: centerTranslate,
			'transform-origin': '50% 50%',
			transform: centeredTransform,
			'will-change':
				d?.mode === 'move' || d?.mode === 'scale'
					? 'translate, transform'
					: d?.mode === 'rotate'
						? 'transform'
						: undefined
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
		setDrag({
			mode,
			box: b,
			centerX,
			centerY,
			start: { ...t },
			pointerX: event.clientX,
			pointerY: event.clientY,
			startDist: Math.hypot(dx, dy) || 1,
			startAngle: Math.atan2(dy, dx)
		});
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', endDrag);
		window.addEventListener('pointercancel', endDrag);
	}

	function onPointerMove(event: PointerEvent) {
		const d = drag();
		if (!d) return;
		if (d.mode === 'move') {
			const dx = (event.clientX - d.pointerX) / d.box.width;
			const dy = (event.clientY - d.pointerY) / d.box.height;
			props.onChange({ x: d.start.x + dx, y: d.start.y + dy });
		} else if (d.mode === 'scale') {
			const dist = Math.hypot(event.clientX - d.centerX, event.clientY - d.centerY);
			const next = Math.max(0.02, (dist / d.startDist) * d.start.scale);
			props.onChange({ scale: next });
		} else {
			const angle = Math.atan2(event.clientY - d.centerY, event.clientX - d.centerX);
			const deltaDeg = ((angle - d.startAngle) * 180) / Math.PI;
			props.onChange({ rotation: d.start.rotation + deltaDeg });
		}
	}

	function endDrag() {
		setDrag(null);
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
					<For each={CORNERS}>
						{(corner) => (
							<div
								class="preview-gizmo-handle"
								style={{ left: `${corner.x * 100}%`, top: `${corner.y * 100}%` }}
								onPointerDown={(e) => beginDrag('scale', e)}
								title="Drag to scale"
							/>
						)}
					</For>
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
