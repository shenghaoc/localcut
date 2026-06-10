/**
 * Audio Cleanup worker (Phase 27) — owns the WebNN context, the RNNoise graph,
 * and all chunk processing. Lazily spawned by `src/ui/cleanup-bridge.ts` only
 * when the user opens the panel or starts a cleanup action; entirely separate
 * from the pipeline worker, which it never imports.
 *
 * Everything here is local-only: weights load same-origin on explicit command,
 * audio never leaves the device, and there is no cloud fallback of any kind.
 */

import type { CleanupWorkerCommand, CleanupWorkerState } from '../../protocol';
import { AudioResampler } from '../audio-resampler';
import {
	CleanupCancelledError,
	CleanupJobProcessor,
	concatPcm,
	downmixToMono
} from './cleanup-jobs';
import {
	RNNOISE_FRAME_SIZE,
	RNNOISE_SAMPLE_RATE,
	unpackWeights,
	validateManifest,
	verifyWeights
} from './model-manifest';
import { RnnoiseDsp } from './rnnoise-dsp';
import { RnnoiseModel } from './rnnoise-graph';
import { encodeWavPcm16 } from './wav';
import { probeWebNN } from './webnn-probe';

/** Hard upper bound on a single job (15 min @ 48 kHz) to bound memory. */
const MAX_JOB_FRAMES = 90_000;

interface ActiveJob {
	jobId: number;
	totalFrames: number;
	processor: CleanupJobProcessor;
	resampler: AudioResampler | null;
	outputs: Float32Array[];
}

let model: RnnoiseModel | null = null;
let modelSizeBytes = 0;
let job: ActiveJob | null = null;
/** Bumped by cancel/dispose so awaited work from a stale generation is dropped. */
let loadGeneration = 0;
/** Serializes async command handling (worker messages can outpace inference). */
let queue: Promise<void> = Promise.resolve();

