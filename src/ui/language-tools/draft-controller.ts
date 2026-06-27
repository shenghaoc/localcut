import { currentEpochMs } from '../../time';
/**
 * Phase 40: Draft controller — framework-free state machine.
 *
 * Orchestrates Chrome's built-in `Summarizer` and `LanguageModel` (Prompt API)
 * globals to draft titles, hashtags, and 文案 from a caption track's transcript.
 *
 * Runs on the main thread. Output is read-only and copyable — never written to
 * the project document.
 */
import type {
	AiAvailability,
	CaptionSegmentSnapshot,
	LanguageToolsProbeResult
} from '../../protocol';
import { assembleTranscript } from '../../engine/language-tools/transcript';
import {
	buildDraftPrompt,
	buildSummarizerOptions,
	parseDraftResponse,
	type ParsedDraft
} from '../../engine/language-tools/draft-prompts';

// ── Types ──

export type DraftPhase = 'idle' | 'preparing' | 'summarizing' | 'generating' | 'done' | 'error';

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
	/** Model-download progress [0,1] during the preparing phase, or null. */
	downloadFraction: number | null;
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

/** Tokens reserved for the prompt scaffold + room for the model's own response,
 *  so the bounded transcript leaves headroom inside the input quota. */
const PROMPT_RESERVE_TOKENS = 512;

function isUsable(a: AiAvailability | undefined): boolean {
	return a === 'available' || a === 'downloadable' || a === 'downloading';
}

/** Split text into whitespace-delimited chunks of at most `budgetChars`. */
function chunkByLength(text: string, budgetChars: number): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	const chunks: string[] = [];
	let current = '';
	for (const word of words) {
		if (current && current.length + 1 + word.length > budgetChars) {
			chunks.push(current);
			current = word;
		} else {
			current = current ? `${current} ${word}` : word;
		}
	}
	if (current) chunks.push(current);
	return chunks.length > 0 ? chunks : [text];
}

/** Trim `text` so it fits within a session's input quota (minus a reserve),
 *  measured via the session's own tokenizer. Returns `text` unchanged when the
 *  session exposes no quota/measurement. */
async function boundToQuota(
	session: { measureInputUsage(input: string): Promise<number>; readonly inputQuota: number },
	text: string,
	reserve: number,
	signal?: AbortSignal
): Promise<string> {
	const quota = session.inputQuota;
	if (typeof session.measureInputUsage !== 'function' || !quota || !Number.isFinite(quota)) {
		return text;
	}
	const budget = Math.max(1, quota - reserve);
	let used: number;
	try {
		used = await session.measureInputUsage(text);
	} catch {
		return text;
	}
	if (signal?.aborted) throw new DraftCancelledError();
	if (used <= budget) return text;
	const ratio = Math.max(0.05, budget / used);
	return text.slice(0, Math.max(0, Math.floor(text.length * ratio)));
}

export interface DraftControllerPorts {
	onError?(message: string): void;
}

// ── Controller ──

export class DraftController {
	private readonly ports: DraftControllerPorts;
	private state: DraftControllerState;
	private readonly listeners = new Set<(state: DraftControllerState) => void>();
	private summarizer: Summarizer | null = null;
	private languageModel: LanguageModel | null = null;
	private abortController: AbortController | null = null;

