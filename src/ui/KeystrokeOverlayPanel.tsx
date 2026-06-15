/** Keystroke Overlay panel — Phase 44 R3.5.
 *
 *  Surfaces the "Generate keystroke overlay" entry point. The panel records
 *  shortcuts only when the user explicitly enables recording (opt-in gate),
 *  routes every keydown through {@link shouldRecordKey} so printable text and
 *  password fields never leak in, then dispatches `generate-key-overlay` to
 *  the pipeline worker on user demand.
 */

import { createSignal, For, Show, onCleanup } from 'solid-js';
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
import type { WorkerCommand, TitleStyleSnapshot } from '../protocol';

export interface KeystrokeOverlayPanelProps {
	sendCommand: (cmd: WorkerCommand) => void;
	onClose?: () => void;
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
		setError(null);
		sessionStartMs = performance.now();
		setEntries([]);
		setRecording(true);
		window.addEventListener('keydown', onKeyDown, { capture: true });
	}

	function stopRecording() {
		setRecording(false);
		window.removeEventListener('keydown', onKeyDown, { capture: true } as EventListenerOptions);
	}

	function insertOverlay() {
		if (entries().length === 0) return;
		const clips = generateKeyOverlayClips(entries(), 0).map((c) => ({
			text: c.text,
			startS: c.startS,
			durationS: c.durationS,
			style: c.style as Partial<TitleStyleSnapshot>
		}));
		props.sendCommand({ type: 'generate-key-overlay', clips, sessionOffsetS: 0 });
	}

	function clearLog() {
		setEntries([]);
	}

	onCleanup(() => {
		if (recording()) stopRecording();
	});

	const handleClose = () => {
		if (recording()) stopRecording();
		props.onClose?.();
	};

	return (
		<div class="keystroke-overlay-panel" role="region" aria-label="Keystroke Overlay">
			<div class="keystroke-overlay-header">
				<h3>Keystroke Overlay</h3>
				<button
					type="button"
					class="keystroke-overlay-close"
					aria-label="Close panel"
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

			<label class="keystroke-overlay-optin">
				<input
					type="checkbox"
					checked={optedIn()}
					onChange={(e) => setOptedIn(e.currentTarget.checked)}
					disabled={recording()}
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
					<Button variant="default" onClick={startRecording} disabled={!optedIn()}>
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
