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
import { formatBytes } from '../lib/format';
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

function formatMs(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.round((ms % 60_000) / 1000);
	return `${minutes}m ${seconds}s`;
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
			<div class="capability-backdrop" onClick={() => props.onClose()} aria-hidden="true" />
			<aside
				ref={(el) => (panelRef = el)}
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
							<Show when={props.snapshot} fallback="Couldn't capture a snapshot">
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
							title="Close diagnostics panel"
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
								<h2>Voice Cleanup</h2>
								<dl class="diagnostics-grid">
									<div>
										<dt>Denoiser tracks</dt>
										<dd>{snapshot().voiceCleanup.denoiserEnabledTrackCount}</dd>
									</div>
									<div>
										<dt>WASM</dt>
										<dd>{snapshot().voiceCleanup.wasmProvenance}</dd>
									</div>
									<div>
										<dt>WASM status</dt>
										<dd>{snapshot().voiceCleanup.wasmLoadStatus}</dd>
									</div>
									<div>
										<dt>Checksum</dt>
										<dd>{snapshot().voiceCleanup.wasmSha256 ?? 'not verified yet'}</dd>
									</div>
									<div>
										<dt>Latency</dt>
										<dd>{snapshot().voiceCleanup.workletLatencyMs.toFixed(2)} ms</dd>
									</div>
									<div>
										<dt>Target</dt>
										<dd>{snapshot().voiceCleanup.normalisationTargetLufs} LUFS</dd>
									</div>
									<div>
										<dt>Ceiling</dt>
										<dd>{snapshot().voiceCleanup.limiterCeilingDbtp} dBTP</dd>
									</div>
								</dl>
								<ul class="diagnostics-list">
									<For each={snapshot().voiceCleanup.findings}>
										{(finding) => (
											<li
												class={`diagnostics-row ${finding.status === 'supported' ? 'is-ok' : 'is-muted'}`}
											>
												<span>{finding.code}</span>
												<strong>{finding.status}</strong>
												<p>{finding.message}</p>
											</li>
										)}
									</For>
								</ul>
							</section>

							<section class="diagnostics-section">
								<h2>Export</h2>
								<Show
									when={snapshot().activeExportSettings}
									fallback={<p>Start an export to see settings here.</p>}
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
									fallback={<p>All clear — no errors to report.</p>}
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

							{/* Phase 37: Frame Interpolation diagnostics */}
							<Show when={snapshot().interpolation}>
								{(interp) => (
									<section class="diagnostics-section">
										<h2>Frame Interpolation (ML)</h2>
										<dl class="diagnostics-grid">
											<div>
												<dt>Available</dt>
												<dd>{interp().available ? 'Yes' : 'No'}</dd>
											</div>
											<Show when={interp().accelerator}>
												<div>
													<dt>Accelerator</dt>
													<dd>{interp().accelerator}</dd>
												</div>
											</Show>
											<div>
												<dt>Model</dt>
												<dd>{interp().modelStatus}</dd>
											</div>
											<Show when={interp().modelSizeBytes !== null}>
												<div>
													<dt>Model size</dt>
													<dd>{formatBytes(interp().modelSizeBytes!)}</dd>
												</div>
											</Show>
											<Show when={interp().cacheSource !== null}>
												<div>
													<dt>Cache source</dt>
													<dd>{interp().cacheSource}</dd>
												</div>
											</Show>
											<Show when={interp().lastEstimateMs !== null}>
												<div>
													<dt>Last estimate</dt>
													<dd>{formatMs(interp().lastEstimateMs!)}</dd>
												</div>
											</Show>
											<Show when={interp().lastActualMs !== null}>
												<div>
													<dt>Last actual</dt>
													<dd>{formatMs(interp().lastActualMs!)}</dd>
												</div>
											</Show>
											<Show when={interp().lastRefusals > 0}>
												<div>
													<dt>Shot-boundary refusals</dt>
													<dd class="is-warn">{interp().lastRefusals}</dd>
												</div>
											</Show>
										</dl>
										<Show when={interp().recentErrors.length > 0}>
											<h3>Recent errors</h3>
											<ul class="diagnostics-list">
												<For each={interp().recentErrors}>
													{(error) => (
														<li class="diagnostics-row is-warn">
															<p>{error}</p>
														</li>
													)}
												</For>
											</ul>
										</Show>
									</section>
								)}
							</Show>

							<section class="diagnostics-section">
								<h2>Recovery Actions</h2>
								<Show
									when={snapshot().recoveryActions.length > 0}
									fallback={<p>Nothing to fix right now.</p>}
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
