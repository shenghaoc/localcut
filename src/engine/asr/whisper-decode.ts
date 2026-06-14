/**
 * Whisper encode/decode orchestration (Phase 29). Independent of LiteRT.js: it
 * depends only on the {@link WhisperRuntime} interface, so the greedy
 * autoregressive loop and segment assembly are unit-tested with a scripted fake
 * runtime. The concrete LiteRT-backed runtime lives in `litert-runtime.ts`.
 *
 * The recipe follows Google's `litert-samples` ASR sample for the
 * `litert-community/whisper-*` models: force only the prompt, argmax the logits
 * of the last filled position each step, stop at ` endoftext`.
 *
 * Robustness: temperature fallback with compression-ratio and log-probability
 * quality checks (matching OpenAI's `transcribe.py`) prevents degenerate output
 * on real-world audio — the model's greedy decode is prone to early termination
 * or hallucinated repetition on noisy / multilingual / low-SNR material.
 */
import type { AsrDecodeParams, AsrSpecialTokens, CaptionSegmentSnapshot } from '../../protocol';
import {
	DEFAULT_MEL_CONFIG,
	extractMelSpectrogram,
	normaliseMelSpectrogram,
	type MelSpectrogramConfig
} from './whisper-dsp';
import { buildWhisperPrompt, decodeTextIds, idsToSegments } from './whisper-tokenizer';

/** Log-mel features for one window, frame-major (nFrames × nMel), row-major. */
export interface MelInput {
	data: Float32Array;
	nMel: number;
	nFrames: number;
}

/** Encoder output handle; the runtime owns any underlying GPU/WASM buffers. */
export interface EncodedAudio {
	readonly frames: number;
	dispose(): void;
}

/**
 * The minimal inference surface the decoder needs. A real implementation wraps
 * the TFLite `encode`/`decode` signatures; tests supply a fake returning scripted
 * logits. `decode(tokens, encoded)` returns logits over the full vocabulary for
 * the token that follows `tokens`.
 */
export interface WhisperRuntime {
	encode(mel: MelInput): Promise<EncodedAudio>;
	decode(tokens: Int32Array, encoded: EncodedAudio): Promise<Float32Array>;
	dispose(): void;
}

export class DecodeCancelledError extends Error {
	constructor() {
		super('ASR decode cancelled');
		this.name = 'DecodeCancelledError';
	}
}

/** Compute softmax probability for one logit against the full vocabulary. */
export function softmaxProbability(logits: Float32Array, index: number): number {
	const target = logits[index] ?? -Infinity;
	if (target === -Infinity) return 0;
	let maxVal = -Infinity;
	for (let i = 0; i < logits.length; i++) {
		if (logits[i] > maxVal) maxVal = logits[i];
	}
	if (maxVal === -Infinity) return 0;
	let sumExp = 0;
	for (let i = 0; i < logits.length; i++) {
		sumExp += Math.exp(logits[i] - maxVal);
	}
	return sumExp > 0 ? Math.exp(target - maxVal) / sumExp : 0;
}

/** Index of the maximum value (ties resolve to the lowest index). */
export function argmax(values: ArrayLike<number>): number {
	let best = 0;
	let bestValue = -Infinity;
	for (let i = 0; i < values.length; i++) {
		const v = values[i];
		if (v > bestValue) {
			bestValue = v;
			best = i;
		}
	}
	return best;
}

/**
 * Sample from logits with temperature. Temperature 0 is greedy (argmax);
 * temperature > 0 applies softmax and samples from the distribution.
 * Returns [chosenIndex, logProb of chosen token].
 */
