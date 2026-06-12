import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { Clipboard, RefreshCw, X } from 'lucide-solid';
import type {
	DiagnosticSnapshot,
	DiagnosticSourceInput,
	PerformanceBudget
} from '../diagnostics/types';
import {
	buildCopyableDiagnosticReport,
	formatCopyableDiagnosticReport
} from '../diagnostics/redaction';
import { Button } from './components/button';

interface DiagnosticsPanelProps {
	open: boolean;
	snapshot: DiagnosticSnapshot | null;
	sources: readonly DiagnosticSourceInput[];
	onRefresh: () => void;
	onClose: () => void;
	onRecoveryAction?: (actionId: string) => void;
	/** Opens the in-app user guide on the Performance section. */
	onOpenGuide?: () => void;
}

function formatBytes(value: number | null): string {
	if (value === null) return 'Unknown';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let scaled = value;
	let unit = 0;
	while (scaled >= 1024 && unit < units.length - 1) {
		scaled /= 1024;
		unit += 1;
	}
	return `${scaled.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function budgetClass(budget: PerformanceBudget): string {
	switch (budget.status) {
		case 'ok':
			return 'is-ok';
		case 'warning':
			return 'is-warn';
		case 'breach':
			return 'is-breach';
		case 'not-measured':
			return 'is-muted';
	}
}

function observedBudgetValue(budget: PerformanceBudget): string {
	if (budget.observed === null) return 'Not measured';
	if (budget.unit === 'bytes') return formatBytes(budget.observed);
	if (budget.unit === 'percent') return `${budget.observed.toFixed(1)}%`;
	return `${budget.observed.toFixed(Number.isInteger(budget.observed) ? 0 : 2)} ${budget.unit}`;
}

export function DiagnosticsPanel(props: DiagnosticsPanelProps) {
	let panelRef: HTMLElement | undefined;
	const [copyStatus, setCopyStatus] = createSignal<string | null>(null);

	createEffect(() => {
		if (props.open) {
			requestAnimationFrame(() => panelRef?.focus());
		}
	});
	const reportText = createMemo(() => {
		const snapshot = props.snapshot;
		if (!snapshot) return '';
		return formatCopyableDiagnosticReport(buildCopyableDiagnosticReport(snapshot, props.sources));
	});

	async function copyReport() {
		const text = reportText();
		if (!text) return;
		if (!navigator.clipboard) {
			setCopyStatus('Copy failed: Clipboard API is not available (requires HTTPS).');
			return;
		}
		try {
			await navigator.clipboard.writeText(text);
			setCopyStatus('Diagnostics report copied.');
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setCopyStatus(`Copy failed: ${message}`);
		}
	}

	return (
		<Show when={props.open}>
			<div class="capability-backdrop" onClick={props.onClose} aria-hidden="true" />
			<aside
				ref={panelRef}
				class="diagnostics-panel panel"
				role="dialog"
				aria-modal="true"
				aria-labelledby="diagnostics-panel-title"
				tabIndex={-1}
				onKeyDown={(e) => {
					if (e.key === 'Escape') {
						props.onClose();
						return;
					}
					if (e.key === 'Tab') {
						const panel = panelRef;
						if (!panel) return;
						const focusable = panel.querySelectorAll<HTMLElement>(
							'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
						);
						if (focusable.length === 0) return;
						const first = focusable[0]!;
						const last = focusable[focusable.length - 1]!;
						if (document.activeElement === panel) {
							e.preventDefault();
							(e.shiftKey ? last : first).focus();
							return;
						}
						if (e.shiftKey && document.activeElement === first) {
							e.preventDefault();
							last.focus();
						} else if (!e.shiftKey && document.activeElement === last) {
							e.preventDefault();
							first.focus();
						}
					}
				}}
			>
				<header class="capability-panel-header">
					<div>
						<p class="panel-title" id="diagnostics-panel-title">
							Diagnostics
						</p>
						<p class="capability-panel-tier">
							<Show when={props.snapshot} fallback="Snapshot unavailable">
								{(snapshot) => <>Active tier: {snapshot().capability.tier}</>}
							</Show>
						</p>
					</div>
					<div class="diagnostics-actions">
						<Button
							size="icon"
							variant="ghost"
							onClick={props.onRefresh}
							aria-label="Refresh diagnostics"
						>
							<RefreshCw size={16} aria-hidden="true" />
						</Button>
						<Button
							size="icon"
							variant="ghost"
							onClick={copyReport}
							aria-label="Copy diagnostics report"
						>
							<Clipboard size={16} aria-hidden="true" />
						</Button>
						<Button
							size="icon"
							variant="ghost"
							onClick={props.onClose}
							aria-label="Close diagnostics panel"
						>
							<X size={16} aria-hidden="true" />
						</Button>
					</div>
				</header>

				<Show
					when={props.snapshot}
					fallback={<p class="capability-panel-note">Requesting diagnostics...</p>}
				>
					{(snapshot) => (
						<>
							<section class="diagnostics-section">
								<h2>Capability</h2>
								<p>{snapshot().capability.tierReason}</p>
								<ul class="diagnostics-list">
									<For each={snapshot().capability.findings}>
										{(finding) => (
											<li
												class={`diagnostics-row ${finding.status === 'supported' ? 'is-ok' : 'is-warn'}`}
											>
												<span>{finding.code}</span>
												<strong>{finding.status}</strong>
												<p>{finding.message}</p>
												<Show when={finding.action}>
													<p>{finding.action}</p>
												</Show>
											</li>
										)}
									</For>
								</ul>
							</section>

							<section class="diagnostics-section">
								<h2>GPU + Codecs</h2>
								<dl class="diagnostics-grid">
									<div>
										<dt>WebGPU</dt>
										<dd>{snapshot().capability.webGpu.status}</dd>
									</div>
									<div>
										<dt>Features</dt>
										<dd>{snapshot().capability.webGpu.features.join(', ') || 'default'}</dd>
									</div>
									<Show when={snapshot().capability.webGpu.lastDeviceLost}>
										{(lost) => (
											<div>
												<dt>Last device lost</dt>
												<dd>
													{lost().reason}: {lost().message}
												</dd>
											</div>
										)}
									</Show>
									<Show when={snapshot().capability.webGpu.limits}>
										{(limits) => (
											<div>
												<dt>Limits</dt>
												<dd>
													{Object.entries(limits())
														.map(([k, v]) => `${k}=${v}`)
														.join(', ')}
												</dd>
											</div>
										)}
									</Show>
									<div>
										<dt>Decode</dt>
										<dd>
											{snapshot()
												.capability.webCodecs.decoders.map(
													(c) => `${c.codec}${c.supported ? '' : ' (unsupported)'}`
												)
												.join(', ') || 'none'}
										</dd>
									</div>
									<div>
										<dt>Encode</dt>
										<dd>
											{snapshot()
												.capability.webCodecs.encoders.map(
													(c) => `${c.codec}${c.supported ? '' : ' (unsupported)'}`
												)
												.join(', ') || 'none'}
										</dd>
									</div>
									<Show when={snapshot().capability.formatCompatibility}>
										{(compat) => (
											<>
												<div>
													<dt>Video codecs</dt>
													<dd>
														{compat().supportedVideoCodecs}/{compat().totalVideoCodecs} supported (
														{compat().hwPreferredVideoCodecs} hardware) ·{' '}
														{compat()
															.videoCodecs.map((c) => `${c.codec}: ${c.strategy}`)
															.join(', ') || 'none'}
													</dd>
												</div>
												<div>
													<dt>Audio codecs</dt>
													<dd>
														{compat().supportedAudioCodecs}/{compat().totalAudioCodecs} supported ·{' '}
														{compat()
															.audioCodecs.map((c) => `${c.codec}: ${c.strategy}`)
															.join(', ') || 'none'}
													</dd>
												</div>
												<div>
													<dt>Containers</dt>
													<dd>{compat().demuxableContainers.join(', ') || 'none'}</dd>
												</div>
											</>
										)}
									</Show>
								</dl>
							</section>

							<section class="diagnostics-section">
								<h2>Storage + Cache</h2>
								<dl class="diagnostics-grid">
									<div>
										<dt>Usage</dt>
										<dd>{formatBytes(snapshot().storage.usageBytes)}</dd>
									</div>
									<div>
										<dt>Quota</dt>
										<dd>{formatBytes(snapshot().storage.quotaBytes)}</dd>
									</div>
									<div>
										<dt>OPFS</dt>
										<dd>{snapshot().storage.opfsSupported ? 'available' : 'unavailable'}</dd>
									</div>
									<div>
										<dt>Cache</dt>
										<dd>
											{snapshot().proxyCache.status} ·{' '}
											{formatBytes(snapshot().proxyCache.estimatedBytes)}
										</dd>
									</div>
								</dl>
							</section>

							<section class="diagnostics-section">
								<h2>Export</h2>
								<Show
									when={snapshot().activeExportSettings}
									fallback={<p>No active export settings.</p>}
								>
									{(settings) => (
										<dl class="diagnostics-grid">
											<div>
												<dt>Codec</dt>
												<dd>{settings().codec.toUpperCase()}</dd>
											</div>
											<div>
												<dt>Container</dt>
												<dd>{settings().container.toUpperCase()}</dd>
											</div>
											<div>
												<dt>Size</dt>
												<dd>
													{settings().width}x{settings().height}
												</dd>
											</div>
											<div>
												<dt>Source</dt>
												<dd>{settings().sourceMode}</dd>
											</div>
										</dl>
									)}
								</Show>
							</section>

							<section class="diagnostics-section">
								<h2>Performance Budgets</h2>
								<ul class="diagnostics-list">
									<For each={snapshot().performanceBudgets}>
										{(budget) => (
											<li class={`diagnostics-row ${budgetClass(budget)}`}>
												<span>{budget.label}</span>
												<strong>{budget.status}</strong>
												<p>{observedBudgetValue(budget)}</p>
												<Show when={budget.notes}>
													<p>{budget.notes}</p>
												</Show>
											</li>
										)}
									</For>
								</ul>
								<Show when={props.onOpenGuide}>
									<button
										type="button"
										class="export-why-link"
										onClick={() => props.onOpenGuide?.()}
									>
										Performance tips in the user guide
									</button>
								</Show>
							</section>

							<section class="diagnostics-section">
								<h2>Recent Errors</h2>
								<Show
									when={snapshot().recentErrors.entries.length > 0}
									fallback={<p>No recent structured errors.</p>}
								>
									<ul class="diagnostics-list">
										<For each={snapshot().recentErrors.entries}>
											{(error) => (
												<li class={`diagnostics-row is-${error.severity}`}>
													<span>{error.code}</span>
													<strong>{error.subsystem}</strong>
													<p>{error.message}</p>
												</li>
											)}
										</For>
									</ul>
								</Show>
							</section>

							<section class="diagnostics-section">
								<h2>Recovery Actions</h2>
								<Show
									when={snapshot().recoveryActions.length > 0}
									fallback={<p>No recovery actions are available.</p>}
								>
									<ul class="diagnostics-list">
										<For each={snapshot().recoveryActions}>
											{(action) => (
												<li class={`diagnostics-row ${action.enabled ? 'is-warn' : 'is-muted'}`}>
													<span>{action.label}</span>
													<p>{action.description}</p>
													<Show
														when={action.enabled && props.onRecoveryAction}
														fallback={
															<Show when={action.reasonDisabled}>
																<p class="diagnostics-disabled-reason">{action.reasonDisabled}</p>
															</Show>
														}
													>
														<Button
															size="sm"
															variant="outline"
															onClick={() => props.onRecoveryAction?.(action.actionId)}
														>
															{action.label}
														</Button>
													</Show>
												</li>
											)}
										</For>
									</ul>
								</Show>
							</section>
						</>
					)}
				</Show>
				<p class="diagnostics-copy-status" aria-live="polite">
					{copyStatus()}
				</p>
			</aside>
		</Show>
	);
}
