import type {
  ExportProgress,
  ExportRange,
  ExportSettings,
  JobRange,
  JobStatus,
  PersistedQueueJob,
  RenderQueueJob,
  RenderQueueState,
  TimelineMarkerSnapshot,
} from '../protocol';
import type { TimelineMarker } from './timeline';

const MAX_QUEUE_HISTORY = 50;

function makeJobId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `job-${Math.random().toString(36).slice(2)}`;
}

export function createEmptyQueueState(): RenderQueueState {
  return { jobs: [], stopOnError: false, activeJobId: null };
}

export function createJob(
  settings: ExportSettings,
  jobRange: JobRange,
  presetId: string | null,
  outputTemplate: string | null,
): RenderQueueJob {
  return {
    id: makeJobId(),
    presetId,
    settings: { ...settings, range: settings.range ? { ...settings.range } : undefined },
    jobRange,
    outputTemplate,
    outputFileName: null,
    status: 'pending',
    error: null,
    progress: null,
    enqueuedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    elapsedSeconds: null,
    outputBytes: null,
  };
}

export function enqueueJob(state: RenderQueueState, job: RenderQueueJob): RenderQueueState {
  return { ...state, jobs: [...state.jobs, job] };
}

export function removeJob(state: RenderQueueState, jobId: string): RenderQueueState {
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job || job.status === 'running' || job.status === 'choosing-destination') return state;
  return { ...state, jobs: state.jobs.filter((j) => j.id !== jobId) };
}

export function reorderJob(state: RenderQueueState, jobId: string, newIndex: number): RenderQueueState {
  const idx = state.jobs.findIndex((j) => j.id === jobId);
  if (idx === -1) return state;
  const job = state.jobs[idx]!;
  if (job.status !== 'pending') return state;
  const jobs = state.jobs.filter((j) => j.id !== jobId);
  const clamped = Math.max(0, Math.min(newIndex, jobs.length));
  jobs.splice(clamped, 0, job);
  return { ...state, jobs };
}

export function advanceQueue(state: RenderQueueState): RenderQueueJob | null {
  if (state.activeJobId) return null;
  if (state.stopOnError && state.jobs.some((j) => j.status === 'failed')) return null;
  return state.jobs.find((j) => j.status === 'pending') ?? null;
}

export function markJobChoosingDestination(state: RenderQueueState, jobId: string): RenderQueueState {
  return {
    ...state,
    activeJobId: jobId,
    jobs: state.jobs.map((j) =>
      j.id === jobId ? { ...j, status: 'choosing-destination' as JobStatus } : j,
    ),
  };
}

export function markJobRunning(state: RenderQueueState, jobId: string): RenderQueueState {
  return {
    ...state,
    activeJobId: jobId,
    jobs: state.jobs.map((j) =>
      j.id === jobId
        ? { ...j, status: 'running' as JobStatus, startedAt: new Date().toISOString() }
        : j,
    ),
  };
}

export function markJobFinalizing(state: RenderQueueState, jobId: string): RenderQueueState {
  return {
    ...state,
    jobs: state.jobs.map((j) =>
      j.id === jobId ? { ...j, status: 'finalizing' as JobStatus } : j,
    ),
  };
}

export function markJobCompleted(
  state: RenderQueueState,
  jobId: string,
  fileName: string,
  elapsedSeconds: number,
  outputBytes: number | null,
): RenderQueueState {
  return {
    ...state,
    activeJobId: null,
    jobs: state.jobs.map((j) =>
      j.id === jobId
        ? {
            ...j,
            status: 'completed' as JobStatus,
            outputFileName: fileName,
            completedAt: new Date().toISOString(),
            elapsedSeconds,
            outputBytes,
            progress: null,
          }
        : j,
    ),
  };
}

export function markJobFailed(
  state: RenderQueueState,
  jobId: string,
  error: string,
): RenderQueueState {
  return {
    ...state,
    activeJobId: null,
    jobs: state.jobs.map((j) =>
      j.id === jobId
        ? {
            ...j,
            status: 'failed' as JobStatus,
            error,
            completedAt: new Date().toISOString(),
            progress: null,
          }
        : j,
    ),
  };
}

export function markJobCanceled(state: RenderQueueState, jobId: string): RenderQueueState {
  return {
    ...state,
    activeJobId: null,
    jobs: state.jobs.map((j) =>
      j.id === jobId
        ? { ...j, status: 'canceled' as JobStatus, completedAt: new Date().toISOString(), progress: null }
        : j,
    ),
  };
}

export function cancelAllPending(state: RenderQueueState): RenderQueueState {
  const now = new Date().toISOString();
  return {
    ...state,
    jobs: state.jobs.map((j) =>
      j.status === 'pending' ? { ...j, status: 'canceled' as JobStatus, completedAt: now, progress: null } : j,
    ),
  };
}

export function retryJob(state: RenderQueueState, jobId: string): RenderQueueState {
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job || (job.status !== 'failed' && job.status !== 'canceled')) return state;
  const retried: RenderQueueJob = {
    ...job,
    id: makeJobId(),
    status: 'pending',
    error: null,
    progress: null,
    outputFileName: null,
    startedAt: null,
    completedAt: null,
    elapsedSeconds: null,
    outputBytes: null,
    enqueuedAt: new Date().toISOString(),
  };
  const idx = state.jobs.findIndex((j) => j.id === jobId);
  const jobs = [...state.jobs];
  jobs.splice(idx + 1, 0, retried);
  return { ...state, jobs };
}

