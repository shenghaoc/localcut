/// <reference lib="webworker" />
/**
 * ASR worker entry (Phase 29) — owns the LiteRT.js Whisper runtime and all
 * inference. Imports nothing from src/engine/worker.ts and is lazy-spawned via
 * dynamic import, so neither the WASM runtime nor any model asset enters the
 * app's startup module graph.
 *
 * Transcription windows are processed through a serial promise chain so they are
 * decoded in arrival order regardless of `await` interleaving across messages.
 */
import type {
	AsrAccelerator,
	AsrModelManifestSnapshot,
	AsrModelStatus,
	AsrWorkerCommand,
	AsrWorkerState,
	CaptionSegmentSnapshot
} from '../../protocol';
import { probeAsr } from './asr-probe';
import { manifestAssets, validateAsrManifest } from './model-manifest';
import { createOpfsAssetStore, loadVerifiedAsset } from './asset-cache';
import { assertTrustedModelUrl } from './model-catalog';
import { parseWhisperVocab } from './whisper-tokenizer';
import { prepareMonoPcm } from './whisper-dsp';
import {
	clipSegmentsToTrustedRange,
	DecodeCancelledError,
	deduplicateSegments,
	dropAdjacentRepeatedSegments,
	filterHallucinations,
	isEmptyTranscript,
	transcribeWindow
} from './whisper-decode';
import { createLiteRtWhisperRuntime, type LiteRtWhisperRuntime } from './litert-runtime';

interface LoadedModel {
	runtime: LiteRtWhisperRuntime;
	/** id → byte-level token string. */
	vocab: string[];
	manifest: AsrModelManifestSnapshot;
	accelerator: AsrAccelerator;
}

interface JobState {
	jobId: number;
	cancelled: boolean;
	segments: CaptionSegmentSnapshot[];
	language: string | null;
	processedSeconds: number;
	startedAt: number;
}

let model: LoadedModel | null = null;
let status: AsrModelStatus = 'not-loaded';
let loadGeneration = 0;
let loadAbortController: AbortController | null = null;
const jobs = new Map<number, JobState>();
const tombstonedJobIds = new Set<number>();
/** Serial tail for load + transcribe so windows never overlap. */
let chain: Promise<void> = Promise.resolve();

