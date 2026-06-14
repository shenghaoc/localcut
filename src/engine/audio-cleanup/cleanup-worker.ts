/**
 * Audio Cleanup worker (Phase 28) — owns the LiteRT DTLN runtime and all
 * chunk processing. Lazily spawned by `src/ui/cleanup-bridge.ts` only when
 * the user opens the panel or starts a cleanup action; entirely separate
 * from the pipeline worker, which it never imports.
 *
 * Spawned as a **classic** worker (not ES module) because LiteRT.js loads
 * its WASM via `importScripts`.
 */

import type { CleanupWorkerCommand, CleanupWorkerState } from '../../protocol';
import { createOpfsAssetStore, loadVerifiedAsset } from '../asr/asset-cache';
import { AudioResampler } from '../audio-resampler';
import {
	CleanupCancelledError,
	CleanupJobProcessor,
	concatPcm,
	downmixToMono
} from './cleanup-jobs';
import { DtlnDsp, DTLN_BLOCK_SHIFT, DTLN_SAMPLE_RATE } from './dtln-dsp';
import { DtlnRuntime } from './dtln-runtime';
import { validateManifest, type CleanupModelManifest } from './model-manifest';
import { encodeWavPcm16 } from './wav';

const MAX_JOB_FRAMES = 90_000;

interface ActiveJob {
	jobId: number;
	totalFrames: number;
	processor: CleanupJobProcessor;
	resampler: AudioResampler | null;
	outputs: Float32Array[];
}

let runtime: DtlnRuntime | null = null;
let manifestData: CleanupModelManifest | null = null;
let job: ActiveJob | null = null;
let loadGeneration = 0;
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
	post({
		type: 'cleanup-probe-result',
		result: {
			wasmAvailable: typeof WebAssembly !== 'undefined',
			accelerator: runtime?.accelerator ?? 'wasm'
		}
	});
}

async function handleLoadModel(
	cmd: Extract<CleanupWorkerCommand, { type: 'cleanup-load-model' }>
): Promise<void> {
	const generation = ++loadGeneration;
	if (runtime) {
		post({
			type: 'cleanup-model-status',
			status: 'loaded',
			accelerator: runtime.accelerator,
			sizeBytes: manifestData?.sizeBytes
		});
		return;
	}
	post({ type: 'cleanup-model-status', status: 'loading' });
	try {
		const response = await fetch(cmd.manifestUrl);
		if (!response.ok) throw new Error(`Manifest fetch failed: HTTP ${response.status}`);
		const raw = await response.json();
		if (generation !== loadGeneration) return;

		const manifest = validateManifest(raw);
		manifestData = manifest;

		const store = await createOpfsAssetStore('cleanup-models');

		const [model1Bytes, model2Bytes] = await Promise.all([
			loadVerifiedAsset(manifest.model1, {
				store,
				onProgress: (p) =>
					post({
						type: 'cleanup-model-status',
						status: 'loading',
						sizeBytes: manifest.sizeBytes,
						error: `Downloading model 1… ${Math.round((p.receivedBytes / p.totalBytes) * 100)}%`
					})
			}),
			loadVerifiedAsset(manifest.model2, {
				store,
				onProgress: (p) =>
					post({
						type: 'cleanup-model-status',
						status: 'loading',
						sizeBytes: manifest.sizeBytes,
						error: `Downloading model 2… ${Math.round((p.receivedBytes / p.totalBytes) * 100)}%`
					})
			})
		]);
		if (generation !== loadGeneration) return;

		const loaded = await DtlnRuntime.create({
			wasmPath: cmd.wasmPath,
			accelerator: cmd.preferredAccelerator,
			model1Bytes,
			model2Bytes,
			stateShape: manifest.stateShape
		});
		if (generation !== loadGeneration) {
			loaded.destroy();
			post({ type: 'cleanup-cancelled' });
			return;
		}
		runtime = loaded;
		post({
			type: 'cleanup-model-status',
			status: 'loaded',
			accelerator: runtime.accelerator,
			sizeBytes: manifest.sizeBytes
		});
	} catch (error) {
		if (generation !== loadGeneration) return;
		post({ type: 'cleanup-model-status', status: 'failed', error: errorText(error) });
	}
}

function handleBegin(cmd: Extract<CleanupWorkerCommand, { type: 'cleanup-begin' }>): void {
	if (!runtime) {
		post({ type: 'cleanup-error', jobId: cmd.jobId, message: 'Cleanup model is not loaded.' });
		return;
	}
	const maxSeconds = Math.floor((MAX_JOB_FRAMES * DTLN_BLOCK_SHIFT) / DTLN_SAMPLE_RATE / 60);
	if (cmd.totalFrames > MAX_JOB_FRAMES) {
		post({
			type: 'cleanup-error',
			jobId: cmd.jobId,
			message: `Cleanup range too long (max ${maxSeconds} minutes per pass).`
		});
		return;
	}
	dropJob();
	const activeRuntime = runtime;
	activeRuntime.resetState();
	const jobId = cmd.jobId;
	const totalFrames = Math.max(1, cmd.totalFrames);
	const dsp = new DtlnDsp();
	const batchFrames = 100;
	const processor = new CleanupJobProcessor(dsp, activeRuntime, {
		batchFrames,
		onBatch: ({ processedFrames }) => {
			post({
				type: 'cleanup-progress',
				jobId,
				processedFrames: Math.min(processedFrames, totalFrames),
				totalFrames,
				fraction: Math.min(1, processedFrames / totalFrames)
			});
		}
	});
	job = { jobId, totalFrames, processor, resampler: null, outputs: [] };
}

async function handleChunk(
	cmd: Extract<CleanupWorkerCommand, { type: 'cleanup-chunk' }>
): Promise<void> {
	if (!job || job.jobId !== cmd.jobId) return;
	const active = job;
	try {
		let mono = downmixToMono(cmd.pcm, Math.max(1, cmd.channels));
		if (cmd.sampleRate !== DTLN_SAMPLE_RATE) {
			active.resampler ??= new AudioResampler({
				inputRate: cmd.sampleRate,
				outputRate: DTLN_SAMPLE_RATE,
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
			const wav = encodeWavPcm16(pcm, DTLN_SAMPLE_RATE, 1);
			post(
				{
					type: 'cleanup-result',
					jobId: cmd.jobId,
					sampleRate: DTLN_SAMPLE_RATE,
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
					sampleRate: DTLN_SAMPLE_RATE,
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
		loadGeneration += 1;
		dropJob();
		post({ type: 'cleanup-cancelled' });
		if (!runtime) post({ type: 'cleanup-model-status', status: 'not-loaded' });
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
	runtime?.destroy();
	runtime = null;
	self.close();
}

self.onmessage = (event: MessageEvent<CleanupWorkerCommand>) => {
	const cmd = event.data;
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
		} catch (error) {
			dropJob();
			try {
				post({ type: 'cleanup-error', message: errorText(error) });
			} catch {
				// Worker is being torn down.
			}
		}
	});
};