export function sampleLogits(
	logits: Float32Array,
	temperature: number
): [index: number, logProb: number] {
	const fallbackIndex = argmax(logits);
	if (temperature === 0) {
		// Compute log-softmax at the argmax for quality tracking.
		let maxVal = -Infinity;
		for (let i = 0; i < logits.length; i++) if (logits[i] > maxVal) maxVal = logits[i];
		if (maxVal === -Infinity) return [fallbackIndex, -Infinity];
		let sumExp = 0;
		for (let i = 0; i < logits.length; i++) {
			if (logits[i] === -Infinity) continue;
			sumExp += Math.exp(logits[i] - maxVal);
		}
		if (!(sumExp > 0)) return [fallbackIndex, -Infinity];
		const logProb = logits[fallbackIndex] - maxVal - Math.log(sumExp);
		return [fallbackIndex, logProb];
	}

	// Temperature-scaled softmax sampling.
	let maxVal = -Infinity;
	for (let i = 0; i < logits.length; i++) {
		const v = logits[i] / temperature;
		if (v > maxVal) maxVal = v;
	}
	if (maxVal === -Infinity) return [fallbackIndex, -Infinity];
	let sumExp = 0;
	for (let i = 0; i < logits.length; i++) {
		if (logits[i] === -Infinity) continue;
		sumExp += Math.exp(logits[i] / temperature - maxVal);
	}
	if (!(sumExp > 0)) return [fallbackIndex, -Infinity];
	const r = Math.random();
	let cumulative = 0;
	let lastFinite = fallbackIndex;
	for (let i = 0; i < logits.length; i++) {
		if (logits[i] === -Infinity) continue;
		lastFinite = i;
		cumulative += Math.exp(logits[i] / temperature - maxVal) / sumExp;
		if (r < cumulative) {
			const logProb = logits[i] / temperature - maxVal - Math.log(sumExp);
			return [i, logProb];
		}
	}
	// Fallback to last index (numerical edge case).
	const logProb = logits[lastFinite] / temperature - maxVal - Math.log(sumExp);
	return [lastFinite, logProb];
}

export interface DecodeChunkOptions {
	special: AsrSpecialTokens;
	language?: string | null;
	/** Whether Whisper should emit timestamp tokens. Defaults to true. */
	timestamps?: boolean;
	/** Maximum allowed first timestamp, matching Whisper's default 1s gate. */
	maxInitialTimestampS?: number | null;
	/** The model's fixed decoder context length (token buffer size). */
	maxTokens: number;
	/** Sampling temperature (0 = greedy argmax). */
	temperature?: number;
	/** Additional token ids that must not be selected during decode. */
	suppressTokens?: readonly number[];
	/** Optional no-speech probability already probed from the SOT decoder row. */
	initialNoSpeechProbability?: number;
	shouldCancel?: () => boolean;
}

export interface DecodeChunkResult {
	/** Generated token ids (excluding the forced prompt). */
	tokens: number[];
	/** Per-token log probabilities. */
	logProbs: number[];
	/** Average log probability across all generated tokens. */
	avgLogProb: number;
	/** Language detected from the generated tokens (if any). */
	language: string | null;
	/**
	 * Probability that the audio contains no speech, computed from the SOT
	 * decoder row against the full vocabulary.
	 */
	noSpeechProbability: number;
}

function suppressToken(logits: Float32Array, token: number): void {
	if (token >= 0 && token < logits.length) logits[token] = -Infinity;
}

function suppressRange(logits: Float32Array, start: number, end: number): void {
	const clampedStart = Math.max(0, start);
	const clampedEnd = Math.min(logits.length, end);
	for (let i = clampedStart; i < clampedEnd; i++) logits[i] = -Infinity;
}

function logSumExpRange(logits: Float32Array, start: number, end: number): number {
	const clampedStart = Math.max(0, start);
	const clampedEnd = Math.min(logits.length, end);
	let maxVal = -Infinity;
	for (let i = clampedStart; i < clampedEnd; i++) {
		if (logits[i] > maxVal) maxVal = logits[i];
	}
	if (maxVal === -Infinity) return -Infinity;
	let sum = 0;
	for (let i = clampedStart; i < clampedEnd; i++) sum += Math.exp(logits[i] - maxVal);
	return maxVal + Math.log(sum);
}

function maxRange(logits: Float32Array, start: number, end: number): number {
	const clampedStart = Math.max(0, start);
	const clampedEnd = Math.min(logits.length, end);
	let maxVal = -Infinity;
	for (let i = clampedStart; i < clampedEnd; i++) {
		if (logits[i] > maxVal) maxVal = logits[i];
	}
	return maxVal;
}

function applyBaseSuppression(logits: Float32Array, special: AsrSpecialTokens): void {
	suppressToken(logits, special.startOfTranscript);
	suppressToken(logits, special.transcribe);
	suppressToken(logits, special.noSpeech);
	suppressToken(logits, special.noTimestamps);
	for (const token of Object.values(special.language)) suppressToken(logits, token);
}

