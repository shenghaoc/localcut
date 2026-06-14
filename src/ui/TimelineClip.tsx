import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { clamp } from '../lib/math';
import { type TimelineClipSnapshot as ProtocolTimelineClip, type WaveformPeaks } from '../protocol';
import { resolveSnap, timelineTimeAtClientX, type SnapTarget } from './timeline-interaction';
import type { ThumbnailEntry } from './thumbnail-store';
import { Waveform } from './Waveform';

interface TimelineClipProps {
	trackId: string;
	clip: ProtocolTimelineClip;
	pxPerSecond: number;
	snapEnabled: boolean;
	snapTargets: readonly SnapTarget[];
	playheadTime?: number;
	onMove?: (trackId: string, clipId: string, toStart: number, fromStart: number) => void;
	onSplit?: (trackId: string, clipId: string, time: number) => void;
	onDelete?: (trackId: string, clipId: string) => void;
	onTrim?: (trackId: string, clipId: string, edge: 'in' | 'out', time: number) => void;
	selected?: boolean;
	onSelect?: (additive: boolean, exclusive: boolean) => void;
	peaks?: WaveformPeaks | null;
	isAudio?: boolean;
	getThumbnail?: (sourceId: string, timestamp: number) => ThumbnailEntry | null;
	thumbnailVersion?: () => number;
	requestThumbnails?: (sourceId: string, timestamps: number[]) => void;
}

const EDGE_HANDLE_PX = 10;
const TRIM_DEBOUNCE_MS = 60;
const SNAP_THRESHOLD_PX = 8;
const FILMSTRIP_TILE_PX = 88;
const FILMSTRIP_MAX_TILES = 16;
const FILMSTRIP_HEIGHT = 34;

/** Source timestamps sampled across a video clip for its filmstrip tiles. */
function filmstripTimestamps(clip: ProtocolTimelineClip, tileCount: number): number[] {
	const times: number[] = [];
	for (let i = 0; i < tileCount; i += 1) {
		times.push(clip.inPoint + ((i + 0.5) / tileCount) * clip.duration);
	}
	return times;
}

/**
 * Maps a pointer x-coordinate against the *track surface* (not the clip) into a
 * timeline time. Track-relative drags let the user pull the in/out edge past
 * the clip's current bounds to extend it back out; the worker validates the
 * result against source-media bounds.
 */
function trackTimeAt(
	clientX: number,
	trackRect: DOMRect,
	pxPerSecond: number,
	snapEnabled: boolean,
	snapTargets: readonly SnapTarget[],
	playheadTime?: number
): number | null {
	const time = timelineTimeAtClientX(clientX, trackRect.left, pxPerSecond);
	if (time === null) return null;
	return snapEnabled
		? resolveSnap(time, pxPerSecond, snapTargets, SNAP_THRESHOLD_PX, playheadTime).time
		: time;
}

