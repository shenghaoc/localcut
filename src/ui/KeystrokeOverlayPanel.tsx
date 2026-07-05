/** Keystroke Overlay panel — Phase 44 R3.5 + Phase 41 T13.8.
 *
 *  Two surfaces:
 *   1. **Manual mode** (no active capture session) — the original Phase 44
 *      flow: user opts in, presses Start, the panel attaches a `window` keydown
 *      listener, then they Stop and Insert clips on the timeline. Routed
 *      through {@link shouldRecordKey} so printable text and password fields
 *      never leak in.
 *   2. **Sidecar mode** (Phase 41) — when a capture session has landed, the
 *      panel offers "Load events from last recording" which reads the session's
 *      `events.ndjson` sidecar via the worker-owned DOM tap. No window listener
 *      runs in this mode; the capture session covered the recording end.
 *
 *  Manual mode is disabled while a capture session is actively recording so the
 *  two listener paths never run concurrently (T13.8 acceptance).
 */

import { createEffect, createSignal, For, Show, onCleanup } from 'solid-js';
import { Button } from './components/button';
import {
	shouldRecordKey,
	formatKeyCombo,
	type CaptureEventLogEntry
} from '../engine/capture/event-log';
import {
	generateKeyOverlayClips,
	KEY_OVERLAY_DURATION_S
} from '../engine/capture/key-overlay-generator';
import { readCaptureEventsSidecar } from '../engine/capture/events-sidecar';
import type { WorkerCommand, TitleStyleSnapshot } from '../protocol';

export interface KeystrokeOverlayPanelProps {
	sendCommand: (cmd: WorkerCommand) => void;
	onClose?: () => void;
	/** Phase 41: most recently landed capture session id, if any. Enables the
	 *  "Load events from last recording" affordance and disables manual mode
	 *  while the session is actively recording (see {@link captureRecording}). */
	landedSessionId?: string | null;
	/** Phase 41: true when a capture session is currently recording, so the panel
	 *  can disable manual recording (the worker-driven DOM tap covers it). */
	captureRecording?: boolean;
	/** Phase 41: writer worker has flushed + closed `events.ndjson` for the
	 *  current `landedSessionId`. The Load button stays disabled until this is
	 *  true so we never race the writer's still-open SyncAccessHandle. */
	sidecarReady?: boolean;
	/** Phase 41: lazy lookup for the timeline start of a session's first clip.
	 *  Called on Insert click only, so the O(tracks×clips) scan doesn't run on
	 *  every timeline mutation during recording. Returns null when no clip with
	 *  the given session id exists (session was discarded, sources still landing). */
	resolveSessionStartS?: (sessionId: string) => number | null;
}