function applyTimestampRules(
	logits: Float32Array,
	generated: readonly number[],
	special: AsrSpecialTokens,
	maxInitialTimestampS: number | null
): void {
	const last = generated[generated.length - 1];
	const previous = generated[generated.length - 2];
	const lastWasTimestamp = last !== undefined && last >= special.timestampBegin;
	const previousWasTimestamp = previous === undefined || previous >= special.timestampBegin;

	if (lastWasTimestamp) {
		if (previousWasTimestamp) {
			suppressRange(logits, special.timestampBegin, logits.length);
		} else {
			suppressRange(logits, 0, special.endOfText);
		}
	}

	for (let i = generated.length - 1; i >= 0; i--) {
		const token = generated[i]!;
		if (token < special.timestampBegin) continue;
		const firstForbidden =
			lastWasTimestamp && !previousWasTimestamp ? token : Math.min(token + 1, logits.length);
		suppressRange(logits, special.timestampBegin, firstForbidden);
		break;
	}

	if (generated.length === 0) {
		suppressRange(logits, 0, special.timestampBegin);
		if (maxInitialTimestampS !== null) {
			const lastAllowed =
				special.timestampBegin + Math.max(0, Math.round(maxInitialTimestampS / 0.02));
			suppressRange(logits, lastAllowed + 1, logits.length);
		}
	}

	const timestampLogProb = logSumExpRange(logits, special.timestampBegin, logits.length);
	const maxTextTokenLogProb = maxRange(logits, 0, special.timestampBegin);
	if (timestampLogProb > maxTextTokenLogProb) suppressRange(logits, 0, special.timestampBegin);
}

/**
 * Greedy / temperature-sampled autoregressive decode of one encoded window.
 * Returns the generated token ids (excluding the forced prompt), stopping at
 * ` endoftext` or when the decoder context fills.
 *
 * The timestamp mode mirrors OpenAI Whisper's timestamp logit filter: the first
 * generated token must be a timestamp, timestamps occur in valid pairs, and
 * timestamp probability mass can force timestamp selection over text tokens.
 */
export async function decodeChunk(
	runtime: WhisperRuntime,
	encoded: EncodedAudio,
	options: DecodeChunkOptions
): Promise<DecodeChunkResult> {
	const temperature = options.temperature ?? 0;
	const tokens = buildWhisperPrompt(options.special, options.language);
	const timestamps = options.timestamps ?? true;
	const maxInitialTimestampS =
		options.maxInitialTimestampS === undefined ? 1 : options.maxInitialTimestampS;
	if (!timestamps) tokens.push(options.special.noTimestamps);
	const generated: number[] = [];
	const logProbs: number[] = [];
	let noSpeechProbability = options.initialNoSpeechProbability ?? 0;

	while (tokens.length < options.maxTokens) {
		if (options.shouldCancel?.()) throw new DecodeCancelledError();
		const logits = await runtime.decode(Int32Array.from(tokens), encoded);

		// Probe no-speech probability on the first decode step.
		if (generated.length === 0 && options.initialNoSpeechProbability === undefined) {
			noSpeechProbability = softmaxProbability(logits, options.special.noSpeech);
		}

		applyBaseSuppression(logits, options.special);
		// Suppress caller-supplied tokens.
		for (const token of options.suppressTokens ?? []) {
			suppressToken(logits, token);
		}
		if (timestamps) applyTimestampRules(logits, generated, options.special, maxInitialTimestampS);

		const [next, logProb] = sampleLogits(logits, temperature);
		if (next === options.special.endOfText) break;
		tokens.push(next);
		generated.push(next);
		logProbs.push(logProb);
	}

	const avgLogProb =
		logProbs.length > 0 ? logProbs.reduce((a, b) => a + b, 0) / logProbs.length : 0;
	const language = detectLanguageFromIds(generated, options.special);
	return { tokens: generated, logProbs, avgLogProb, language, noSpeechProbability };
}

function detectLanguageFromIds(ids: readonly number[], special: AsrSpecialTokens): string | null {
	const codeByTokenId = new Map<number, string>();
	for (const [code, id] of Object.entries(special.language)) codeByTokenId.set(id, code);
	for (const id of ids.slice(0, 4)) {
		const code = codeByTokenId.get(id);
		if (code) return code;
	}
	return null;
}

export function detectLanguageFromLogits(
	logits: Float32Array,
	special: AsrSpecialTokens
): string | null {
	let bestCode: string | null = null;
	let bestLogit = -Infinity;
	for (const [code, token] of Object.entries(special.language)) {
		const logit = logits[token] ?? -Infinity;
		if (logit > bestLogit) {
			bestLogit = logit;
			bestCode = code;
		}
	}
	return bestCode;
}

