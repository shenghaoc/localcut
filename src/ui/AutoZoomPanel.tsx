/** Phase 43: Auto-Zoom proposals panel for the clip Inspector.
 *
 *  Reads the event log from OPFS, clusters events into zoom proposals, and
 *  lets the user apply or skip each proposal.
 */

import { createSignal, createEffect, Show, For } from 'solid-js';
import {
	clusterEvents,
	applyProposal,
	DEFAULT_AUTO_ZOOM_PARAMS,
	type AutoZoomParams,
	type ZoomProposal
} from '../engine/auto-zoom';
import { parseDomEventLog, type DomEventLogEntry } from '../engine/dom-event-log';
import type { ClipKeyframesSnapshot, SessionEventLogRef } from '../protocol';

interface AutoZoomPanelProps {
	clipId: string;
	trackId: string;
	sessionEventLogRef?: SessionEventLogRef;
	onSetKeyframes: (trackId: string, clipId: string, keyframes: ClipKeyframesSnapshot) => void;
}

function formatTime(us: number): string {
	const totalS = us / 1e6;
	const h = Math.floor(totalS / 3600);
	const m = Math.floor((totalS % 3600) / 60);
	const s = totalS % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

export function AutoZoomPanel(props: AutoZoomPanelProps) {
	const [entries, setEntries] = createSignal<DomEventLogEntry[]>([]);
	const [proposals, setProposals] = createSignal<ZoomProposal[]>([]);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [params, setParams] = createSignal<AutoZoomParams>({ ...DEFAULT_AUTO_ZOOM_PARAMS });

	// Load event log when ref changes
	createEffect(() => {
		const ref = props.sessionEventLogRef;
		if (!ref) {
			setEntries([]);
			setProposals([]);
			return;
		}

		setLoading(true);
		setError(null);

		void (async () => {
			try {
				const root = await navigator.storage.getDirectory();
				const parts = ref.opfsPath.split('/');
				let dir = root;
				for (const part of parts.slice(0, -1)) {
					dir = await dir.getDirectoryHandle(part);
				}
				const fileName = parts[parts.length - 1]!;
				const fileHandle = await dir.getFileHandle(fileName);
				const file = await fileHandle.getFile();
				const text = await file.text();
				const log = parseDomEventLog(JSON.parse(text));
				if (log) {
					setEntries(log.events);
				} else {
					setError('Invalid event log format');
				}
			} catch {
				setError('No event log available for this clip.');
			} finally {
				setLoading(false);
			}
		})();
	});

	const handleRecluster = () => {
		const e = entries();
		if (e.length === 0) return;
		// Clip start at 0 for proposal timing
		setProposals(clusterEvents(e, params(), 0));
	};

	const handleApply = (proposal: ZoomProposal) => {
		const keyframes = applyProposal(proposal);
		props.onSetKeyframes(
			props.trackId,
			props.clipId,
			keyframes as unknown as ClipKeyframesSnapshot
		);
		setProposals((prev) =>
			prev.map((p) => (p.id === proposal.id ? { ...p, status: 'applied' } : p))
		);
	};

	const handleSkip = (proposal: ZoomProposal) => {
		setProposals((prev) =>
			prev.map((p) =>
				p.id === proposal.id ? { ...p, status: p.status === 'skipped' ? 'pending' : 'skipped' } : p
			)
		);
	};

	return (
		<section class="inspector-section">
			<h3>Auto-Zoom</h3>

			<Show when={!props.sessionEventLogRef}>
				<p class="placeholder-text">
					No event log available for this clip. Event logs are recorded only for own-tab captures.
				</p>
			</Show>

			<Show when={props.sessionEventLogRef}>
				<Show when={loading()}>
					<p class="loading-text">Loading event log…</p>
				</Show>

				<Show when={error()}>
					<p class="error-text">{error()}</p>
				</Show>

				<Show when={!loading() && !error() && entries().length > 0}>
					<div class="autozoom-params">
						<label>
							Window (s)
							<input
								type="number"
								value={params().clusterWindowS}
								onInput={(e) =>
									setParams((p) => ({ ...p, clusterWindowS: Number(e.currentTarget.value) }))
								}
								min={0.5}
								max={30}
								step={0.5}
							/>
						</label>
						<label>
							Distance
							<input
								type="number"
								value={params().clusterDistanceNorm}
								onInput={(e) =>
									setParams((p) => ({ ...p, clusterDistanceNorm: Number(e.currentTarget.value) }))
								}
								min={0.01}
								max={1}
								step={0.01}
							/>
						</label>
						<label>
							Scale
							<input
								type="number"
								value={params().zoomScale}
								onInput={(e) =>
									setParams((p) => ({ ...p, zoomScale: Number(e.currentTarget.value) }))
								}
								min={1}
								max={4}
								step={0.1}
							/>
						</label>
					</div>

					<button type="button" class="recluster-btn" onClick={handleRecluster}>
						Re-cluster
					</button>

					<div class="proposal-list">
						<For each={proposals()}>
							{(proposal) => (
								<div class={`proposal-item proposal-item--${proposal.status}`}>
									<span class="proposal-time">{formatTime(proposal.cluster.startUs)}</span>
									<span class="proposal-centroid">
										{(proposal.centroidX * 100).toFixed(0)}% ×{' '}
										{(proposal.centroidY * 100).toFixed(0)}%
									</span>
									<span class="proposal-count">{proposal.cluster.eventCount} events</span>
									<button
										type="button"
										onClick={() => handleApply(proposal)}
										disabled={proposal.status === 'applied'}
									>
										{proposal.status === 'applied' ? 'Applied' : 'Apply'}
									</button>
									<button type="button" onClick={() => handleSkip(proposal)}>
										{proposal.status === 'skipped' ? 'Unskip' : 'Skip'}
									</button>
								</div>
							)}
						</For>
					</div>
				</Show>

				<Show when={!loading() && !error() && entries().length === 0}>
					<p class="placeholder-text">No events recorded in this session.</p>
				</Show>
			</Show>
		</section>
	);
}
