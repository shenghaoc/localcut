/**
 * Phase 40: Translation controller — framework-free state machine.
 *
 * Orchestrates Chrome's built-in Translator and LanguageDetector APIs to
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
	/** Download progress [0,1] during downloading phase. */
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
	/** Whether any translator pair is at least downloadable. */
	available: boolean;
	/** Per-pair availability from the probe. */
	translatorAvailability: TranslatorAvailabilityMap;
	/** LanguageDetector availability. */
	languageDetectorAvailability: AiAvailability;
	/** Current translation job, or null if idle. */
	job: TranslateJobState | null;
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
	onError?(message: string): void;
}

// ── Ambient API shapes (match the .d.ts declarations) ──

interface TranslatorSession {
	translate(input: string, options?: { signal?: AbortSignal }): Promise<string>;
	destroy(): void;
}

interface DetectorSession {
	detect(input: string): Promise<{ detectedLanguage: string; confidence: number }>;
	destroy(): void;
}

interface TranslationAPI {
	canTranslate(options: {
		sourceLanguage: string;
		targetLanguage: string;
	}): Promise<'readily' | 'after-download' | 'no'>;
	createTranslator(options: {
		sourceLanguage: string;
		targetLanguage: string;
		monitor?: EventTarget;
	}): Promise<TranslatorSession>;
	createDetector(options?: { monitor?: EventTarget }): Promise<DetectorSession>;
}

// ── Controller ──

export class TranslationController {
	private readonly ports: TranslationControllerPorts;
	private state: TranslationControllerState;
	private readonly listeners = new Set<
		(state: TranslationControllerState) => void
	>();
	private translator: TranslatorSession | null = null;
	private detector: DetectorSession | null = null;
	private abortController: AbortController | null = null;

	constructor(ports: TranslationControllerPorts) {
		this.ports = ports;
		this.state = {
			probe: null,
			available: false,
			translatorAvailability: {},
			languageDetectorAvailability: 'unknown',
			job: null
		};
	}

	getState(): TranslationControllerState {
		return this.state;
	}

	subscribe(
		listener: (state: TranslationControllerState) => void
	): () => void {
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
	 *  completes or is re-run). */
	setProbe(probe: LanguageToolsProbeResult): void {
		const available =
			Object.values(probe.translator).some(
				a => a !== 'unavailable' && a !== 'unknown'
			) ||
			(probe.languageDetector !== 'unavailable' &&
				probe.languageDetector !== 'unknown');
		this.update({
			probe,
			available,
			translatorAvailability: probe.translator,
			languageDetectorAvailability: probe.languageDetector
		});
	}

	/** Get the translation API from the global scope. */
	private getTranslationApi(): TranslationAPI | null {
		try {
			const ns = (globalThis as Record<string, unknown>).translation;
			if (ns && typeof ns === 'object') return ns as TranslationAPI;
		} catch {
			// not available
		}
		return null;
	}

	/** Check if a specific translator pair is ready (available or downloadable). */
	isPairReady(source: 'zh' | 'en', target: 'zh' | 'en'): boolean {
		const key = `${source}->${target}`;
		const avail = this.state.translatorAvailability[key];
		return (
			avail === 'available' ||
			avail === 'downloadable' ||
			avail === 'downloading'
		);
	}

	/** Translate a caption track.
	 *
	 *  1. Detect language from a sample of segments
	 *  2. Create translator session (with download progress if needed)
	 *  3. Translate each segment, copying timing verbatim
	 *  4. Send result to worker for undoable insertion
	 */
	async translateTrack(
		track: CaptionTrackInfo,
		targetLang?: 'zh' | 'en',
		signal?: AbortSignal
	): Promise<void> {
		const api = this.getTranslationApi();
		if (!api) {
			this.update({ job: { phase: 'error', current: 0, total: 0, downloadFraction: null, detectedSource: null, targetLang: targetLang ?? 'en', durationMs: null, error: 'Translation API not available.' } });
			return;
		}

		const startedAt = Date.now();
		this.abortController = new AbortController();
		const combinedSignal = signal
			? AbortSignal.any([signal, this.abortController.signal])
			: this.abortController.signal;

		try {
			// Phase 1: detect language
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
				// User specified target; source is the opposite
				sourceLang = oppositeLanguage(targetLang);
			} else {
				// Auto-detect from a sample
				if (!this.detector) {
					this.detector = await api.createDetector();
				}
				const sampleSize = Math.min(5, track.segments.length);
				const detections = await Promise.all(
					track.segments.slice(0, sampleSize).map(seg =>
						this.detector!.detect(seg.text).catch(() => ({
							detectedLanguage: 'en',
							confidence: 0
						}))
					)
				);
				sourceLang = dominantLanguage(detections);
			}
			const resolvedTarget = targetLang ?? oppositeLanguage(sourceLang);

			this.updateJob({
				detectedSource: sourceLang,
				targetLang: resolvedTarget
			});

			// Phase 2: create translator (may trigger download)
			this.updateJob({ phase: 'downloading' });

			if (this.translator) {
				this.translator.destroy();
				this.translator = null;
			}

			// Create monitor for download progress
			const monitor = new EventTarget();
			monitor.addEventListener('downloadprogress', ((e: Event) => {
				const pe = e as ProgressEvent;
				const fraction =
					pe.total > 0 ? pe.loaded / pe.total : null;
				this.updateJob({ downloadFraction: fraction });
			}) as EventListener);

			this.translator = await api.createTranslator({
				sourceLanguage: sourceLang,
				targetLanguage: resolvedTarget,
				monitor
			});

			// Phase 3: translate each segment
			this.updateJob({
				phase: 'translating',
				downloadFraction: null
			});

			const translatedTexts: string[] = [];
			for (let i = 0; i < track.segments.length; i++) {
				if (combinedSignal.aborted) {
					throw new TranslationCancelledError();
				}
				this.updateJob({ current: i + 1 });
				const text = track.segments[i].text.trim();
				if (!text) {
					translatedTexts.push('');
					continue;
				}
				const translated = await this.translator.translate(text, {
					signal: combinedSignal
				});
				translatedTexts.push(translated);
				// Yield to keep the UI responsive
				await new Promise(resolve => setTimeout(resolve, 0));
			}

			// Build translated segments with timing copied verbatim
			const translatedSegments = buildTranslatedSegments(
				track.segments,
				translatedTexts
			);

			// Check for empty result
			const hasContent = translatedSegments.some(
				s => s.text.trim().length > 0
			);
			if (!hasContent) {
				throw new Error(
					'Translation produced no text. The source track may be empty.'
				);
			}

			// Phase 4: send to worker
			const trackName = `${track.name} (${resolvedTarget})`;
			this.ports.createTranslatedTrack({
				sourceTrackId: track.id,
				name: trackName,
				language: resolvedTarget,
				segments: translatedSegments
			});

			this.updateJob({
				phase: 'done',
				durationMs: Date.now() - startedAt
			});
		} catch (err) {
			if (err instanceof TranslationCancelledError) {
				this.updateJob({ phase: 'idle' });
				return;
			}
			const message =
				err instanceof Error ? err.message : String(err);
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
		this.ports.onTranslatedTrackCreated?.(trackId);
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