/**
 * Compression ratio of decoded text (bytes / unique n-grams). A high ratio
 * indicates repetitive / degenerate output. Matches OpenAI's
 * `decoding.py :: compression_ratio()` implementation.
 */
export function compressionRatio(text: string): number {
	const bytes = new TextEncoder().encode(text);
	if (bytes.length === 0) return 1;
	const ngramSize = 4;
	if (bytes.length < ngramSize) return 1;
	const ngrams = new Set<number>();
	for (let i = 0; i <= bytes.length - ngramSize; i++) {
		ngrams.add((bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!);
	}
	return bytes.length / ngrams.size;
}

/**
 * Temperature schedule for fallback (OpenAI's transcribe.py). t=0 is greedy and
 * deterministic, so it appears once — repeating it would re-run an identical
 * decode. Higher temperatures are only reached when a window keeps failing the
 * compression-ratio / log-probability checks.
 */
const DEFAULT_TEMPERATURES = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0];
/** Text with a compression ratio above this is considered degenerate. */
const DEFAULT_COMPRESSION_RATIO_THRESHOLD = 2.4;
/** Average log-probability below this indicates low confidence. */
const DEFAULT_LOGPROB_THRESHOLD = -1.0;
/** No-speech probability above this means the window is likely silence. */
export const DEFAULT_NO_SPEECH_THRESHOLD = 0.6;

export interface TranscribeWindowParams {
	runtime: WhisperRuntime;
	/** 16 kHz mono PCM for this window. */
	monoPcm: Float32Array;
	/** id → byte-level token string. */
	vocab: readonly string[];
	special: AsrSpecialTokens;
	/** Window start within the clip/timeline, in seconds. */
	offsetS: number;
	maxTokens: number;
	melConfig?: MelSpectrogramConfig;
	/** Fixed raw-audio window length expected by the model. Whisper uses 30s. */
	chunkLengthS?: number;
	language?: string | null;
	shouldCancel?: () => boolean;
	/** Model-specific decode quality thresholds from the manifest. */
	decodeParams?: AsrDecodeParams | null;
}

export interface TranscribedWindow {
	segments: CaptionSegmentSnapshot[];
	language: string | null;
	/** Plain decoded text (used to detect an all-empty transcript). */
	text: string;
}