/** Clip block renderer from mirrored timeline data. */
export function TimelineClip(props: TimelineClipProps) {
	// Derived accessors (not one-shot values): a SolidJS component body runs once,
	// so reading props.* here directly would freeze position/size at first render and
	// never reflect a move/trim/duration change. Evaluate inside the tracking context.
	const [dragPreviewStart, setDragPreviewStart] = createSignal<number | null>(null);
	// Position via the standalone CSS `translate` property rather than `left`
	// (avoids per-pointermove reflows) or `transform` (an inline transform would
	// override the .timeline-clip:hover lift and get eased by the base class's
	// `transition: transform`, making drags lag the cursor).
	const translate = () => `${(dragPreviewStart() ?? props.clip.start) * props.pxPerSecond}px 0`;
	const width = () => `${Math.max(10, props.clip.duration * props.pxPerSecond)}px`;
	const waveformWidth = () => Math.max(24, Math.floor(props.clip.duration * props.pxPerSecond));
	const clipTitle = () => `${props.clip.id} (${props.clip.sourceId})`;
	let trimDebounce: ReturnType<typeof setTimeout> | null = null;
	let pendingTrimTime = props.clip.start;
	let activeTrimEdge: 'in' | 'out' | null = null;
	let cleanupPointerListeners: (() => void) | null = null;
	let filmstripCanvas: HTMLCanvasElement | undefined;
	let thumbRequestTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingThumbRequest: number[] | null = null;

	function clearPointerListeners() {
		cleanupPointerListeners?.();
		cleanupPointerListeners = null;
	}

	onCleanup(clearPointerListeners);
	onCleanup(() => {
		if (thumbRequestTimer) clearTimeout(thumbRequestTimer);
		// A trim debounce in flight when the clip unmounts (e.g. mid-drag delete)
		// would otherwise fire against a gone component.
		if (trimDebounce) clearTimeout(trimDebounce);
	});

	// Filmstrip: sample thumbnails across a video clip, requesting any that are
	// missing and drawing the rest. Re-runs on zoom/trim (width changes the tile
	// sampling) and when a transferred bitmap lands (thumbnailVersion bumps).
	createEffect(() => {
		if (props.isAudio || !props.getThumbnail || !props.requestThumbnails) return;
		props.thumbnailVersion?.();
		const canvas = filmstripCanvas;
		if (!canvas) return;
		const width = Math.max(1, Math.floor(props.clip.duration * props.pxPerSecond));
		const tileCount = Math.min(
			FILMSTRIP_MAX_TILES,
			Math.max(1, Math.floor(width / FILMSTRIP_TILE_PX))
		);
		const times = filmstripTimestamps(props.clip, tileCount);
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== FILMSTRIP_HEIGHT) canvas.height = FILMSTRIP_HEIGHT;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, width, FILMSTRIP_HEIGHT);

		const tileW = width / tileCount;
		const missing: number[] = [];
		for (let i = 0; i < tileCount; i += 1) {
			const entry = props.getThumbnail(props.clip.sourceId, times[i]!);
			if (!entry) {
				missing.push(times[i]!);
				continue;
			}
			const scale = Math.max(tileW / entry.width, FILMSTRIP_HEIGHT / entry.height);
			const dw = entry.width * scale;
			const dh = entry.height * scale;
			ctx.save();
			ctx.beginPath();
			ctx.rect(i * tileW, 0, tileW, FILMSTRIP_HEIGHT);
			ctx.clip();
			ctx.drawImage(
				entry.bitmap,
				i * tileW + (tileW - dw) / 2,
				(FILMSTRIP_HEIGHT - dh) / 2,
				dw,
				dh
			);
			ctx.restore();
		}
		// Draw available tiles immediately, but debounce the worker requests: a live
		// zoom/trim shifts the sampled timestamps every frame, which would otherwise
		// flood the worker queue with timestamps abandoned on the next frame.
		if (missing.length > 0) {
			const sourceId = props.clip.sourceId;
			pendingThumbRequest = missing;
			if (thumbRequestTimer) clearTimeout(thumbRequestTimer);
			thumbRequestTimer = setTimeout(() => {
				thumbRequestTimer = null;
				const times = pendingThumbRequest;
				pendingThumbRequest = null;
				if (times) props.requestThumbnails?.(sourceId, times);
			}, 140);
		}
	});

	function scheduleTrim(clientX: number, trackRect: DOMRect) {
		if (!activeTrimEdge || !props.onTrim) return;
		const time = trackTimeAt(
			clientX,
			trackRect,
			props.pxPerSecond,
			props.snapEnabled,
			props.snapTargets,
			props.playheadTime
		);
		if (time === null) return;
		pendingTrimTime = time;
		if (trimDebounce) clearTimeout(trimDebounce);
		const edge = activeTrimEdge;
		trimDebounce = setTimeout(() => {
			props.onTrim?.(props.trackId, props.clip.id, edge, time);
			trimDebounce = null;
		}, TRIM_DEBOUNCE_MS);
	}

	function finalizeTrim() {
		if (!activeTrimEdge || !props.onTrim) return;
		if (trimDebounce) {
			clearTimeout(trimDebounce);
			trimDebounce = null;
		}
		props.onTrim(props.trackId, props.clip.id, activeTrimEdge, pendingTrimTime);
		activeTrimEdge = null;
	}

	function onTrimPointerDown(edge: 'in' | 'out', event: PointerEvent) {
		if (!props.onTrim) return;
		event.preventDefault();
		event.stopPropagation();
		const clipEl = event.currentTarget as HTMLElement;
		// Sample against the track surface so the cursor can leave the clip in
		// either direction during the drag — required for outward trims.
		const trackEl = clipEl?.closest('.track-surface') as HTMLElement | null;
		if (!trackEl) return;
		const trackRect = trackEl.getBoundingClientRect();
		if (trackRect.width <= 0) return;

		activeTrimEdge = edge;
		scheduleTrim(event.clientX, trackRect);

		const onMove = (move: PointerEvent) => {
			scheduleTrim(move.clientX, trackRect);
		};
		const onUp = (up: PointerEvent) => {
			scheduleTrim(up.clientX, trackRect);
			finalizeTrim();
			clearPointerListeners();
		};

		clearPointerListeners();
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
		cleanupPointerListeners = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
		};
	}

	/** Keyboard delete so clips of any duration (including those without the
	 *  on-clip × button) can be removed when focused. */
	function onKeyDown(event: KeyboardEvent) {
		if (!props.onDelete) return;
		if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			props.onDelete(props.trackId, props.clip.id);
		}
	}

	function onSplit(event: MouseEvent) {
		if (!props.onSplit || props.clip.duration <= 0.001) return;
		const target = event.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		if (rect.width <= 0) return;
		const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
		const splitTime = clamp(
			props.clip.start + ratio * props.clip.duration,
			props.clip.start,
			props.clip.start + props.clip.duration
		);
		props.onSplit(props.trackId, props.clip.id, splitTime);
	}

	function shouldSplitEdge(event: PointerEvent): 'in' | 'out' | null {
		if (props.clip.duration <= 0.001) return null;
		const target = event.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const cursor = event.clientX - rect.left;
		if (cursor <= EDGE_HANDLE_PX) return 'in';
		if (rect.width - cursor <= EDGE_HANDLE_PX) return 'out';
		return null;
	}

	function onMovePointerDown(event: PointerEvent) {
		event.stopPropagation();
		// Select on pointerdown so a group drag can begin immediately; App keeps an
		// existing multi-selection intact when the clicked clip is already part of it.
		props.onSelect?.(event.shiftKey, false);
		if (!props.onMove) return;
		event.preventDefault();
		const clipEl = event.currentTarget as HTMLElement;
		const trackEl = clipEl?.closest('.track-surface') as HTMLElement | null;
		if (!trackEl) return;
		const originX = event.clientX;
		const originStart = props.clip.start;
		let moved = false;
		let finalStart = originStart;

		const onMove = (move: PointerEvent) => {
			const delta = (move.clientX - originX) / props.pxPerSecond;
			const candidate = Math.max(0, originStart + delta);
			finalStart = props.snapEnabled
				? resolveSnap(
						candidate,
						props.pxPerSecond,
						props.snapTargets,
						SNAP_THRESHOLD_PX,
						props.playheadTime
					).time
				: candidate;
			moved ||= Math.abs(finalStart - originStart) > 0.001;
			setDragPreviewStart(finalStart);
		};
		const onUp = (up: PointerEvent) => {
			onMove(up);
			setDragPreviewStart(null);
			clearPointerListeners();
			if (moved) {
				props.onMove?.(props.trackId, props.clip.id, finalStart, originStart);
			} else if (!up.shiftKey) {
				// A plain click (no drag, no shift) collapses any multi-selection down to
				// just this clip; the pointerdown handler had preserved the group in case
				// the user intended a drag.
				props.onSelect?.(false, true);
			}
		};

		clearPointerListeners();
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
		cleanupPointerListeners = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
		};
	}

	function onPointerDown(event: PointerEvent) {
		const edge = shouldSplitEdge(event);
		if (!edge) {
			onMovePointerDown(event);
			return;
		}
		onTrimPointerDown(edge, event);
	}

	return (
		<div
			class={`timeline-clip${props.isAudio ? ' is-audio' : ''}${props.selected ? ' is-selected' : ''}${dragPreviewStart() !== null ? ' is-dragging' : ''}${props.clip.offline ? ' is-offline' : ''}`}
			style={{
				translate: translate(),
				width: width(),
				'will-change': dragPreviewStart() !== null ? 'translate' : undefined
			}}
			title={clipTitle()}
			role="button"
			aria-pressed={!!props.selected}
			aria-label={`${clipTitle()}${props.clip.offline ? ' offline' : ''}`}
			tabindex="0"
			onKeyDown={onKeyDown}
			onPointerDown={onPointerDown}
			onDblClick={onSplit}
		>
			<span class="timeline-clip-inner">
				<Show when={!props.isAudio && props.getThumbnail}>
					<canvas
						class="timeline-clip-filmstrip"
						height={FILMSTRIP_HEIGHT}
						ref={(el) => {
							filmstripCanvas = el;
						}}
						aria-hidden="true"
					/>
				</Show>
				<Show when={props.isAudio && props.peaks}>
					{(peaks) => <Waveform peaks={peaks()} width={waveformWidth()} height={24} />}
				</Show>
				{props.clip.duration > 0.2 ? <span class="timeline-clip-id">{props.clip.id}</span> : null}
				<span class="timeline-clip-left-handle" role="separator" aria-label="Trim start" />
				<span class="timeline-clip-right-handle" role="separator" aria-label="Trim end" />
				{props.clip.duration > 0.2 ? (
					<span
						class="timeline-clip-delete"
						role="button"
						tabIndex={-1}
						aria-label={`Delete ${props.clip.id}`}
						onPointerDown={(event) => event.stopPropagation()}
						onKeyDown={(event) => {
							if (event.key === 'Enter' || event.key === ' ') {
								event.stopPropagation();
								event.preventDefault();
								props.onDelete?.(props.trackId, props.clip.id);
							}
						}}
						onClick={(event) => {
							event.stopPropagation();
							props.onDelete?.(props.trackId, props.clip.id);
						}}
					>
						×
					</span>
				) : null}
			</span>
		</div>
	);
}