function post(msg: AsrWorkerState): void {
	self.postMessage(msg);
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function enqueue(task: () => Promise<void>): void {
	chain = chain.then(task).catch((error) => {
		post({ type: 'asr-error', message: errorText(error) });
	});
}

async function handleLoad(
	cmd: Extract<AsrWorkerCommand, { type: 'asr-load-model' }>
): Promise<void> {
	if (status === 'loaded' && model) {
		post({
			type: 'asr-model-status',
			status: 'loaded',
			accelerator: model.accelerator,
			sizeBytes: model.manifest.sizeBytes,
			fraction: 1
		});
		return;
	}
	const generation = ++loadGeneration;
	loadAbortController?.abort();
	loadAbortController = new AbortController();
	const { signal } = loadAbortController;
	status = 'loading';
	post({ type: 'asr-model-status', status: 'loading', accelerator: cmd.accelerator, fraction: 0 });

	try {
		if (typeof WebAssembly === 'undefined') {
			throw new Error('WebAssembly is unavailable in this browser; LiteRT cannot run.');
		}

		const origin = self.location.origin;
		// Model assets run as code — fetch them only from this origin or an
		// allowlisted, reputable model host, never an arbitrary manifest URL.
		assertTrustedModelUrl(cmd.manifestUrl, origin);
		const manifestResponse = await fetch(cmd.manifestUrl, { signal });
		if (!manifestResponse.ok) {
			throw new Error(`Model manifest fetch failed: HTTP ${manifestResponse.status}`);
		}
		const manifest = validateAsrManifest(await manifestResponse.json());
		const store = await createOpfsAssetStore();

		const total = manifest.sizeBytes;
		const downloaded: Record<string, number> = {};
		const bytesByKey: Partial<Record<'model' | 'tokenizer', Uint8Array>> = {};
		let fromNetwork = false;
		for (const { key, asset } of manifestAssets(manifest)) {
			assertTrustedModelUrl(asset.url, origin);
			const bytes = await loadVerifiedAsset(asset, {
				store,
				signal,
				onSource: (source) => {
					if (source === 'network') fromNetwork = true;
				},
				onProgress: (progress) => {
					if (generation !== loadGeneration) return;
					downloaded[key] = progress.receivedBytes;
					const sum = Object.values(downloaded).reduce((a, b) => a + b, 0);
					post({
						type: 'asr-model-status',
						status: 'loading',
						accelerator: cmd.accelerator,
						sizeBytes: total,
						downloadedBytes: sum,
						fraction: Math.min(sum / total, 0.99)
					});
				}
			});
			if (generation !== loadGeneration) return; // disposed/reloaded mid-fetch
			bytesByKey[key] = bytes;
		}

		// Compiling the graphs is the last (un-measured) step before ready.
		post({
			type: 'asr-model-status',
			status: 'loading',
			accelerator: cmd.accelerator,
			sizeBytes: total,
			downloadedBytes: total,
			fraction: 0.99
		});

		const runtime = await createLiteRtWhisperRuntime({
			wasmPath: cmd.wasmPath,
			accelerator: cmd.accelerator,
			modelBytes: bytesByKey.model!,
			manifest
		});
		if (generation !== loadGeneration) {
			runtime.dispose();
			return;
		}

		const vocab = parseWhisperVocab(new TextDecoder().decode(bytesByKey.tokenizer!));
		model = { runtime, vocab, manifest, accelerator: runtime.accelerator };
		status = 'loaded';
		post({
			type: 'asr-model-status',
			status: 'loaded',
			accelerator: runtime.accelerator,
			sizeBytes: total,
			fraction: 1,
			cached: !fromNetwork
		});
	} catch (error) {
		if (generation !== loadGeneration || signal.aborted) return;
		status = 'failed';
		post({
			type: 'asr-model-status',
			status: 'failed',
			accelerator: cmd.accelerator,
			error: errorText(error)
		});
	} finally {
		if (loadAbortController?.signal === signal) loadAbortController = null;
	}
}

async function handleTranscribe(
	cmd: Extract<AsrWorkerCommand, { type: 'asr-transcribe' }>
): Promise<void> {
	if (tombstonedJobIds.has(cmd.jobId)) return;
	let job = jobs.get(cmd.jobId);
	if (!job) {
		job = {
			jobId: cmd.jobId,
			cancelled: false,
			segments: [],
			language: null,
			processedSeconds: 0,
			startedAt: performance.now()
		};
		jobs.set(cmd.jobId, job);
	}
	if (job.cancelled) return;

	const activeModel = model;
	if (!activeModel) {
		jobs.delete(cmd.jobId);
		tombstonedJobIds.add(cmd.jobId);
		post({ type: 'asr-error', jobId: cmd.jobId, message: 'ASR model is not loaded.' });
		return;
	}

	try {
		const mono = prepareMonoPcm(cmd.pcm, cmd.channels, cmd.sampleRate);
		const windowSeconds = mono.length / cmd.sampleRate;
		const result = await transcribeWindow({
			runtime: activeModel.runtime,
			monoPcm: mono,
			vocab: activeModel.vocab,
			special: activeModel.manifest.tokens,
			maxTokens: activeModel.manifest.maxDecodeTokens,
			chunkLengthS: activeModel.manifest.audio.chunkLengthS,
			offsetS: cmd.offsetS,
			language: cmd.language ?? activeModel.manifest.defaultLanguage ?? undefined,
			shouldCancel: () => job.cancelled
		});
		if (job.cancelled) return;

		// De-overlap: keep only this window's trusted slice so overlapping windows
		// can't emit the same segment twice (bounds tile the timeline).
		job.segments.push(
			...clipSegmentsToTrustedRange(
				result.segments,
				cmd.trustedFromS ?? null,
				cmd.trustedToS ?? null
			)
		);
		if (result.language && !job.language) job.language = result.language;
		job.processedSeconds = Math.min(cmd.offsetS + windowSeconds, cmd.totalDurationS);
		post({
			type: 'asr-progress',
			jobId: cmd.jobId,
			fraction: cmd.totalDurationS > 0 ? Math.min(job.processedSeconds / cmd.totalDurationS, 1) : 1,
			processedSeconds: job.processedSeconds,
			totalSeconds: cmd.totalDurationS
		});

		const isFinalWindow = cmd.isFinal ?? cmd.offsetS + windowSeconds >= cmd.totalDurationS - 0.05;
		if (!isFinalWindow) return;

		jobs.delete(cmd.jobId);
		tombstonedJobIds.delete(cmd.jobId);
		const segments = deduplicateSegments(
			filterHallucinations(dropAdjacentRepeatedSegments(job.segments))
		);
		if (isEmptyTranscript(segments)) {
			post({
				type: 'asr-error',
				jobId: cmd.jobId,
				message: 'No speech was detected in the selection.'
			});
			return;
		}
		post({
			type: 'asr-result',
			jobId: cmd.jobId,
			segments,
			language: job.language,
			phraseLevel: false,
			durationMs: performance.now() - job.startedAt
		});
	} catch (error) {
		jobs.delete(cmd.jobId);
		tombstonedJobIds.add(cmd.jobId);
		if (error instanceof DecodeCancelledError || job.cancelled) return; // asr-cancelled already sent
		post({ type: 'asr-error', jobId: cmd.jobId, message: errorText(error) });
	}
}

function handleCancel(cmd: Extract<AsrWorkerCommand, { type: 'asr-cancel' }>): void {
	if (cmd.jobId !== undefined) {
		tombstonedJobIds.add(cmd.jobId);
		const job = jobs.get(cmd.jobId);
		if (job) job.cancelled = true;
	} else {
		for (const job of jobs.values()) {
			job.cancelled = true;
			tombstonedJobIds.add(job.jobId);
		}
	}
	post({ type: 'asr-cancelled', jobId: cmd.jobId });
}

function handleDispose(): void {
	loadGeneration++; // invalidate any in-flight load
	loadAbortController?.abort();
	loadAbortController = null;
	for (const job of jobs.values()) job.cancelled = true;
	jobs.clear();
	tombstonedJobIds.clear();
	model?.runtime.dispose();
	model = null;
	status = 'not-loaded';
}

self.onmessage = (event: MessageEvent<AsrWorkerCommand>) => {
	const cmd = event.data;
	switch (cmd.type) {
		case 'asr-probe':
			post({ type: 'asr-probe-result', result: probeAsr() });
			break;
		case 'asr-load-model':
			enqueue(() => handleLoad(cmd));
			break;
		case 'asr-transcribe':
			enqueue(() => handleTranscribe(cmd));
			break;
		case 'asr-cancel':
			handleCancel(cmd);
			break;
		case 'asr-dispose':
			handleDispose();
			break;
	}
};
