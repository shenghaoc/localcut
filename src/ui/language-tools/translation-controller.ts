import { currentEpochMs } from '../../time';
/**
 * Phase 40: Translation controller — framework-free state machine.
 *
 * Orchestrates Chrome's built-in `Translator` and `LanguageDetector` globals to
 * translate a caption track segment-by-segment, preserving timing exactly.
 *
 * Runs on the main thread (Chrome offloads inference to its own process).
 * No pipeline-worker or GPU/frame coupling.
 */
import type {
	AiAvailability,
	CaptionSegmentSnapshot,
	LanguageToolsProbeResult,
	TranslatorAvailabilityMap
} from '../../protocol';
import {
	buildTranslatedSegments,
	dominantLanguage,
	oppositeLanguage
} from '../../engine/language-tools/transcript';

// ── Types ──

export type TranslatePhase =
	| 'idle'
	| 'detecting'
	| 'downloading'
	| 'translating'
	| 'done'
	| 'error';

export interface TranslateJobState {
	phase: TranslatePhase;
	/** Current segment index (0-based) during translating phase. */
	current: number;
	/** Total segments to translate. */
	total: number;
	/** Download progress [0,1] while Chrome creates a built-in AI session. */
	downloadFraction: number | null;
	/** Detected source language ('zh' | 'en'). */
	detectedSource: 'zh' | 'en' | null;
	/** Target language chosen by user or auto-detected. */
	targetLang: 'zh' | 'en';
	/** Duration of the completed job in ms, or null if not done. */
	durationMs: number | null;
	/** Error message if phase is 'error'. */
	error: string | null;
}

export interface TranslationControllerState {
	/** Current probe result, or null if not yet probed. */
	probe: LanguageToolsProbeResult | null;
	/** Whether at least one translator language pair is usable. */
	available: boolean;
	/** Per-pair availability from the probe. */
	translatorAvailability: TranslatorAvailabilityMap;
	/** LanguageDetector availability (gates auto-direction only). */
	languageDetectorAvailability: AiAvailability;
	/** Current translation job, or null if idle. */
	job: TranslateJobState | null;
	/** Track id of the most recently created translated track (for bilingual export). */
	lastTranslatedTrackId: string | null;
	/** Source track id that produced the most recently created translated track. */
	lastTranslatedSourceTrackId: string | null;
}

export interface CaptionTrackInfo {
	id: string;
	name: string;
	language?: string | null;
	segments: readonly CaptionSegmentSnapshot[];
}

export interface CreateTranslatedTrackRequest {
	sourceTrackId: string;
	name: string;
	language: string;
	segments: CaptionSegmentSnapshot[];
}

export interface TranslationControllerPorts {
	/** Send a command to the pipeline worker to create the translated track. */
	createTranslatedTrack(request: CreateTranslatedTrackRequest): void;
	/** Called when the translated track is created (from worker state message). */
	onTranslatedTrackCreated?(trackId: string): void;
	/** Called when the worker rejects the translated track (empty / malformed). */
	onTranslatedTrackError?(reason: 'empty-segments' | 'malformed-segments', message: string): void;
	onError?(message: string): void;
}

function isUsable(a: AiAvailability | undefined): boolean {
	return a === 'available' || a === 'downloadable' || a === 'downloading';
}

// ── Controller ──

export class TranslationController {
	private readonly ports: TranslationControllerPorts;
	private state: TranslationControllerState;
	private readonly listeners = new Set<(state: TranslationControllerState) => void>();
	private translator: Translator | null = null;
	private detector: LanguageDetector | null = null;
	private abortController: AbortController | null = null;

	constructor(ports: TranslationControllerPorts) {
		this.ports = ports;
		this.state = {
			probe: null,
			available: false,
			translatorAvailability: {},
			languageDetectorAvailability: 'unknown',
			job: null,
			lastTranslatedTrackId: null,
			lastTranslatedSourceTrackId: null
		};
	}

	getState(): TranslationControllerState {
		return this.state;
	}