function formatStamp(s: number): string {
	const m = Math.floor(s / 60);
	const sec = s - m * 60;
	return `${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
}

export function KeystrokeOverlayPanel(props: KeystrokeOverlayPanelProps) {
	const [optedIn, setOptedIn] = createSignal(false);
	const [recording, setRecording] = createSignal(false);
	const [entries, setEntries] = createSignal<CaptureEventLogEntry[]>([]);
	/** Provenance of the current entries: 'manual' (this panel's listener) vs
	 *  'sidecar' (loaded from a capture session's events.ndjson). Drives copy +
	 *  the disabled state on the manual controls. */
	const [source, setSource] = createSignal<'manual' | 'sidecar'>('manual');
	const [sidecarSessionId, setSidecarSessionId] = createSignal<string | null>(null);
	const [loadingSidecar, setLoadingSidecar] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	let sessionStartMs = 0;

	const onKeyDown = (event: KeyboardEvent) => {
		if (!recording() || !optedIn()) return;
		if (!shouldRecordKey(event)) return;
		const t = (performance.now() - sessionStartMs) / 1000;
		setEntries((prev) => [...prev, { kind: 'key', combo: formatKeyCombo(event), t }]);
	};

	function startRecording() {
		if (!optedIn()) {
			setError('You must opt in to recording shortcuts before starting.');
			return;
		}
		if (props.captureRecording) {
			// Belt-and-suspenders: the button is disabled when capture is recording,
			// but block here too in case the prop flips while the panel is open.
			setError('A capture session is running — its DOM tap is already recording your shortcuts.');
			return;
		}
		setError(null);
		sessionStartMs = performance.now();
		setEntries([]);
		setSource('manual');
		setSidecarSessionId(null);
		setRecording(true);
		window.addEventListener('keydown', onKeyDown, { capture: true });
	}

	function stopRecording() {
		setRecording(false);
		window.removeEventListener('keydown', onKeyDown, { capture: true } as EventListenerOptions);
	}

	async function loadFromSidecar() {
		const sessionId = props.landedSessionId;
		if (!sessionId) return;
		setError(null);
		setLoadingSidecar(true);
		try {
			const sidecar = await readCaptureEventsSidecar(sessionId);
			if (sidecar === null) {
				setError(
					`No events sidecar found for session ${sessionId}. The capture finished before any shortcuts were pressed, or the sidecar failed to open.`
				);
				return;
			}
			// Filter to key entries only — the overlay generator ignores other kinds,
			// but we surface key counts honestly in the panel.
			const keyEntries = sidecar.filter((e) => e.kind === 'key');
			setEntries(keyEntries);
			setSource('sidecar');
			setSidecarSessionId(sessionId);
		} catch (err) {
			setError(`Failed to read events sidecar: ${String(err)}`);
		} finally {
			setLoadingSidecar(false);
		}
	}

	function insertOverlay() {
		if (entries().length === 0) return;
		// Sidecar t is session-relative. For retakes the session starts at the
		// retake clip's timeline position, so overlay clips need that offset added.
		// Manual mode is always relative to the panel's own session start, so
		// offset there is 0. We resolve the session start lazily here (not as a
		// memo that re-runs on every timeline mutation) since it's only needed on
		// this exact click.
		let sessionOffsetS = 0;
		if (source() === 'sidecar') {
			const sid = sidecarSessionId();
			if (sid && props.resolveSessionStartS) {
				sessionOffsetS = props.resolveSessionStartS(sid) ?? 0;
			}
		}
		const clips = generateKeyOverlayClips(entries(), sessionOffsetS).map((c) => ({
			text: c.text,
			startS: c.startS,
			durationS: c.durationS,
			style: c.style as Partial<TitleStyleSnapshot>
		}));
		// sessionOffsetS is already baked into each clip's startS — don't send it
		// on the command (the worker doesn't read it, and a redundant field
		// invites a maintainer to remove the client-side offset).
		props.sendCommand({ type: 'generate-key-overlay', clips });
	}

	function clearLog() {
		setEntries([]);
		setSource('manual');
		setSidecarSessionId(null);
	}

	onCleanup(() => {
		if (recording()) stopRecording();
	});

	// Stop manual recording when a capture session begins so the panel listener
	// and the worker-driven DOM tap never both record the same keys (the disabled
	// Start button only blocks future starts).
	createEffect(() => {
		if (props.captureRecording && recording()) {
			stopRecording();
		}
	});

	// Clear stale state when the landed session id changes so a fresh session
	// doesn't show events from a previous one.
	createEffect(() => {
		const id = props.landedSessionId;
		if (id !== sidecarSessionId() && source() === 'sidecar') {
			setEntries([]);
			setSource('manual');
			setSidecarSessionId(null);
		}
	});

	const handleClose = () => {
		if (recording()) stopRecording();
		props.onClose?.();
	};

	const manualDisabledReason = (): string | null => {
		if (props.captureRecording)
			return 'A capture session is recording — the DOM tap covers shortcut logging.';
		if (source() === 'sidecar')
			return 'Showing events from a landed capture session. Clear to record manually.';
		return null;
	};

	return (
		<div class="keystroke-overlay-panel" role="region" aria-label="Keystroke Overlay">
			<div class="keystroke-overlay-header">
				<h3>Keystroke Overlay</h3>
				<button
					type="button"
					class="keystroke-overlay-close"
					aria-label="Close keystroke overlay panel"
					title="Close keystroke overlay panel"
					onClick={handleClose}
				>
					×
				</button>
			</div>

			<p class="keystroke-overlay-desc">
				Records non-text shortcuts (modifier combos, function keys, navigation) while you narrate.
				Printable text (e.g. typing into a form) is never captured. Generated clips appear as a new{' '}
				<strong>Keystrokes</strong> overlay track at the top of the timeline and can be edited like
				any other title clip ({KEY_OVERLAY_DURATION_S.toFixed(1)} s each, monospace style).
			</p>

			<Show when={props.landedSessionId && source() !== 'sidecar' && !props.captureRecording}>
				<div class="keystroke-overlay-sidecar-prompt">
					<p>
						A capture session landed (<code>{props.landedSessionId}</code>). The session's DOM tap
						recorded shortcut events into a sidecar; loading them here skips the manual record step.
					</p>
					<Button
						variant="default"
						onClick={() => {
							void loadFromSidecar();
						}}
						disabled={loadingSidecar() || props.sidecarReady === false}
						title={
							props.sidecarReady === false
								? 'Waiting for the recording’s events sidecar to flush…'
								: undefined
						}
					>
						{loadingSidecar()
							? 'Loading…'
							: props.sidecarReady === false
								? 'Waiting for sidecar…'
								: 'Load events from last recording'}
					</Button>
				</div>
			</Show>

			<Show when={source() === 'sidecar' && sidecarSessionId()}>
				<div class="keystroke-overlay-sidecar-loaded" role="status">
					Showing events from session <code>{sidecarSessionId()}</code>.
				</div>
			</Show>

			<label class="keystroke-overlay-optin">
				<input
					type="checkbox"
					checked={optedIn()}
					onChange={(e) => setOptedIn(e.currentTarget.checked)}
					disabled={recording() || !!manualDisabledReason()}
				/>
				<span>I understand and want to record shortcuts.</span>
			</label>

			<div class="keystroke-overlay-actions">
				<Show
					when={!recording()}
					fallback={
						<Button variant="default" onClick={stopRecording}>
							Stop recording
						</Button>
					}
				>
					<Button
						variant="default"
						onClick={startRecording}
						disabled={!optedIn() || !!manualDisabledReason()}
						title={manualDisabledReason() ?? undefined}
					>
						Start recording
					</Button>
				</Show>
				<Button
					variant="secondary"
					disabled={entries().length === 0 || recording()}
					onClick={insertOverlay}
				>
					Insert overlay clips ({entries().length})
				</Button>
				<Button variant="secondary" disabled={entries().length === 0} onClick={clearLog}>
					Clear
				</Button>
			</div>

			<Show when={manualDisabledReason()}>
				<p class="keystroke-overlay-manual-disabled" role="note">
					{manualDisabledReason()}
				</p>
			</Show>

			<Show when={error()}>
				{(err) => (
					<div class="keystroke-overlay-error" role="alert">
						{err()}
					</div>
				)}
			</Show>

			<Show when={recording()}>
				<div class="keystroke-overlay-status" role="status">
					Recording… press shortcuts in any non-text element. Use <kbd>Stop recording</kbd> when
					finished.
				</div>
			</Show>

			<Show when={entries().length > 0}>
				<div class="keystroke-overlay-log">
					<table>
						<thead>
							<tr>
								<th>Time</th>
								<th>Combo</th>
							</tr>
						</thead>
						<tbody>
							<For each={entries()}>
								{(entry) => {
									const e = entry as { kind: 'key'; combo: string; t: number };
									return (
										<tr>
											<td>{formatStamp(e.t)}</td>
											<td>
												<code class="keystroke-overlay-combo">{e.combo}</code>
											</td>
										</tr>
									);
								}}
							</For>
						</tbody>
					</table>
				</div>
			</Show>
		</div>
	);
}