function post(message: CleanupWorkerState, transfer?: Transferable[]): void {
	if (transfer?.length) {
		(self as unknown as Worker).postMessage(message, transfer);
	} else {
		(self as unknown as Worker).postMessage(message);
	}
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function dropJob(): void {
	if (!job) return;
	job.processor.abort();
	job.outputs.length = 0;
	job = null;
}

async function handleProbe(): Promise<void> {
	const result = await probeWebNN(self.navigator as { ml?: ML });
	if (model) result.modelSupport = 'supported';
	post({ type: 'cleanup-probe-result', result });
}

async function handleLoadModel(
	cmd: Extract<CleanupWorkerCommand, { type: 'cleanup-load-model' }>
): Promise<void> {
	const generation = ++loadGeneration;
	if (model) {
		post({
			type: 'cleanup-model-status',
			status: 'loaded',
			backend: model.deviceType,
			sizeBytes: modelSizeBytes
		});
		return;
	}
	post({ type: 'cleanup-model-status', status: 'loading' });
	try {
		const ml = (self.navigator as { ml?: ML }).ml;
		if (!ml) throw new Error('WebNN (navigator.ml) is unavailable in this browser.');
		const manifest = validateManifest(cmd.manifest);
		const response = await fetch(cmd.weightsUrl);
		if (!response.ok) {
			throw new Error(`Weights fetch failed: HTTP ${response.status}`);
		}
		const bytes = await response.arrayBuffer();
		if (generation !== loadGeneration) return; // cancelled while fetching
		await verifyWeights(manifest, bytes);
		const weights = unpackWeights(manifest, bytes);
		const loaded = await RnnoiseModel.create(
			ml,
			weights,
			/* frames */ 100,
			cmd.preferredBackends.length > 0 ? cmd.preferredBackends : ['npu', 'gpu', 'cpu']
		);
		if (generation !== loadGeneration) {
			loaded.destroy();
			post({ type: 'cleanup-cancelled' });
			return;
		}
		model = loaded;
		modelSizeBytes = manifest.sizeBytes;
		post({
			type: 'cleanup-model-status',
			status: 'loaded',
			backend: model.deviceType,
			sizeBytes: modelSizeBytes
		});
	} catch (error) {
		if (generation !== loadGeneration) return;
		post({ type: 'cleanup-model-status', status: 'failed', error: errorText(error) });
	}
}

function handleBegin(cmd: Extract<CleanupWorkerCommand, { type: 'cleanup-begin' }>): void {
	if (!model) {
		post({ type: 'cleanup-error', jobId: cmd.jobId, message: 'Cleanup model is not loaded.' });
		return;
	}
	if (cmd.totalFrames > MAX_JOB_FRAMES) {
		post({
			type: 'cleanup-error',
			jobId: cmd.jobId,
			message: `Cleanup range too long (max ${Math.floor((MAX_JOB_FRAMES * RNNOISE_FRAME_SIZE) / RNNOISE_SAMPLE_RATE / 60)} minutes per pass).`
		});
		return;
	}
	dropJob();
	const activeModel = model;
	activeModel.resetState();
	const jobId = cmd.jobId;
	const totalFrames = Math.max(1, cmd.totalFrames);
	const processor = new CleanupJobProcessor(
		new RnnoiseDsp(),
		{ infer: (features) => activeModel.infer(features) },
		{
			batchFrames: activeModel.batchFrames,
			onBatch: ({ processedFrames }) => {
				post({
					type: 'cleanup-progress',
					jobId,
					processedFrames: Math.min(processedFrames, totalFrames),
					totalFrames,
					fraction: Math.min(1, processedFrames / totalFrames)
				});
			}
		}
	);
	job = { jobId, totalFrames, processor, resampler: null, outputs: [] };
}

async function handleChunk(
	cmd: Extract<CleanupWorkerCommand, { type: 'cleanup-chunk' }>
): Promise<void> {
	if (!job || job.jobId !== cmd.jobId) return; // stale chunk after cancel
	const active = job;
	try {
		let mono = downmixToMono(cmd.pcm, Math.max(1, cmd.channels));
		if (cmd.sampleRate !== RNNOISE_SAMPLE_RATE) {
			active.resampler ??= new AudioResampler({
				inputRate: cmd.sampleRate,
				outputRate: RNNOISE_SAMPLE_RATE,
				channels: 1
			});
			mono = active.resampler.process(mono, mono.length);
		}
		const out = await active.processor.push(mono);
		if (job === active && out.length > 0) active.outputs.push(out);
	} catch (error) {
		if (error instanceof CleanupCancelledError) return;
		dropJob();
		post({ type: 'cleanup-error', jobId: cmd.jobId, message: errorText(error) });
	}
}

async function handleEnd(
	cmd: Extract<CleanupWorkerCommand, { type: 'cleanup-end' }>
): Promise<void> {
	if (!job || job.jobId !== cmd.jobId) return;
	const active = job;
	const startedAt = performance.now();
	try {
		if (active.resampler) {
			const tail = active.resampler.flush();
			if (tail.length > 0) {
				const out = await active.processor.push(tail);
				if (out.length > 0) active.outputs.push(out);
			}
		}
		const finalOut = await active.processor.finalize();
		if (finalOut.length > 0) active.outputs.push(finalOut);
		const pcm = concatPcm(active.outputs);
		job = null;
		const durationMs = performance.now() - startedAt;
		if (cmd.output === 'wav') {
			const wav = encodeWavPcm16(pcm, RNNOISE_SAMPLE_RATE, 1);
			post(
				{
					type: 'cleanup-result',
					jobId: cmd.jobId,
					sampleRate: RNNOISE_SAMPLE_RATE,
					channels: 1,
					wav,
					durationMs
				},
				[wav]
			);
		} else {
			post(
				{
					type: 'cleanup-result',
					jobId: cmd.jobId,
					sampleRate: RNNOISE_SAMPLE_RATE,
					channels: 1,
					pcm,
					durationMs
				},
				[pcm.buffer]
			);
		}
	} catch (error) {
		dropJob();
		if (error instanceof CleanupCancelledError) return;
		post({ type: 'cleanup-error', jobId: cmd.jobId, message: errorText(error) });
	}
}

function handleCancel(cmd: Extract<CleanupWorkerCommand, { type: 'cleanup-cancel' }>): void {
	if (cmd.jobId === undefined) {
		loadGeneration += 1; // also abandons an in-flight model load
		dropJob();
		post({ type: 'cleanup-cancelled' });
		if (!model) post({ type: 'cleanup-model-status', status: 'not-loaded' });
		return;
	}
	if (job && job.jobId === cmd.jobId) {
		dropJob();
		post({ type: 'cleanup-cancelled', jobId: cmd.jobId });
	}
}

function handleDispose(): void {
	loadGeneration += 1;
	dropJob();
	model?.destroy();
	model = null;
	self.close();
}

self.onmessage = (event: MessageEvent<CleanupWorkerCommand>) => {
	const cmd = event.data;
	// Cancel and dispose act immediately; everything else runs serialized so
	// chunk processing for one job never interleaves.
	if (cmd.type === 'cleanup-cancel') {
		handleCancel(cmd);
		return;
	}
	if (cmd.type === 'cleanup-dispose') {
		handleDispose();
		return;
	}
	queue = queue.then(async () => {
		try {
			switch (cmd.type) {
				case 'cleanup-probe':
					await handleProbe();
					break;
				case 'cleanup-load-model':
					await handleLoadModel(cmd);
					break;
				case 'cleanup-begin':
					handleBegin(cmd);
					break;
				case 'cleanup-chunk':
					await handleChunk(cmd);
					break;
				case 'cleanup-end':
					await handleEnd(cmd);
					break;
			}
		} catch {
			// An unhandled rejection would break the promise chain permanently,
			// skipping every subsequent command. Absorb the error so the queue
			// stays alive.
		}
	});
};
