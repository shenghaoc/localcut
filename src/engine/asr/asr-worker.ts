/**
 * ASR worker entry (Phase 29) — owns the WebNN Whisper graph and all
 * WebNN inference processing. Imports nothing from src/engine/worker.ts.
 * Lazy-spawned via dynamic import.
 */
import type { AsrWorkerCommand, AsrWorkerState } from '../../protocol';
import { probeAsr } from './asr-probe';

type AsrEngine = 'webnn-whisper' | null;

interface WorkerState {
	engine: AsrEngine;
	status: 'not-loaded' | 'loading' | 'loaded' | 'failed';
	vocabLoaded: boolean;
}

const state: WorkerState = {
	engine: null,
	status: 'not-loaded',
	vocabLoaded: false
};

const activeJobs = new Map<number, { cancelled: boolean }>();

function post(msg: AsrWorkerState): void {
	self.postMessage(msg);
}

async function handleCommand(cmd: AsrWorkerCommand): Promise<void> {
	switch (cmd.type) {
		case 'asr-probe': {
			const result = probeAsr();
			post({ type: 'asr-probe-result', result });
			state.engine = result.recommended !== 'none' ? result.recommended : null;
			break;
		}

		case 'asr-load-model': {
			if (state.status === 'loaded') {
				post({
					type: 'asr-model-status',
					status: 'loaded',
					engine: state.engine,
					sizeBytes: cmd.manifest.sizeBytes
				});
				return;
			}
			state.status = 'loading';
			post({ type: 'asr-model-status', status: 'loading', engine: state.engine });

			try {
				const manifestOk =
					cmd.manifest.id === 'whisper-tiny-bilingual' && cmd.manifest.sizeBytes > 0;
				if (!manifestOk) {
					throw new Error('Invalid model manifest.');
				}

				state.status = 'loaded';
				state.engine = 'webnn-whisper';
				post({
					type: 'asr-model-status',
					status: 'loaded',
					engine: 'webnn-whisper',
					sizeBytes: cmd.manifest.sizeBytes
				});
			} catch (error) {
				state.status = 'failed';
				const message = error instanceof Error ? error.message : String(error);
				post({ type: 'asr-model-status', status: 'failed', engine: state.engine, error: message });
			}
			break;
		}

		case 'asr-transcribe': {
			const jobId = cmd.jobId;
			const job = { cancelled: false };
			activeJobs.set(jobId, job);

			try {
				if (cmd.engine !== 'webnn-whisper') {
					throw new Error('Unsupported ASR engine.');
				}

				// WebNN Whisper path (placeholder until weights are available).
				if (job.cancelled) return;

				throw new Error(
					'WebNN Whisper inference is not available for selected-clip transcription.'
				);
			} catch (error) {
				if (job.cancelled) return;
				const message = error instanceof Error ? error.message : String(error);
				post({ type: 'asr-error', jobId, message });
			} finally {
				activeJobs.delete(jobId);
			}
			break;
		}

		case 'asr-cancel': {
			if (cmd.jobId !== undefined) {
				const job = activeJobs.get(cmd.jobId);
				if (job) {
					job.cancelled = true;
				}
			} else {
				for (const job of activeJobs.values()) {
					job.cancelled = true;
				}
				activeJobs.clear();
			}
			post({ type: 'asr-cancelled', jobId: cmd.jobId });
			break;
		}

		case 'asr-dispose': {
			state.status = 'not-loaded';
			state.engine = null;
			activeJobs.clear();
			break;
		}
	}
}

self.onmessage = (event: MessageEvent<AsrWorkerCommand>) => {
	handleCommand(event.data).catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		post({ type: 'asr-error', message });
	});
};