function normalizedSegmentText(text: string): string {
	return text
		.toLowerCase()
		.replace(/[.,!?;:"()[\]{}-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.replace(/^[\s']+|[\s']+$/g, '')
		.trim();
}

export function dropAdjacentRepeatedSegments(
	segments: readonly CaptionSegmentSnapshot[],
	maxGapS = 6
): CaptionSegmentSnapshot[] {
	const next: CaptionSegmentSnapshot[] = [];
	for (const segment of segments) {
		const normalized = normalizedSegmentText(segment.text);
		const previous = next[next.length - 1];
		const previousNormalized = previous ? normalizedSegmentText(previous.text) : '';
		const previousEnd = previous ? previous.start + previous.duration : 0;
		if (normalized && previousNormalized === normalized && segment.start - previousEnd <= maxGapS) {
			continue;
		}
		next.push(segment);
	}
	return next;
}

/**
 * Time-bounded text-content deduplication. Collapses the same text repeating
 * across nearby windows (e.g. "[MUSIC]" or "Thank you for watching" emitted every
 * window over silence) while PRESERVING a phrase that legitimately recurs later
 * in the clip. A segment is dropped only when an identical normalized text last
 * occurred within `maxGapS` seconds; a longer gap is treated as genuine repeated
 * speech and kept. With the no-speech gate handling silence hallucination at the
 * source, this no longer needs to be a whole-clip first-occurrence filter (which
 * deleted every legitimate refrain / "yes" / repeated name).
 */
export function deduplicateSegments(
	segments: readonly CaptionSegmentSnapshot[],
	maxGapS = 30
): CaptionSegmentSnapshot[] {
	const lastEndByText = new Map<string, number>();
	const next: CaptionSegmentSnapshot[] = [];
	for (const segment of segments) {
		const normalized = normalizedSegmentText(segment.text);
		if (!normalized) continue;
		const previousEnd = lastEndByText.get(normalized);
		const isNearRepeat = previousEnd !== undefined && segment.start - previousEnd <= maxGapS;
		// Track the latest occurrence whether kept or dropped, so a run of repeats
		// stays collapsed instead of resurfacing once the gap to the *kept* one grows.
		lastEndByText.set(normalized, segment.start + segment.duration);
		if (isNearRepeat) continue;
		next.push(segment);
	}
	return next;
}

/**
 * Keep only segments whose start falls in [fromS, toS). Used to de-overlap
 * adjacent decode windows: their trusted ranges tile the timeline, so each
 * segment is claimed by exactly one window and none is emitted twice. A null
 * bound means "unbounded" on that side (the first / last window of the job).
 */
export function clipSegmentsToTrustedRange(
	segments: readonly CaptionSegmentSnapshot[],
	fromS: number | null,
	toS: number | null
): CaptionSegmentSnapshot[] {
	const lo = fromS ?? -Infinity;
	const hi = toS ?? Infinity;
	return segments.filter((segment) => segment.start >= lo && segment.start < hi);
}

function hasSpeechLikeText(text: string): boolean {
	return /[A-Za-z0-9\u3400-\u9fff]/.test(text);
}

function isSymbolOnlyToken(text: string): boolean {
	const trimmed = text.trim();
	return trimmed.length > 0 && !hasSpeechLikeText(trimmed);
}

const captionSuppressionCache = new WeakMap<readonly string[], number[]>();

/**
 * Whisper can fall into punctuation/music-symbol loops on low-SNR clips. For
 * captions, suppress text tokens that decode to symbols only; timestamp and
 * special tokens are handled separately and remain available.
 */
export function captionSuppressedTokens(
	vocab: readonly string[],
	special: AsrSpecialTokens
): number[] {
	const cached = captionSuppressionCache.get(vocab);
	if (cached) return cached;
	const tokens: number[] = [];
	const textTokenLimit = Math.min(vocab.length, special.endOfText);
	for (let id = 0; id < textTokenLimit; id++) {
		if (isSymbolOnlyToken(decodeTextIds(vocab, [id]))) tokens.push(id);
	}
	captionSuppressionCache.set(vocab, tokens);
	return tokens;
}

function padOrTrimPcm(pcm: Float32Array, samples: number): Float32Array {
	if (pcm.length === samples) return pcm;
	if (pcm.length > samples) return pcm.slice(0, samples);
	const padded = new Float32Array(samples);
	padded.set(pcm);
	return padded;
}

/**
 * Transcribes one mono PCM window: log-mel → encoder → greedy decode →
 * timestamped caption segments offset into the clip/timeline.
 *
 * Uses temperature fallback: tries greedy (t=0) first, checks output quality
 * via compression ratio and log-probability, and retries at progressively
 * higher temperatures until acceptable output is produced or the schedule
 * is exhausted.
 */
export async function transcribeWindow(params: TranscribeWindowParams): Promise<TranscribedWindow> {
	const melConfig = params.melConfig ?? DEFAULT_MEL_CONFIG;
	const dp = params.decodeParams;
	const logProbThreshold = dp?.logProbThreshold ?? DEFAULT_LOGPROB_THRESHOLD;
	const noSpeechThreshold = dp?.noSpeechThreshold ?? DEFAULT_NO_SPEECH_THRESHOLD;
	const compressionRatioThreshold =
		dp?.compressionRatioThreshold ?? DEFAULT_COMPRESSION_RATIO_THRESHOLD;
	const temperatures = dp?.temperatures ?? DEFAULT_TEMPERATURES;

	const modelPcm =
		params.chunkLengthS === undefined
			? params.monoPcm
			: padOrTrimPcm(params.monoPcm, Math.round(params.chunkLengthS * melConfig.sampleRate));
	const mel = extractMelSpectrogram(modelPcm, melConfig);
	const normalised = normaliseMelSpectrogram(mel);
	const encoded = await params.runtime.encode({
		data: normalised,
		nMel: mel.nMel,
		nFrames: mel.nFrames
	});

	try {
		let detectedLanguage = params.language ?? null;
		let initialNoSpeechProbability: number | undefined;
		if (!detectedLanguage) {
			const sotLogits = await params.runtime.decode(
				Int32Array.from([params.special.startOfTranscript]),
				encoded
			);
			initialNoSpeechProbability = softmaxProbability(sotLogits, params.special.noSpeech);
			detectedLanguage = detectLanguageFromLogits(sotLogits, params.special);
		}
		let bestResult: DecodeChunkResult | null = null;
		let bestText = '';
		let bestSegments: CaptionSegmentSnapshot[] = [];
		const suppressTokens = captionSuppressedTokens(params.vocab, params.special);

		const windowSeconds = params.monoPcm.length / melConfig.sampleRate;
		// Run the temperature schedule with timestamps on; only if every timestamped
		// attempt is rejected do we fall back to a single untimestamped greedy pass
		// (OpenAI's intent — without re-running the whole schedule twice).
		const attempts: Array<{ timestamps: boolean; temperature: number }> = [
			...temperatures.map((temperature) => ({ timestamps: true, temperature })),
			{ timestamps: false, temperature: 0 }
		];
		for (const { timestamps, temperature } of attempts) {
			if (params.shouldCancel?.()) throw new DecodeCancelledError();

			const result = await decodeChunk(params.runtime, encoded, {
				special: params.special,
				language: detectedLanguage,
				timestamps,
				maxTokens: params.maxTokens,
				temperature,
				suppressTokens,
				initialNoSpeechProbability,
				shouldCancel: params.shouldCancel
			});

			// Silence gate (OpenAI's compound test): when the model both flags the
			// window as no-speech AND decodes it with low confidence, treat it as
			// silence and emit nothing rather than falling through to higher
			// temperatures — silence is not a decode failure. Gating on BOTH
			// conditions, never no-speech alone, keeps quiet-but-real speech (which
			// decodes with high confidence, avgLogProb ≈ 0) from being dropped.
			if (
				temperature === 0 &&
				result.noSpeechProbability >= noSpeechThreshold &&
				result.avgLogProb < logProbThreshold
			) {
				return { segments: [], language: detectedLanguage, text: '' };
			}

			const segments = filterHallucinations(
				dropAdjacentRepeatedSegments(
					idsToSegments(result.tokens, params.vocab, params.special, params.offsetS, windowSeconds)
				)
			);
			const text = segments
				.map((segment) => segment.text)
				.join(' ')
				.trim();

			const ratio = compressionRatio(text);
			const isDegenerate = ratio > compressionRatioThreshold;
			const isLowConfidence = result.avgLogProb < logProbThreshold && result.tokens.length > 0;
			const isAcceptable = !isDegenerate && !isLowConfidence;

			if (isAcceptable && text.length > 0) {
				const language =
					params.language ??
					result.language ??
					detectedLanguage ??
					detectLanguageFromIds(result.tokens, params.special) ??
					null;
				return { segments, language, text };
			}

			// Keep the best (longest non-empty, lowest-temperature) result as fallback.
			if (
				text.length > 0 &&
				(!bestResult || (text.length > bestText.length && temperature < 1.0))
			) {
				bestResult = result;
				bestText = text;
				bestSegments = segments;
			}
		}

		// All temperatures exhausted — return the best result we have.
		if (bestSegments.length > 0) {
			const language = params.language ?? bestResult?.language ?? detectedLanguage ?? null;
			return { segments: bestSegments, language, text: bestText };
		}
		return { segments: [], language: null, text: '' };
	} finally {
		encoded.dispose();
	}
}

/**
 * Known Whisper hallucination patterns — the model frequently produces these
 * descriptive placeholders during music, silence, or non-speech audio instead
 * of actual transcription. Matched case-insensitively against trimmed segment
 * text. Segments that match are stripped from the output.
 */
const HALLUCINATION_PATTERNS: RegExp[] = [
	/^\[.*\]$/i, // [MUSIC], [APPLAUSE], [LAUGHTER], [BLANK_AUDIO]
	/^\(.*(?:music|singing|applause|laughter|speaking|foreign|language|indistinct|inaudible|mumbling|dramatic|upbeat|instrumental).*\)$/i,
	/^(?:thank you for (?:watching|listening|your (?:attention|time))|subscribe|like and subscribe|don't forget to subscribe)/i,
	/^(?:you|we)\s+(?:can|will|shall|should|may|might)\s+(?:also|now)\s+(?:see|look|watch|listen)/i,
	/^(\b\w+\b)(?:\s+\1)+$/i // repeated single words: "the the"
];

/** Strip segments that match known Whisper hallucination patterns. */
export function filterHallucinations(
	segments: readonly CaptionSegmentSnapshot[]
): CaptionSegmentSnapshot[] {
	return segments.filter((segment) => {
		const text = segment.text.trim();
		if (!text) return false;
		if (!hasSpeechLikeText(text)) return false;
		return !HALLUCINATION_PATTERNS.some((re) => re.test(text));
	});
}

/** True when a list of segments has no non-whitespace text. */
export function isEmptyTranscript(segments: readonly CaptionSegmentSnapshot[]): boolean {
	return segments.every((segment) => segment.text.trim().length === 0);
}
