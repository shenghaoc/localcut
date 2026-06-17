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
	AsrEngine,
	AsrModelAssetSnapshot,
	AsrModelStatus,
	AsrWorkerCommand,
	AsrWorkerState,
	CaptionSegmentSnapshot
} from '../../protocol';
import { probeAsr } from './asr-probe';
import { manifestAssets, validateAsrManifest, type AsrTranscribeConfig } from './model-manifest';
import { createOpfsAssetStore, loadVerifiedAsset, type AssetStore } from './asset-cache';
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
	transcribeWindow,
	type WhisperRuntime
} from './whisper-decode';
import { createLiteRtWhisperRuntime } from './litert-runtime';
import {
	isOrtWhisperManifestDocument,
	ortWhisperManifestAssets,
	validateOrtWhisperManifest
} from './ort-whisper-manifest';
import { createOrtWhisperRuntime } from './whisper-ort-runtime';
import { appendSerialTask } from './serial-task-queue';

/** A loaded Whisper runtime (LiteRT or ONNX) plus the accelerator it compiled on. */
type AsrRuntime = WhisperRuntime & { readonly accelerator: AsrAccelerator };

interface LoadedModel {
	runtime: AsrRuntime;
	/** id → byte-level token string. */
	vocab: string[];
	/** Engine-agnostic transcribe-time config (audio, tokens, decode params). */
	config: AsrTranscribeConfig;
	/** Which runtime built this model — recorded in the generated track's metadata. */
	engine: AsrEngine;
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

function enqueue(
	task: () => Promise<void>,
	onError: (error: unknown) => void = (error) => {
		post({ type: 'asr-error', message: errorText(error) });
	}
): void {
	chain = appendSerialTask(chain, task, onError);
}

interface DownloadContext {
	generation: number;
	/** Accelerator label shown in the loading status (informational). */
	accelerator: AsrAccelerator;
	signal: AbortSignal;
	store: AssetStore | null;
	origin: string;
	totalBytes: number;
}

/**
 * Downloads + verifies a manifest's assets in order, posting aggregate progress.
 * Returns `null` when a reload/dispose superseded this load mid-fetch (the caller
 * must stop). Each asset URL is re-checked against the host allowlist.
 */
async function downloadVerifiedAssets(
	assets: ReadonlyArray<{ key: string; asset: AsrModelAssetSnapshot }>,
	ctx: DownloadContext
): Promise<{ bytesByKey: Record<string, Uint8Array>; fromNetwork: boolean } | null> {
	const downloaded: Record<string, number> = {};
	const bytesByKey: Record<string, Uint8Array> = {};
	let fromNetwork = false;
	for (const { key, asset } of assets) {
		assertTrustedModelUrl(asset.url, ctx.origin);
		const bytes = await loadVerifiedAsset(asset, {
			store: ctx.store,
			signal: ctx.signal,
			onSource: (source) => {
				if (source === 'network') fromNetwork = true;
			},
			onProgress: (progress) => {
				if (ctx.generation !== loadGeneration) return;
				downloaded[key] = progress.receivedBytes;
				const sum = Object.values(downloaded).reduce((a, b) => a + b, 0);
				post({
					type: 'asr-model-status',
					status: 'loading',
					accelerator: ctx.accelerator,
					sizeBytes: ctx.totalBytes,
					downloadedBytes: sum,
					fraction: Math.min(sum / ctx.totalBytes, 0.99)
				});
			}
		});
		if (ctx.generation !== loadGeneration) return null; // disposed/reloaded mid-fetch
		bytesByKey[key] = bytes;
	}
	return { bytesByKey, fromNetwork };
}

/** Posts the final "compiling graphs" tick before a runtime is built. */
function postCompiling(accelerator: AsrAccelerator, totalBytes: number): void {
	post({
		type: 'asr-model-status',
		status: 'loading',
		accelerator,
		sizeBytes: totalBytes,
		downloadedBytes: totalBytes,
		fraction: 0.99
	});
}

/** Commits a freshly built runtime as the active model and posts `loaded`. */
function commitLoadedModel(params: {
	runtime: AsrRuntime;
	vocab: string[];
	config: AsrTranscribeConfig;
	engine: AsrEngine;
	fromNetwork: boolean;
}): void {
	model = {
		runtime: params.runtime,
		vocab: params.vocab,
		config: params.config,
		engine: params.engine,
		accelerator: params.runtime.accelerator
	};
	status = 'loaded';
	post({
		type: 'asr-model-status',
		status: 'loaded',
		engine: params.engine,
		accelerator: params.runtime.accelerator,
		sizeBytes: params.config.sizeBytes,
		fraction: 1,
		cached: !params.fromNetwork
	});
}

/** Loads a LiteRT.js Whisper model (single fused TFLite graph). */
async function loadLiteRtModel(
	json: unknown,
	cmd: Extract<AsrWorkerCommand, { type: 'asr-load-model' }>,
	generation: number,
	signal: AbortSignal,
	store: AssetStore | null,
	origin: string
): Promise<void> {
	const manifest = validateAsrManifest(json);
	const result = await downloadVerifiedAssets(manifestAssets(manifest), {
		generation,
		accelerator: cmd.accelerator,
		signal,
		store,
		origin,
		totalBytes: manifest.sizeBytes
	});
	if (!result) return;

	postCompiling(cmd.accelerator, manifest.sizeBytes);
	const runtime = await createLiteRtWhisperRuntime({
		wasmPath: cmd.wasmPath,
		accelerator: cmd.accelerator,
		modelBytes: result.bytesByKey.model!,
		manifest
	});
	if (generation !== loadGeneration) {
		runtime.dispose();
		return;
	}
	const vocab = parseWhisperVocab(new TextDecoder().decode(result.bytesByKey.tokenizer!));
	commitLoadedModel({
		runtime,
		vocab,
		config: manifest,
		engine: 'litert-whisper',
		fromNetwork: result.fromNetwork
	});
}

/** Loads an ONNX Whisper model (encoder + no-past decoder) on ONNX Runtime Web. */
async function loadOrtModel(
	json: unknown,
	generation: number,
	signal: AbortSignal,
	store: AssetStore | null,
	origin: string
): Promise<void> {
	const manifest = validateOrtWhisperManifest(json);
	// ORT runs on the EP pinned in the manifest (wasm for the shipped models), not
	// the LiteRT-style accelerator the command requested.
	const accelerator: AsrAccelerator = manifest.executionProviders[0] ?? 'wasm';
	const result = await downloadVerifiedAssets(ortWhisperManifestAssets(manifest), {
		generation,
		accelerator,
		signal,
		store,
		origin,
		totalBytes: manifest.sizeBytes
	});
	if (!result) return;

	postCompiling(accelerator, manifest.sizeBytes);
	const runtime = await createOrtWhisperRuntime({
		encoderBytes: result.bytesByKey.encoder!,
		decoderBytes: result.bytesByKey.decoder!,
		manifest
	});
	if (generation !== loadGeneration) {
		runtime.dispose();
		return;
	}
	const vocab = parseWhisperVocab(new TextDecoder().decode(result.bytesByKey.tokenizer!));
	commitLoadedModel({
		runtime,
		vocab,
		config: manifest,
		engine: 'ort-whisper',
		fromNetwork: result.fromNetwork
	});
}

async function handleLoad(
	cmd: Extract<AsrWorkerCommand, { type: 'asr-load-model' }>
): Promise<void> {
	if (status === 'loaded' && model) {
		post({
			type: 'asr-model-status',
			status: 'loaded',
			engine: model.engine,
			accelerator: model.accelerator,
			sizeBytes: model.config.sizeBytes,
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
			throw new Error('WebAssembly is unavailable in this browser; Whisper cannot run.');
		}

		const origin = self.location.origin;
		// Model assets run as code — fetch them only from this origin or an
		// allowlisted, reputable model host, never an arbitrary manifest URL.
		assertTrustedModelUrl(cmd.manifestUrl, origin);
		const manifestResponse = await fetch(cmd.manifestUrl, { signal });
		if (!manifestResponse.ok) {
			throw new Error(`Model manifest fetch failed: HTTP ${manifestResponse.status}`);
		}
		const json: unknown = await manifestResponse.json();
		const store = await createOpfsAssetStore();

		// Route by the manifest's runtime discriminator: ONNX Whisper on ORT, else
		// the LiteRT single-graph path.
		if (isOrtWhisperManifestDocument(json)) {
			await loadOrtModel(json, generation, signal, store, origin);
		} else {
			await loadLiteRtModel(json, cmd, generation, signal, store, origin);
		}
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
			special: activeModel.config.tokens,
			maxTokens: activeModel.config.maxDecodeTokens,
			chunkLengthS: activeModel.config.audio.chunkLengthS,
			offsetS: cmd.offsetS,
			language: cmd.language ?? activeModel.config.defaultLanguage ?? undefined,
			shouldCancel: () => job.cancelled,
			decodeParams: activeModel.config.decode
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
			enqueue(
				() => handleTranscribe(cmd),
				(error) => {
					post({ type: 'asr-error', jobId: cmd.jobId, message: errorText(error) });
				}
			);
			break;
		case 'asr-cancel':
			handleCancel(cmd);
			break;
		case 'asr-dispose':
			handleDispose();
			break;
	}
};
