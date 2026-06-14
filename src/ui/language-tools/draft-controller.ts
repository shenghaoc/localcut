/**
 * Phase 40: Draft controller — framework-free state machine.
 *
 * Orchestrates Chrome's built-in Summarizer and LanguageModel (Prompt API)
 * to draft titles, hashtags, and 文案 from a caption track's transcript.
 *
 * Runs on the main thread. Output is read-only and copyable — never written
 * to the project document.
 */
import type {
	AiAvailability,
	LanguageToolsProbeResult
} from '../../protocol';
import { assembleTranscript } from '../../engine/language-tools/transcript';
import {
	buildDraftPrompt,
	buildSummarizerOptions,
	parseDraftResponse,
	type ParsedDraft
} from '../../engine/language-tools/draft-prompts';
import type { CaptionSegmentSnapshot } from '../../protocol';

// ── Types ──

export type DraftPhase = 'idle' | 'summarizing' | 'generating' | 'done' | 'error';

export interface DraftControllerState {
	/** Summarizer availability from the probe. */
	summarizerAvailability: AiAvailability;
	/** LanguageModel (Prompt API) availability from the probe. */
	languageModelAvailability: AiAvailability;
	/** Whether any draft tool is available. */
	available: boolean;
	/** Current draft job state. */
	job: DraftJobState | null;
}

export interface DraftJobState {
	phase: DraftPhase;
	/** Whether the user requested cancellation. */
	cancelled: boolean;
	/** Accumulated streamed text from the Prompt API. */
	streamedText: string;
	/** Parsed draft result (populated on done). */
	draft: ParsedDraft | null;
	/** Summary from the Summarizer (if used). */
	summary: string | null;
	/** Error message if phase is 'error'. */
	error: string | null;
	/** Duration of the completed job in ms. */
	durationMs: number | null;
}

// ── Ambient API shapes ──

interface SummarizerSession {
	summarize(input: string, options?: { signal?: AbortSignal }): Promise<string>;
	countTokens(input: string): Promise<number>;
	destroy(): void;
}

interface LanguageModelSession {
	promptStreaming(
		input: string,
		options?: { signal?: AbortSignal }
	): ReadableStream<string>;
	countTokens(input: string): Promise<number>;
	destroy(): void;
}

interface AiAPI {
	summarizer?: {
		capabilities(): Promise<{ available: string }>;
		create(options?: {
			type?: string;
			format?: string;
			monitor?: EventTarget;
		}): Promise<SummarizerSession>;
	};
	languageModel?: {
		capabilities(): Promise<{ available: string }>;
		create(options?: {
			monitor?: EventTarget;
			signal?: AbortSignal;
		}): Promise<LanguageModelSession>;
	};
}

// ── Controller ──

export class DraftController {
	private state: DraftControllerState;
	private readonly listeners = new Set<
		(state: DraftControllerState) => void
	>();
	private summarizer: SummarizerSession | null = null;
	private languageModel: LanguageModelSession | null = null;
	private abortController: AbortController | null = null;

	constructor() {
		this.state = {
			summarizerAvailability: 'unknown',
			languageModelAvailability: 'unknown',
			available: false,
			job: null
		};
	}

	getState(): DraftControllerState {
		return this.state;
	}

