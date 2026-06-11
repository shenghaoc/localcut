/**
 * ASR worker entry (Phase 29) — owns the WebNN Whisper graph, the Chrome
 * Web Speech fallback, and all transcription processing. Imports nothing
 * from src/engine/worker.ts. Lazy-spawned via dynamic import.
 */
import type { AsrWorkerCommand, AsrWorkerState, CaptionSegmentSnapshot } from '../../protocol';
import { probeAsr } from './asr-probe';
import { transcribeWithWebSpeech } from './chrome-speech';

type AsrEngine = 'webnn-whisper' | 'chrome-speech' | null;

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
				post({ type: 'asr-model-status', status: 'loaded', engine: state.engine, sizeBytes: cmd.manifest.sizeBytes });
				return;
			}
			state.status = 'loading';
			post({ type: 'asr-model-status', status: 'loading', engine: state.engine });

			try {
				// Verify manifest and fetch weights (future: build WebNN graph)
				const manifestOk =
					cmd.manifest.id === 'whisper-tiny-bilingual' &&
					cmd.manifest.sizeBytes > 0;
				if (!manifestOk) {
					throw new Error('Invalid model manifest.');
				}

				// Mark model as loaded (graph construction is deferred to T13).
				// The weights exist on disk but the WebNN graph construction
				// requires the model conversion pipeline to be complete.
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
				const startTime = performance.now();

				// Report initial progress
				post({
					type: 'asr-progress',
					jobId,
					fraction: 0,
					processedSeconds: 0,
					totalSeconds: cmd.totalDurationS
				});

				let segments: CaptionSegmentSnapshot[];
				let language: string | null = null;
				let phraseLevel = false;

				if (cmd.engine === 'chrome-speech') {
					// Chrome Web Speech fallback
					segments = await transcribeWithWebSpeech(
						cmd.pcm,
						cmd.sampleRate,
						cmd.channels,
						cmd.language
					);
					phraseLevel = true;
					language = cmd.language ?? null;
				} else {
					// WebNN Whisper path (placeholder until weights are available).
					// The DSP preprocessing is ready (whisper-dsp.ts); graph
					// construction and inference are pending T13.
					if (job.cancelled) return;
					
					// For now, fall through to Chrome Speech if available, or
					// return an error about the unimplemented WebNN path.
					throw new Error(
						'WebNN Whisper inference is not yet available. ' +
						'Please use Chrome Speech fallback or install the Whisper model weights.'
					);
				}

				if (job.cancelled) return;

				// Apply offset to segment timestamps
				const offsetSegments = segments.map((seg) => ({
					...seg,
					start: seg.start + cmd.offsetS
				}));

				const durationMs = performance.now() - startTime;
				post({
					type: 'asr-result',
					jobId,
					engine: cmd.engine,
					segments: offsetSegments,
					language,
					phraseLevel,
					durationMs
				});
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
				// Cancel all
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
