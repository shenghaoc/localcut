import { describe, it, expect } from 'vite-plus/test';
import {
	createEmptyQueueState,
	createJob,
	enqueueJob,
	removeJob,
	reorderJob,
	advanceQueue,
	markJobChoosingDestination,
	markJobRunning,
	markJobFinalizing,
	markJobCompleted,
	markJobFailed,
	markJobCanceled,
	cancelAllPending,
	retryJob,
	setStopOnError,
	shouldStopQueueAfterJob,
	resolveJobRange,
	createJobsFromMarkers,
	serializeQueueHistory,
	deserializeQueueHistory,
	queueSummary,
	jobRangeLabel,
	suggestedFileNameForJob
} from './render-queue';
import type { ExportSettings, JobRange, RenderQueueState } from '../protocol';

const baseSettings: ExportSettings = {
	preset: 'quality',
	codec: 'h264',
	container: 'mp4',
	width: 1920,
	height: 1080,
	fps: 30,
	videoBitrate: 10_000_000
};

function enqueueN(state: RenderQueueState, n: number): RenderQueueState {
	for (let i = 0; i < n; i++) {
		state = enqueueJob(state, createJob(baseSettings, { mode: 'full' }, null, null));
	}
	return state;
}

describe('render-queue', () => {
	describe('enqueue and ordering', () => {
		it('enqueues jobs in order', () => {
			let state = createEmptyQueueState();
			const job1 = createJob(baseSettings, { mode: 'full' }, null, null);
			const job2 = createJob(baseSettings, { mode: 'full' }, null, null);
			state = enqueueJob(state, job1);
			state = enqueueJob(state, job2);
			expect(state.jobs.length).toBe(2);
			expect(state.jobs[0]!.id).toBe(job1.id);
			expect(state.jobs[1]!.id).toBe(job2.id);
		});

		it('reorders pending jobs', () => {
			let state = enqueueN(createEmptyQueueState(), 3);
			const ids = state.jobs.map((j) => j.id);
			state = reorderJob(state, ids[2]!, 0);
			expect(state.jobs[0]!.id).toBe(ids[2]);
			expect(state.jobs[1]!.id).toBe(ids[0]);
		});

		it('does not reorder running jobs', () => {
			let state = enqueueN(createEmptyQueueState(), 3);
			const id = state.jobs[0]!.id;
			state = markJobRunning(state, id);
			state = reorderJob(state, id, 2);
			expect(state.jobs[0]!.id).toBe(id);
		});

		it('removes pending jobs', () => {
			let state = enqueueN(createEmptyQueueState(), 3);
			const id = state.jobs[1]!.id;
			state = removeJob(state, id);
			expect(state.jobs.length).toBe(2);
			expect(state.jobs.every((j) => j.id !== id)).toBe(true);
		});

		it('does not remove running jobs', () => {
			let state = enqueueN(createEmptyQueueState(), 2);
			const id = state.jobs[0]!.id;
			state = markJobRunning(state, id);
			state = removeJob(state, id);
			expect(state.jobs.length).toBe(2);
		});

		it('does not remove finalizing jobs', () => {
			let state = enqueueN(createEmptyQueueState(), 2);
			const id = state.jobs[0]!.id;
			state = markJobRunning(state, id);
			state = markJobFinalizing(state, id);
			state = removeJob(state, id);
			expect(state.jobs.length).toBe(2);
		});
	});

	describe('advanceQueue', () => {
		it('picks the first pending job', () => {
			const state = enqueueN(createEmptyQueueState(), 3);
			const next = advanceQueue(state);
			expect(next).not.toBeNull();
			expect(next!.id).toBe(state.jobs[0]!.id);
		});

		it('returns null when a job is active', () => {
			let state = enqueueN(createEmptyQueueState(), 2);
			state = markJobRunning(state, state.jobs[0]!.id);
			expect(advanceQueue(state)).toBeNull();
		});

		it('returns null when no pending jobs exist', () => {
			expect(advanceQueue(createEmptyQueueState())).toBeNull();
		});

		it('skips completed/failed jobs', () => {
			let state = enqueueN(createEmptyQueueState(), 3);
			state = markJobCompleted(state, state.jobs[0]!.id, 'test.mp4', 10, null);
			state = markJobFailed(state, state.jobs[1]!.id, 'error');
			const next = advanceQueue(state);
			expect(next!.id).toBe(state.jobs[2]!.id);
		});
	});

	describe('cancel and retry', () => {
		it('canceled job does not block the next', () => {
			let state = enqueueN(createEmptyQueueState(), 3);
			state = markJobCanceled(state, state.jobs[0]!.id);
			const next = advanceQueue(state);
			expect(next!.id).toBe(state.jobs[1]!.id);
		});

		it('retried job re-enters pending', () => {
			let state = enqueueN(createEmptyQueueState(), 2);
			const failedId = state.jobs[0]!.id;
			state = markJobFailed(state, failedId, 'test error');
			state = retryJob(state, failedId);
			expect(state.jobs.length).toBe(3);
			const retried = state.jobs[1]!;
			expect(retried.status).toBe('pending');
			expect(retried.id).not.toBe(failedId);
			expect(retried.error).toBeNull();
		});

		it('retry does nothing for pending jobs', () => {
			let state = enqueueN(createEmptyQueueState(), 1);
			const id = state.jobs[0]!.id;
			state = retryJob(state, id);
			expect(state.jobs.length).toBe(1);
		});

		it('cancelAllPending cancels all pending but not completed', () => {
			let state = enqueueN(createEmptyQueueState(), 3);
			state = markJobCompleted(state, state.jobs[0]!.id, 'test.mp4', 5, null);
			state = cancelAllPending(state);
			expect(state.jobs[0]!.status).toBe('completed');
			expect(state.jobs[1]!.status).toBe('canceled');
			expect(state.jobs[2]!.status).toBe('canceled');
		});
	});

	describe('failure isolation', () => {
		it('with stopOnError=false, a failed job allows advance', () => {
			let state = enqueueN(createEmptyQueueState(), 3);
			state = markJobFailed(state, state.jobs[0]!.id, 'err');
			const next = advanceQueue(state);
			expect(next).not.toBeNull();
			expect(next!.id).toBe(state.jobs[1]!.id);
		});

		it('with stopOnError=true, old failed jobs do not block a new run', () => {
			let state = enqueueN(createEmptyQueueState(), 3);
			state = setStopOnError(state, true);
			state = markJobFailed(state, state.jobs[0]!.id, 'err');
			expect(advanceQueue(state)!.id).toBe(state.jobs[1]!.id);
		});

		it('with stopOnError=true, the job that just failed stops the run', () => {
			let state = enqueueN(createEmptyQueueState(), 3);
			state = setStopOnError(state, true);
			const failedId = state.jobs[0]!.id;
			state = markJobFailed(state, failedId, 'err');
			expect(shouldStopQueueAfterJob(state, failedId)).toBe(true);
			expect(shouldStopQueueAfterJob(state, state.jobs[1]!.id)).toBe(false);
		});

		it('retry can advance with stopOnError=true', () => {
			let state = enqueueN(createEmptyQueueState(), 1);
			state = setStopOnError(state, true);
			const failedId = state.jobs[0]!.id;
			state = markJobFailed(state, failedId, 'err');
			state = retryJob(state, failedId);
			const next = advanceQueue(state);
			expect(next).not.toBeNull();
			expect(next!.id).not.toBe(failedId);
		});
	});

	describe('resolveJobRange', () => {
		it('full returns undefined', () => {
			expect(resolveJobRange({ mode: 'full' })).toBeUndefined();
		});

		it('range returns ExportRange', () => {
			const range = resolveJobRange({ mode: 'range', startS: 5, endS: 10 });
			expect(range).toEqual({ startS: 5, endS: 10 });
		});

		it('markers returns resolved range', () => {
			const range = resolveJobRange({
				mode: 'markers',
				startMarkerId: 'm1',
				endMarkerId: 'm2',
				resolvedStartS: 3,
				resolvedEndS: 7
			});
			expect(range).toEqual({ startS: 3, endS: 7 });
		});
	});

	describe('createJobsFromMarkers', () => {
		it('creates N-1 jobs from N markers', () => {
			const markers = [
				{ id: 'm1', time: 0, label: 'A' },
				{ id: 'm2', time: 5, label: 'B' },
				{ id: 'm3', time: 10, label: 'C' },
				{ id: 'm4', time: 15, label: 'D' }
			];
			const jobs = createJobsFromMarkers(markers, baseSettings, 'preset-1', '{project}');
			expect(jobs.length).toBe(3);
			expect(jobs[0]!.jobRange).toEqual({
				mode: 'markers',
				startMarkerId: 'm1',
				endMarkerId: 'm2',
				resolvedStartS: 0,
				resolvedEndS: 5
			});
			expect(jobs[2]!.settings.range).toEqual({ startS: 10, endS: 15 });
		});

		it('returns 0 jobs for 1 marker', () => {
			const jobs = createJobsFromMarkers(
				[{ id: 'm1', time: 5, label: 'A' }],
				baseSettings,
				null,
				null
			);
			expect(jobs.length).toBe(0);
		});

		it('returns 0 jobs for 0 markers', () => {
			expect(createJobsFromMarkers([], baseSettings, null, null).length).toBe(0);
		});

		it('sorts markers by time before creating jobs', () => {
			const markers = [
				{ id: 'm2', time: 10, label: 'B' },
				{ id: 'm1', time: 5, label: 'A' }
			];
			const jobs = createJobsFromMarkers(markers, baseSettings, null, null);
			expect(jobs.length).toBe(1);
			expect(jobs[0]!.jobRange.mode).toBe('markers');
			const range = jobs[0]!.jobRange as Extract<JobRange, { mode: 'markers' }>;
			expect(range.resolvedStartS).toBe(5);
			expect(range.resolvedEndS).toBe(10);
		});
	});

	describe('persistence', () => {
		it('round-trips queue state through serialization', () => {
			let state = enqueueN(createEmptyQueueState(), 3);
			state = markJobCompleted(state, state.jobs[0]!.id, 'out.mp4', 12, 1024);
			state = markJobFailed(state, state.jobs[1]!.id, 'codec error');

			const persisted = serializeQueueHistory(state);
			const restored = deserializeQueueHistory(persisted);

			expect(restored.length).toBe(3);
			expect(restored[0]!.status).toBe('completed');
			expect(restored[1]!.status).toBe('failed');
			expect(restored[2]!.status).toBe('pending');
			expect(restored[2]!.progress).toBeNull();
		});

		it('marks interrupted running jobs as failed on deserialize', () => {
			let state = enqueueN(createEmptyQueueState(), 2);
			state = markJobRunning(state, state.jobs[0]!.id);
			const persisted = serializeQueueHistory(state);
			const restored = deserializeQueueHistory(persisted);
			expect(restored[0]!.status).toBe('failed');
			expect(restored[0]!.error).toContain('browser was closed');
		});

		it('choosing-destination jobs are marked failed on deserialize', () => {
			let state = enqueueN(createEmptyQueueState(), 1);
			state = markJobChoosingDestination(state, state.jobs[0]!.id);
			const persisted = serializeQueueHistory(state);
			const restored = deserializeQueueHistory(persisted);
			expect(restored[0]!.status).toBe('failed');
		});

		it('caps terminal history without reordering remaining jobs', () => {
			const jobs = Array.from({ length: 55 }, (_, index) => ({
				...createJob(baseSettings, { mode: 'full' }, null, null),
				id: `job-${index}`,
				status:
					index % 5 === 1
						? ('completed' as const)
						: index % 5 === 2
							? ('failed' as const)
							: index % 5 === 3
								? ('canceled' as const)
								: ('pending' as const)
			}));
			const state: RenderQueueState = { jobs, stopOnError: false, activeJobId: null };

			const persisted = serializeQueueHistory(state);
			const persistedIds = persisted.map((job) => job.id);
			const originalRelativeOrder = jobs
				.filter((job) => persistedIds.includes(job.id))
				.map((job) => job.id);

			expect(persisted).toHaveLength(50);
			expect(persistedIds).toEqual(originalRelativeOrder);
		});

		it('preserves pending jobs even when they exceed the terminal history cap', () => {
			const jobs = Array.from({ length: 60 }, (_, index) => ({
				...createJob(baseSettings, { mode: 'full' }, null, null),
				id: `pending-${index}`
			}));
			const state: RenderQueueState = { jobs, stopOnError: false, activeJobId: null };

			const persisted = serializeQueueHistory(state);

			expect(persisted).toHaveLength(60);
			expect(persisted.every((job) => job.status === 'pending')).toBe(true);
		});
	});

	describe('suggestedFileNameForJob', () => {
		it('expands preset templates and sanitizes invalid filename characters', () => {
			const job = createJob(
				baseSettings,
				{ mode: 'range', startS: 0, endS: 5 },
				'preset-1',
				'{project}/{preset}:{range}:{index}'
			);
			const fileName = suggestedFileNameForJob(
				job,
				[{ id: 'preset-1', name: 'Review?Preset', builtIn: false, ...baseSettings }],
				'Project:One',
				2
			);

			expect(fileName).toContain('Project_One_Review_Preset_00m00s-00m05s_2');
			expect(fileName.endsWith('.mp4')).toBe(true);
		});
	});

	describe('queueSummary', () => {
		it('counts completed, failed, canceled', () => {
			let state = enqueueN(createEmptyQueueState(), 5);
			state = markJobCompleted(state, state.jobs[0]!.id, 'a.mp4', 1, null);
			state = markJobCompleted(state, state.jobs[1]!.id, 'b.mp4', 2, null);
			state = markJobFailed(state, state.jobs[2]!.id, 'err');
			state = markJobCanceled(state, state.jobs[3]!.id);
			const summary = queueSummary(state);
			expect(summary.completedCount).toBe(2);
			expect(summary.failedCount).toBe(1);
			expect(summary.canceledCount).toBe(1);
		});
	});

	describe('jobRangeLabel', () => {
		it('returns "Full project" for full mode', () => {
			expect(jobRangeLabel({ mode: 'full' })).toBe('Full project');
		});

		it('formats range mode', () => {
			const label = jobRangeLabel({ mode: 'range', startS: 65, endS: 130 });
			expect(label).toBe('1:05 – 2:10');
		});

		it('formats marker mode with resolved times', () => {
			const label = jobRangeLabel({
				mode: 'markers',
				startMarkerId: 'm1',
				endMarkerId: 'm2',
				resolvedStartS: 0,
				resolvedEndS: 30
			});
			expect(label).toBe('0:00 – 0:30');
		});
	});

	describe('lifecycle transitions', () => {
		it('full lifecycle: pending → choosing → running → finalizing → completed', () => {
			let state = enqueueN(createEmptyQueueState(), 1);
			const id = state.jobs[0]!.id;

			expect(state.jobs[0]!.status).toBe('pending');
			state = markJobChoosingDestination(state, id);
			expect(state.jobs[0]!.status).toBe('choosing-destination');
			expect(state.activeJobId).toBe(id);

			state = markJobRunning(state, id);
			expect(state.jobs[0]!.status).toBe('running');
			expect(state.jobs[0]!.startedAt).not.toBeNull();

			state = markJobCompleted(state, id, 'output.mp4', 42, 1048576);
			expect(state.jobs[0]!.status).toBe('completed');
			expect(state.activeJobId).toBeNull();
			expect(state.jobs[0]!.elapsedSeconds).toBe(42);
			expect(state.jobs[0]!.outputBytes).toBe(1048576);
		});
	});
});