export function updateJobProgress(
  state: RenderQueueState,
  jobId: string,
  progress: ExportProgress,
): RenderQueueState {
  return {
    ...state,
    jobs: state.jobs.map((j) =>
      j.id === jobId ? { ...j, progress } : j,
    ),
  };
}

export function setStopOnError(state: RenderQueueState, stopOnError: boolean): RenderQueueState {
  return { ...state, stopOnError };
}

export function resolveJobRange(jobRange: JobRange): ExportRange | undefined {
  switch (jobRange.mode) {
    case 'full':
      return undefined;
    case 'range':
      return { startS: jobRange.startS, endS: jobRange.endS };
    case 'markers':
      return { startS: jobRange.resolvedStartS, endS: jobRange.resolvedEndS };
  }
}

export function createJobsFromMarkers(
  markers: readonly (TimelineMarker | TimelineMarkerSnapshot)[],
  settings: ExportSettings,
  presetId: string | null,
  outputTemplate: string | null,
): RenderQueueJob[] {
  if (markers.length < 2) return [];
  const sorted = [...markers].sort((a, b) => a.time - b.time);
  const jobs: RenderQueueJob[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i]!;
    const end = sorted[i + 1]!;
    if (end.time <= start.time) continue;
    const jobRange: JobRange = {
      mode: 'markers',
      startMarkerId: start.id,
      endMarkerId: end.id,
      resolvedStartS: start.time,
      resolvedEndS: end.time,
    };
    const rangedSettings: ExportSettings = {
      ...settings,
      range: { startS: start.time, endS: end.time },
    };
    jobs.push(createJob(rangedSettings, jobRange, presetId, outputTemplate));
  }
  return jobs;
}

export function queueJobToPersistedJob(job: RenderQueueJob): PersistedQueueJob {
  return {
    id: job.id,
    presetId: job.presetId,
    settings: { ...job.settings, range: job.settings.range ? { ...job.settings.range } : undefined },
    jobRange: { ...job.jobRange } as JobRange,
    outputTemplate: job.outputTemplate,
    outputFileName: job.outputFileName,
    status: job.status,
    error: job.error,
    enqueuedAt: job.enqueuedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    elapsedSeconds: job.elapsedSeconds,
    outputBytes: job.outputBytes,
  };
}

export function persistedJobToQueueJob(persisted: PersistedQueueJob): RenderQueueJob {
  let status = persisted.status;
  if (status === 'running' || status === 'choosing-destination' || status === 'finalizing') {
    status = 'failed';
  }
  return {
    ...persisted,
    status,
    error: status === 'failed' && !persisted.error ? 'Export interrupted — browser was closed' : persisted.error,
    progress: null,
  };
}

export function serializeQueueHistory(state: RenderQueueState): PersistedQueueJob[] {
  const persisted = state.jobs.map(queueJobToPersistedJob);
  return enforceHistoryCap(persisted);
}

export function deserializeQueueHistory(jobs: PersistedQueueJob[]): RenderQueueJob[] {
  return jobs.map(persistedJobToQueueJob);
}

function enforceHistoryCap(jobs: PersistedQueueJob[]): PersistedQueueJob[] {
  if (jobs.length <= MAX_QUEUE_HISTORY) return jobs;
  const pending = jobs.filter((j) => j.status === 'pending');
  const completed = jobs.filter((j) => j.status === 'completed');
  const failed = jobs.filter((j) => j.status === 'failed');
  const canceled = jobs.filter((j) => j.status === 'canceled');
  const other = jobs.filter((j) =>
    j.status !== 'pending' && j.status !== 'completed' && j.status !== 'failed' && j.status !== 'canceled',
  );

  let result = [...pending, ...other, ...failed, ...canceled, ...completed];
  while (result.length > MAX_QUEUE_HISTORY) {
    const oldestCompletedIdx = result.findIndex((j) => j.status === 'completed');
    if (oldestCompletedIdx !== -1) {
      result.splice(oldestCompletedIdx, 1);
      continue;
    }
    const oldestFailedIdx = result.findIndex((j) => j.status === 'failed');
    if (oldestFailedIdx !== -1) {
      result.splice(oldestFailedIdx, 1);
      continue;
    }
    result.pop();
  }
  return result;
}

export function queueSummary(state: RenderQueueState): {
  completedCount: number;
  failedCount: number;
  canceledCount: number;
} {
  let completedCount = 0;
  let failedCount = 0;
  let canceledCount = 0;
  for (const job of state.jobs) {
    if (job.status === 'completed') completedCount++;
    else if (job.status === 'failed') failedCount++;
    else if (job.status === 'canceled') canceledCount++;
  }
  return { completedCount, failedCount, canceledCount };
}

export function jobRangeLabel(jobRange: JobRange): string {
  switch (jobRange.mode) {
    case 'full': return 'Full project';
    case 'range': return `${fmtTime(jobRange.startS)} – ${fmtTime(jobRange.endS)}`;
    case 'markers': return `${fmtTime(jobRange.resolvedStartS)} – ${fmtTime(jobRange.resolvedEndS)}`;
  }
}

function fmtTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