	subscribe(listener: (state: TranslationControllerState) => void): () => void {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	private update(partial: Partial<TranslationControllerState>): void {
		this.state = { ...this.state, ...partial };
		for (const listener of this.listeners) listener(this.state);
	}

	private updateJob(partial: Partial<TranslateJobState>): void {
		if (!this.state.job) return;
		this.update({ job: { ...this.state.job, ...partial } });
	}

	/** Update the probe result (called from the UI when the capability probe
	 *  completes or is re-run). Translate is gated on an actual translator pair —
	 *  a usable LanguageDetector alone is not enough to translate anything. */
	setProbe(probe: LanguageToolsProbeResult): void {
		const available = Object.values(probe.translator).some(isUsable);
		this.update({
			probe,
			available,
			translatorAvailability: probe.translator,
			languageDetectorAvailability: probe.languageDetector
		});
	}

	private get translatorStatic(): typeof Translator | undefined {
		return (globalThis as { Translator?: typeof Translator }).Translator;
	}

	private get detectorStatic(): typeof LanguageDetector | undefined {
		return (globalThis as { LanguageDetector?: typeof LanguageDetector }).LanguageDetector;
	}

	/** Check if a specific translator pair is ready (available or downloadable). */
	isPairReady(source: 'zh' | 'en', target: 'zh' | 'en'): boolean {
		return isUsable(this.state.translatorAvailability[`${source}->${target}`]);
	}

	/** Translate a caption track.
	 *
	 *  1. Resolve direction (auto-detect via LanguageDetector, or from the target)
	 *  2. Create the translator session (with download progress if needed)
	 *  3. Translate each segment, copying timing verbatim
	 *  4. Send the result to the worker for undoable insertion
	 */
	async translateTrack(
		track: CaptionTrackInfo,
		targetLang?: 'zh' | 'en',
		signal?: AbortSignal
	): Promise<void> {
		const failJob = (message: string): void => {
			this.update({
				job: {
					phase: 'error',
					current: 0,
					total: track.segments.length,
					downloadFraction: null,
					detectedSource: null,
					targetLang: targetLang ?? 'en',
					durationMs: null,
					error: message
				}
			});
			this.ports.onError?.(message);
		};

		// A new job invalidates any prior translated-track export target.
		this.update({ lastTranslatedTrackId: null, lastTranslatedSourceTrackId: null });

		const TranslatorApi = this.translatorStatic;
		if (!TranslatorApi) {
			failJob('Translation is unavailable in this browser.');
			return;
		}

		const startedAt = currentEpochMs();
		this.abortController = new AbortController();
		const combinedSignal = signal
			? AbortSignal.any([signal, this.abortController.signal])
			: this.abortController.signal;

		try {
			// Phase 1: resolve direction.
			this.update({
				job: {
					phase: 'detecting',
					current: 0,
					total: track.segments.length,
					downloadFraction: null,
					detectedSource: null,
					targetLang: targetLang ?? 'en',
					durationMs: null,
					error: null
				}
			});

			let sourceLang: 'zh' | 'en';
			if (targetLang) {
				// User picked a target; source is the opposite.
				sourceLang = oppositeLanguage(targetLang);
			} else {
				// Auto-detect from a sample of segment text.
				const DetectorApi = this.detectorStatic;
				if (!DetectorApi) {
					failJob('Cannot auto-detect language in this browser — choose a target language.');
					return;
				}
				if (!this.detector) {
					this.detector = await DetectorApi.create({
						signal: combinedSignal,
						monitor: (m) => {
							m.addEventListener('downloadprogress', (e) => {
								// e.loaded is a fraction in [0, 1]; there is no e.total.
								this.updateJob({ downloadFraction: e.loaded });
							});
						}
					});
				}
				const sampleSize = Math.min(5, track.segments.length);
				let sessionLost = false;
				const tops = await Promise.all(
					track.segments.slice(0, sampleSize).map(async (seg) => {
						const results = await this.detector!.detect(seg.text).catch(() => {
							// Chrome can reclaim the cached LanguageDetector after a
							// period of inactivity; subsequent detect() calls reject and
							// silently fall back to oppositeLanguage(). Drop the stale
							// reference so the next translate() recreates the session.
							sessionLost = true;
							return [] as LanguageDetectionResult[];
						});
						return results[0] ?? { detectedLanguage: 'en', confidence: 0 };
					})
				);
				if (sessionLost) {
					this.detector?.destroy();
					this.detector = null;
				}
				sourceLang = dominantLanguage(tops);
			}
			const resolvedTarget = targetLang ?? oppositeLanguage(sourceLang);

			this.updateJob({
				detectedSource: sourceLang,
				targetLang: resolvedTarget,
				downloadFraction: null
			});

			// Guard the exact pair before create() so an unavailable direction
			// fails with a clear message instead of throwing inside create().
			if (!this.isPairReady(sourceLang, resolvedTarget)) {
				failJob(
					`Translation for ${sourceLang} → ${resolvedTarget} is not available in this browser.`
				);
				return;
			}

			// Phase 2: create the translator (may trigger a one-time download).
			this.updateJob({ phase: 'downloading' });
			if (this.translator) {
				this.translator.destroy();
				this.translator = null;
			}
			this.translator = await TranslatorApi.create({
				sourceLanguage: sourceLang,
				targetLanguage: resolvedTarget,
				signal: combinedSignal,
				monitor: (m) => {
					m.addEventListener('downloadprogress', (e) => {
						// e.loaded is a fraction in [0, 1]; there is no e.total.
						this.updateJob({ downloadFraction: e.loaded });
					});
				}
			});

			// Phase 3: translate each segment, copying timing verbatim.
			this.updateJob({ phase: 'translating', downloadFraction: null });

			const translatedTexts: string[] = [];
			for (let i = 0; i < track.segments.length; i++) {
				if (combinedSignal.aborted) throw new TranslationCancelledError();
				this.updateJob({ current: i + 1 });
				const text = track.segments[i].text.trim();
				if (!text) {
					translatedTexts.push('');
					continue;
				}
				const translated = await this.translator.translate(text, { signal: combinedSignal });
				translatedTexts.push(translated);
				// Yield to keep the UI responsive between segments.
				await new Promise((resolve) => setTimeout(resolve, 0));
			}

			const translatedSegments = buildTranslatedSegments(track.segments, translatedTexts);
			if (!translatedSegments.some((s) => s.text.trim().length > 0)) {
				throw new Error('Translation produced no text. The source track may be empty.');
			}

			// Phase 4: hand off to the worker for undoable insertion.
			this.update({ lastTranslatedSourceTrackId: track.id });
			this.ports.createTranslatedTrack({
				sourceTrackId: track.id,
				name: `${track.name} (${resolvedTarget})`,
				language: resolvedTarget,
				segments: translatedSegments
			});

			this.updateJob({ phase: 'done', durationMs: currentEpochMs() - startedAt });
		} catch (err) {
			if (err instanceof TranslationCancelledError) {
				this.updateJob({ phase: 'idle' });
				return;
			}
			const message = err instanceof Error ? err.message : String(err);
			this.updateJob({ phase: 'error', error: message });
			this.ports.onError?.(message);
		} finally {
			this.abortController = null;
		}
	}

	/** Cancel the current translation job. */
	cancel(): void {
		this.abortController?.abort();
	}

	/** Handle the worker confirming track creation. */
	onTranslatedTrackCreated(trackId: string): void {
		this.update({ lastTranslatedTrackId: trackId });
		this.ports.onTranslatedTrackCreated?.(trackId);
	}

	/** Handle the worker rejecting the translated track (empty / malformed segments). */
	onTranslatedTrackError(reason: 'empty-segments' | 'malformed-segments', message: string): void {
		if (this.state.job) {
			this.updateJob({ phase: 'error', error: message });
		}
		this.ports.onTranslatedTrackError?.(reason, message);
	}

	/** Destroy sessions and clean up. */
	dispose(): void {
		this.cancel();
		this.translator?.destroy();
		this.translator = null;
		this.detector?.destroy();
		this.detector = null;
	}
}

export class TranslationCancelledError extends Error {
	constructor() {
		super('Translation cancelled');
		this.name = 'TranslationCancelledError';
	}
}
