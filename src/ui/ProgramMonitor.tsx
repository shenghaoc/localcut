/**
 * ProgramMonitor — full-resolution preview of the composited program output
 * during an active Program Mode session.
 *
 * Displays the same OffscreenCanvas output path as the existing preview
 * canvas. No new compositor path — the program compositor IS the preview
 * compositor during a session.
 */

import { Show, onCleanup, onMount } from 'solid-js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProgramMonitorProps {
	/** Whether a program session is active. */
	isActive: () => boolean;
	/** The canvas element to display (shared with the existing preview). */
	canvas: () => HTMLCanvasElement | OffscreenCanvas | null;
	/** Current scene name for the overlay. */
	activeSceneName: () => string;
	/** Elapsed time in microseconds. */
	elapsedUs: () => number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatElapsed(elapsedUs: number): string {
	const s = Math.floor(elapsedUs / 1_000_000);
	const m = Math.floor(s / 60);
	const h = Math.floor(m / 60);
	if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
	return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProgramMonitor(props: ProgramMonitorProps) {
	let containerRef: HTMLDivElement | undefined;

	onMount(() => {
		// The canvas is managed by the existing preview system.
		// We just need to make it visible in our container.
		const canvas = props.canvas();
		if (canvas && containerRef) {
			if (canvas instanceof HTMLCanvasElement) {
				containerRef.appendChild(canvas);
			}
		}
	});

	onCleanup(() => {
		// The canvas is not ours to destroy — it's shared with the preview system.
	});

	return (
		<Show when={props.isActive()}>
			<div
				class="program-monitor"
				role="region"
				aria-label="Program output preview"
				ref={(el) => (containerRef = el)}
			>
				<div class="program-monitor-overlay" aria-live="polite">
					<span class="program-monitor-scene">{props.activeSceneName()}</span>
					<span class="program-monitor-time">{formatElapsed(props.elapsedUs())}</span>
				</div>
			</div>
		</Show>
	);
}