	subscribe(
		listener: (state: DraftControllerState) => void
	): () => void {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	private update(partial: Partial<DraftControllerState>): void {
		this.state = { ...this.state, ...partial };
		for (const listener of this.listeners) listener(this.state);
	}

	private updateJob(partial: Partial<DraftJobState>): void {
		if (!this.state.job) return;
		this.update({ job: { ...this.state.job, ...partial } });
	}

	/** Update the probe result. */
	setProbe(probe: LanguageToolsProbeResult): void {
		const available =
			(probe.summarizer !== 'unavailable' &&
				probe.summarizer !== 'unknown') ||
			(probe.languageModel !== 'unavailable' &&
				probe.languageModel !== 'unknown');
		this.update({
			summarizerAvailability: probe.summarizer,
			languageModelAvailability: probe.languageModel,
			available
		});
	}

	private getAiApi(): AiAPI | null {
		try {
			const ns = (globalThis as Record<string, unknown>).ai;
			if (ns && typeof ns === 'object') return ns as AiAPI;
		} catch {
			// not available
		}
		return null;
	}

	/** Whether the Summarizer is usable. */
	get summarizerReady(): boolean {
		const a = this.state.summarizerAvailability;
		return a === 'available' || a === 'downloadable';
	}

	/** Whether the LanguageModel (Prompt API) is usable. */
	get languageModelReady(): boolean {
		const a = this.state.languageModelAvailability;
		return a === 'available' || a === 'downloadable';
	}

	/** Generate a draft from a caption track's transcript. */
	async generateDraft(
		segments: readonly CaptionSegmentSnapshot[],
		signal?: AbortSignal
	): Promise<void> {
		const api = this.getAiApi();
		if (!api) {
			this.update({
				job: {
					phase: 'error',
					cancelled: false,
					streamedText: '',
					draft: null,
					summary: null,
					error: 'AI API not available.',
					durationMs: null
				}
			});
			return;
		}

		const startedAt = Date.now();
		this.abortController = new AbortController();
		const combinedSignal = signal
			? AbortSignal.any([signal, this.abortController.signal])
			: this.abortController.signal;

		try {
			this.update({
				job: {
					phase: 'summarizing',
					cancelled: false,
					streamedText: '',
					draft: null,
					summary: null,
					error: null,
					durationMs: null
				}
			});

			const transcript = assembleTranscript(segments);
			if (!transcript) {
				throw new Error('Transcript is empty — nothing to draft from.');
			}

			// Step 1: Summarize if available
			let condensed = transcript;
			if (this.summarizerReady && api.summarizer) {
				if (!this.summarizer) {
					this.summarizer = await api.summarizer.create(
						buildSummarizerOptions()
					);
				}

				// Check if we need to chunk
				const tokenCount =
					await this.summarizer.countTokens(transcript);
				// Gemini Nano's effective context is ~4k tokens. Reserve ~1k for
				// the summarizer's internal prompt overhead so the input fits.
				const maxTokens = 3000;

				if (tokenCount > maxTokens) {
					// Chunk and summarize hierarchically
					const words = transcript.split(/\s+/);
					const chunkSize = Math.ceil(
						(words.length * maxTokens) / tokenCount
					);
					const chunks: string[] = [];
					for (let i = 0; i < words.length; i += chunkSize) {
						chunks.push(
							words.slice(i, i + chunkSize).join(' ')
						);
					}
					// Summarize chunks; catch individual failures so one
					// bad chunk doesn't abort the entire draft.
					const summaries = await Promise.all(
						chunks.map(chunk =>
							this.summarizer!.summarize(chunk, {
								signal: combinedSignal
							}).catch(() => chunk) // fall back to raw text
						)
					);
					condensed = summaries.join(' ');
					// Summarize the summaries
					if (summaries.length > 1) {
						condensed = await this.summarizer.summarize(
							condensed,
							{ signal: combinedSignal }
						);
					}
				} else {
					condensed = await this.summarizer.summarize(transcript, {
						signal: combinedSignal
					});
				}
				this.updateJob({ summary: condensed });
			}

			// Step 2: Generate drafts with Prompt API
			if (this.languageModelReady && api.languageModel) {
				this.updateJob({ phase: 'generating' });

				if (!this.languageModel) {
					this.languageModel = await api.languageModel.create({
						signal: combinedSignal
					});
				}

				const prompt = buildDraftPrompt(condensed);
				const stream =
					await this.languageModel.promptStreaming(prompt, {
						signal: combinedSignal
					});

				let accumulated = '';
				const reader = stream.getReader();
				try {
					while (true) {
						if (combinedSignal.aborted) {
							throw new DraftCancelledError();
						}
						const { done, value } = await reader.read();
						if (done) break;
						accumulated += value;
						this.updateJob({ streamedText: accumulated });
					}
				} finally {
					reader.releaseLock();
				}

				const draft = parseDraftResponse(accumulated);
				this.updateJob({
					phase: 'done',
					draft,
					durationMs: Date.now() - startedAt
				});
			} else {
				// Only summarizer available — show summary as description
				this.updateJob({
					phase: 'done',
					draft: {
						titles: [],
						hashtags: [],
						caption: condensed
					},
					durationMs: Date.now() - startedAt
				});
			}
		} catch (err) {
			if (err instanceof DraftCancelledError) {
				this.updateJob({ phase: 'idle', cancelled: true });
				return;
			}
			const message =
				err instanceof Error ? err.message : String(err);
			this.updateJob({ phase: 'error', error: message });
		} finally {
			this.abortController = null;
		}
	}

	/** Cancel the current draft job. */
	cancel(): void {
		this.abortController?.abort();
	}

	/** Destroy sessions and clean up. */
	dispose(): void {
		this.cancel();
		this.summarizer?.destroy();
		this.summarizer = null;
		this.languageModel?.destroy();
		this.languageModel = null;
	}
}

export class DraftCancelledError extends Error {
	constructor() {
		super('Draft generation cancelled');
		this.name = 'DraftCancelledError';
	}
}
