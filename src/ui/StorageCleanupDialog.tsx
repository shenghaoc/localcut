import { createSignal, For, Show } from 'solid-js';
import { X } from 'lucide-solid';
import type { CleanupAction, CleanupResult, StorageHealthReport } from '../engine/storage-cleanup';
import { runCleanup, requestPersistentStorage } from '../engine/storage-cleanup';
import { formatBytes } from '../lib/format';
import { Button } from './components/button';

interface StorageCleanupDialogProps {
	open: boolean;
	report: StorageHealthReport | null;
	onClose: () => void;
	onRefresh: () => void;
}

function pressureClass(pressure: StorageHealthReport['pressure']): string {
	switch (pressure) {
		case 'ok':
			return 'is-ok';
		case 'near-limit':
			return 'is-warn';
		case 'storage-pressure':
			return 'is-breach';
		case 'unknown':
			return 'is-muted';
	}
}

export function StorageCleanupDialog(props: StorageCleanupDialogProps) {
	const [results, setResults] = createSignal<CleanupResult[]>([]);
	const [running, setRunning] = createSignal<string | null>(null);
	const [persistStatus, setPersistStatus] = createSignal<string | null>(null);

	async function handleCleanup(action: CleanupAction) {
		setRunning(action.target);
		const result = await runCleanup(action.target);
		setResults((prev) => [...prev, result]);
		setRunning(null);
		props.onRefresh();
	}

	async function handleRequestPersist() {
		const granted = await requestPersistentStorage();
		setPersistStatus(
			granted ? 'Persistent storage granted.' : 'Persistent storage request denied.'
		);
		props.onRefresh();
	}

	return (
		<Show when={props.open}>
			<div class="capability-backdrop" onClick={() => props.onClose()} aria-hidden="true" />
			<aside
				class="diagnostics-panel panel"
				role="dialog"
				aria-modal="true"
				aria-labelledby="storage-cleanup-title"
				tabIndex={-1}
				onKeyDown={(e) => {
					if (e.key === 'Escape') props.onClose();
				}}
			>
				<header class="capability-panel-header">
					<div>
						<p class="panel-title" id="storage-cleanup-title">
							Storage Cleanup
						</p>
						<Show when={props.report}>
							{(report) => (
								<p class={`capability-panel-tier ${pressureClass(report().pressure)}`}>
									{formatBytes(report().usageBytes)} / {formatBytes(report().quotaBytes)}
									{report().percentUsed !== null ? ` (${report().percentUsed!.toFixed(1)}%)` : ''}
									{' · '}
									{report().pressure}
								</p>
							)}
						</Show>
					</div>
					<Button
						size="icon"
						variant="ghost"
						onClick={props.onClose}
						aria-label="Close storage cleanup"
						title="Close storage cleanup"
					>
						<X size={16} aria-hidden="true" />
					</Button>
				</header>

				<Show
					when={props.report}
					fallback={<p class="capability-panel-note">Loading storage report...</p>}
				>
					{(report) => (
						<>
							<section class="diagnostics-section">
								<h2>Health</h2>
								<dl class="diagnostics-grid">
									<div>
										<dt>IndexedDB</dt>
										<dd>{report().indexedDbHealthy ? 'healthy' : 'error'}</dd>
									</div>
									<div>
										<dt>OPFS</dt>
										<dd>{report().opfsAvailable ? 'available' : 'unavailable'}</dd>
									</div>
									<div>
										<dt>Persistent</dt>
										<dd>{report().persistentStorage}</dd>
									</div>
								</dl>
								<Show when={report().persistentStorage !== 'granted'}>
									<Button size="sm" variant="outline" onClick={handleRequestPersist}>
										Request persistent storage
									</Button>
								</Show>
								<Show when={persistStatus()}>
									<p class="diagnostics-copy-status" aria-live="polite">
										{persistStatus()}
									</p>
								</Show>
							</section>

							<section class="diagnostics-section">
								<h2>Cleanup Actions</h2>
								<ul class="diagnostics-list">
									<For each={report().availableCleanups}>
										{(action) => {
											const result = () => results().find((r) => r.target === action.target);
											return (
												<li class={`diagnostics-row ${result()?.ok ? 'is-ok' : 'is-muted'}`}>
													<span>{action.label}</span>
													<p>{action.description}</p>
													<Show when={!result()}>
														<Button
															size="sm"
															variant="outline"
															disabled={running() !== null}
															onClick={() => handleCleanup(action)}
														>
															{running() === action.target ? 'Cleaning…' : action.label}
														</Button>
													</Show>
													<Show when={result()}>
														{(r) => (
															<p class={r().ok ? 'is-ok' : 'is-breach'}>
																{r().ok
																	? `Done (freed ${formatBytes(r().freedBytes)})`
																	: `Error: ${r().error}`}
															</p>
														)}
													</Show>
												</li>
											);
										}}
									</For>
								</ul>
							</section>
						</>
					)}
				</Show>
			</aside>
		</Show>
	);
}