	constructor(ports: DraftControllerPorts = {}) {
		this.ports = ports;
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

	subscribe(listener: (state: DraftControllerState) => void): () => void {
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
		this.update({
			summarizerAvailability: probe.summarizer,
			languageModelAvailability: probe.languageModel,
			available: isUsable(probe.summarizer) || isUsable(probe.languageModel)
		});
	}

	private get summarizerStatic(): typeof Summarizer | undefined {
		return (globalThis as { Summarizer?: typeof Summarizer }).Summarizer;
	}

	private get languageModelStatic(): typeof LanguageModel | undefined {
		return (globalThis as { LanguageModel?: typeof LanguageModel }).LanguageModel;
	}

	/** Whether the Summarizer is usable. */
	get summarizerReady(): boolean {
		return isUsable(this.state.summarizerAvailability);
	}

	/** Whether the LanguageModel (Prompt API) is usable. */
	get languageModelReady(): boolean {
		return isUsable(this.state.languageModelAvailability);
	}

	/** Generate a draft from a caption track's transcript. */
	async generateDraft(
		segments: readonly CaptionSegmentSnapshot[],
		signal?: AbortSignal
	): Promise<void> {
		const Summarizer = this.summarizerReady ? this.summarizerStatic : undefined;
		const LanguageModel = this.languageModelReady ? this.languageModelStatic : undefined;

		const startJob = (phase: DraftPhase, error: string | null = null): void => {
			this.update({
				job: {
					phase,
					cancelled: false,
					downloadFraction: null,
					streamedText: '',
					draft: null,
					summary: null,
					error,
					durationMs: null
				}
			});
		};

		if (!Summarizer && !LanguageModel) {
			startJob('error', 'On-device drafting is unavailable in this browser.');
			return;
		}

		const transcript = assembleTranscript(segments);
		if (!transcript) {
			startJob('error', 'Transcript is empty — nothing to draft from.');
			return;
		}

		const startedAt = currentEpochMs();
		this.abortController = new AbortController();
		const combinedSignal = signal
			? AbortSignal.any([signal, this.abortController.signal])
			: this.abortController.signal;

		const monitor: AICreateMonitorCallback = (m) => {
			m.addEventListener('downloadprogress', (e) => {
				// e.loaded is a fraction in [0, 1]; there is no e.total.
				this.updateJob({ downloadFraction: e.loaded });
			});
		};

		try {
			startJob('preparing');

			// Create both sessions up-front, while we still hold the click's
			// transient user activation. Awaiting summarization before creating
			// the Prompt session would drop activation and fail a cold download.
			const creates: Promise<void>[] = [];
			if (Summarizer && !this.summarizer) {
				creates.push(
					Summarizer.create({ ...buildSummarizerOptions(), monitor, signal: combinedSignal }).then(
						(s) => {
							this.summarizer = s;
						}
					)
				);
			}
			if (LanguageModel && !this.languageModel) {
				creates.push(
					LanguageModel.create({ monitor, signal: combinedSignal }).then((m) => {
						this.languageModel = m;
					})
				);
			}
			await Promise.all(creates);
			this.updateJob({ downloadFraction: null });
			if (combinedSignal.aborted) throw new DraftCancelledError();

			// Step 1: condense the transcript (bounded + hierarchical) if a
			// Summarizer is available.
			let condensed = transcript;
			if (this.summarizer) {
				this.updateJob({ phase: 'summarizing' });
				condensed = await this.condense(this.summarizer, transcript, combinedSignal);
				this.updateJob({ summary: condensed });
			}

			// Step 2: draft with the Prompt API, if available.
			if (this.languageModel) {
				this.updateJob({ phase: 'generating' });
				// Bound the input to the model's quota even when no summarizer ran,
				// so long transcripts don't overflow Gemini Nano's context.
				const bounded = await boundToQuota(
					this.languageModel,
					condensed,
					PROMPT_RESERVE_TOKENS,
					combinedSignal
				);
				const prompt = buildDraftPrompt(bounded);
				const stream = this.languageModel.promptStreaming(prompt, { signal: combinedSignal });

				let accumulated = '';
				const reader = stream.getReader();
				try {
					for (;;) {
						if (combinedSignal.aborted) throw new DraftCancelledError();
						const { done, value } = await reader.read();
						if (done) break;
						accumulated += value;
						this.updateJob({ streamedText: accumulated });
					}
				} finally {
					reader.releaseLock();
				}

				this.updateJob({
					phase: 'done',
					draft: parseDraftResponse(accumulated),
					durationMs: currentEpochMs() - startedAt
				});
			} else {
				// Summarizer only — present the summary as a draft caption.
				this.updateJob({
					phase: 'done',
					draft: { titles: [], hashtags: [], caption: condensed },
					durationMs: currentEpochMs() - startedAt
				});
			}
		} catch (err) {
			if (err instanceof DraftCancelledError) {
				this.updateJob({ phase: 'idle', cancelled: true });
				return;
			}
			const message = err instanceof Error ? err.message : String(err);
			this.updateJob({ phase: 'error', error: message });
			this.ports.onError?.(message);
		} finally {
			this.abortController = null;
		}
	}

	/** Condense a transcript to fit the summarizer's input quota, chunking and
	 *  summarizing hierarchically when it is too long. */
	private async condense(
		summarizer: Summarizer,
		transcript: string,
		signal: AbortSignal
	): Promise<string> {
		const quota = summarizer.inputQuota;
		let used = 0;
		if (typeof summarizer.measureInputUsage === 'function' && quota && Number.isFinite(quota)) {
			try {
				used = await summarizer.measureInputUsage(transcript);
			} catch {
				used = 0;
			}
		}
		if (signal.aborted) throw new DraftCancelledError();

		if (quota && used > quota) {
			const budget = Math.max(500, Math.floor((transcript.length * quota) / used) - 1);
			const chunks = chunkByLength(transcript, budget);
			const summaries = await Promise.all(
				chunks.map((chunk) => summarizer.summarize(chunk, { signal }).catch(() => chunk))
			);
			let condensed = summaries.join(' ');
			if (summaries.length > 1) {
				condensed = await summarizer.summarize(condensed, { signal });
			}
			return condensed;
		}
		return summarizer.summarize(transcript, { signal });
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
