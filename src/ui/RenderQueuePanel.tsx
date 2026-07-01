import { createMemo, For, Show } from 'solid-js';
import { Play, X, RotateCcw, Trash2, Square } from 'lucide-solid';
import { Button } from './components/button';
import type { RenderQueueState, RenderQueueJob } from '../protocol';
import { jobRangeLabel } from '../engine/render-queue';

interface RenderQueuePanelProps {
	queue: RenderQueueState;
	onStart: () => void;
	onCancelJob: (jobId: string) => void;
	onCancelAll: () => void;
	onRetry: (jobId: string) => void;
	onRemove: (jobId: string) => void;
	onSetStopOnError: (stopOnError: boolean) => void;
}

function statusBadge(status: RenderQueueJob['status']): string {
	switch (status) {
		case 'pending':
			return 'Pending';
		case 'choosing-destination':
			return 'Choosing file…';
		case 'running':
			return 'Running';
		case 'finalizing':
			return 'Finalizing';
		case 'completed':
			return 'Done';
		case 'failed':
			return 'Failed';
		case 'canceled':
			return 'Canceled';
	}
}

function statusClass(status: RenderQueueJob['status']): string {
	switch (status) {
		case 'completed':
			return 'queue-status-done';
		case 'failed':
			return 'queue-status-failed';
		case 'canceled':
			return 'queue-status-canceled';
		case 'running':
		case 'finalizing':
			return 'queue-status-running';
		default:
			return 'queue-status-pending';
	}
}

function codecLabel(codec: string): string {
	switch (codec) {
		case 'h264':
			return 'H.264';
		case 'vp9':
			return 'VP9';
		case 'av1':
			return 'AV1';
		default:
			return codec;
	}
}

function formatElapsed(seconds: number | null): string {
	if (seconds === null) return '';
	const rounded = Math.round(seconds);
	const mins = Math.floor(rounded / 60);
	const secs = rounded % 60;
	if (mins === 0) return `${secs}s`;
	return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

export function RenderQueuePanel(props: RenderQueuePanelProps) {
	const pendingCount = createMemo(
		() => props.queue.jobs.filter((j) => j.status === 'pending').length
	);
	const completedCount = createMemo(
		() => props.queue.jobs.filter((j) => j.status === 'completed').length
	);
	const hasActive = createMemo(() => props.queue.activeJobId !== null);
	const hasPending = createMemo(() => pendingCount() > 0);
	const totalJobs = createMemo(() => props.queue.jobs.length);

	return (
		<Show when={totalJobs() > 0}>
			<section class="render-queue-panel" aria-label="Render Queue">
				<div class="render-queue-header">
					<h3 class="render-queue-title">
						Render Queue{' '}
						<span class="text-xs text-muted-foreground font-normal">(Experimental)</span>
						<span class="render-queue-count">
							{completedCount()}/{totalJobs()}
						</span>
					</h3>
					<div class="render-queue-controls">
						<label class="render-queue-stop-on-error">
							<input
								type="checkbox"
								checked={props.queue.stopOnError}
								onChange={(e) => props.onSetStopOnError(e.currentTarget.checked)}
							/>
							<span>Stop on error</span>
						</label>
						<Show when={hasPending() && !hasActive()}>
							<Button variant="default" onClick={() => props.onStart()}>
								<Play size={12} aria-hidden="true" />
								Start
							</Button>
						</Show>
						<Show when={hasActive()}>
							<Button onClick={() => props.onCancelAll()}>
								<Square size={12} aria-hidden="true" />
								Stop
							</Button>
						</Show>
					</div>
				</div>

				<div class="render-queue-list" role="list">
					<For each={props.queue.jobs}>
						{(job) => (
							<div
								class={`render-queue-job ${statusClass(job.status)}`}
								role="listitem"
								aria-label={`${codecLabel(job.settings.codec)} ${jobRangeLabel(job.jobRange)}`}
							>
								<div class="render-queue-job-main">
									<div class="render-queue-job-info">
										<span class="render-queue-job-codec">
											{codecLabel(job.settings.codec)} · {job.settings.container.toUpperCase()}
										</span>
										<span class="render-queue-job-range">{jobRangeLabel(job.jobRange)}</span>
										<span class="render-queue-job-res">
											{job.settings.width}×{job.settings.height}
										</span>
									</div>
									<div class="render-queue-job-status">
										<span class={`render-queue-badge ${statusClass(job.status)}`}>
											{statusBadge(job.status)}
										</span>
										<Show when={job.status === 'completed' && job.elapsedSeconds !== null}>
											<span class="render-queue-job-elapsed">
												{formatElapsed(job.elapsedSeconds)}
											</span>
										</Show>
									</div>
								</div>

								<Show when={job.status === 'running' && job.progress}>
									<div class="render-queue-job-progress">
										<progress max="1" value={job.progress!.percent} />
										<span class="tabular-nums">{Math.round(job.progress!.percent * 100)}%</span>
									</div>
								</Show>

								<Show when={job.error}>
									<p class="render-queue-job-error">{job.error}</p>
								</Show>

								<Show when={job.coverExportError}>
									<p class="render-queue-job-cover-warning">
										Cover export failed: {job.coverExportError}
									</p>
								</Show>

								<Show when={job.status === 'completed' && job.outputFileName}>
									<p class="render-queue-job-output">{job.outputFileName}</p>
								</Show>

								<div class="render-queue-job-actions">
									<Show
										when={
											job.status !== 'running' &&
											job.status !== 'choosing-destination' &&
											job.status !== 'finalizing'
										}
									>
										<button
											type="button"
											class="render-queue-icon-btn"
											aria-label="Remove job"
											title="Remove job"
											onClick={() => props.onRemove(job.id)}
										>
											<Trash2 size={13} />
										</button>
									</Show>
									<Show when={job.status === 'running' || job.status === 'choosing-destination'}>
										<button
											type="button"
											class="render-queue-icon-btn"
											aria-label="Cancel job"
											title="Cancel job"
											onClick={() => props.onCancelJob(job.id)}
										>
											<X size={13} />
										</button>
									</Show>
									<Show when={job.status === 'failed' || job.status === 'canceled'}>
										<button
											type="button"
											class="render-queue-icon-btn"
											aria-label="Retry job"
											title="Retry job"
											onClick={() => props.onRetry(job.id)}
										>
											<RotateCcw size={13} />
										</button>
									</Show>
								</div>
							</div>
						)}
					</For>
				</div>
			</section>
		</Show>
	);
}
