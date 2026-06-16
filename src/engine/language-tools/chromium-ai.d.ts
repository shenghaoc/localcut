/**
 * Ambient type declarations for Chrome's built-in AI APIs used by Phase 40.
 *
 * Current Chrome (138+) exposes these as **global classes** with static
 * `availability()` / `create()` methods — NOT under `window.ai` / `window.translation`,
 * which was the deprecated 2024 early-preview surface. Hand-authored to cover only
 * the surface we use — no runtime dependency.
 *
 * @see https://developer.chrome.com/docs/ai/translator-api
 * @see https://developer.chrome.com/docs/ai/language-detection
 * @see https://developer.chrome.com/docs/ai/summarizer-api
 * @see https://developer.chrome.com/docs/ai/prompt-api
 */

type AIAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

/**
 * `downloadprogress` reports `loaded` as a fraction in `[0, 1]`. There is no
 * `total` property — by design, to stop sites from fingerprinting users via the
 * shared model-download state.
 */
interface AIDownloadProgressEvent extends Event {
	readonly loaded: number;
}

interface AICreateMonitor extends EventTarget {
	addEventListener(
		type: 'downloadprogress',
		listener: (event: AIDownloadProgressEvent) => void
	): void;
	removeEventListener(
		type: 'downloadprogress',
		listener: (event: AIDownloadProgressEvent) => void
	): void;
}

/** `monitor` is a callback that receives the monitor, not an EventTarget you pass in. */
type AICreateMonitorCallback = (monitor: AICreateMonitor) => void;

interface AICreateOptions {
	monitor?: AICreateMonitorCallback;
	signal?: AbortSignal;
}

// ── Translator ──

interface TranslatorTranslateOptions {
	signal?: AbortSignal;
}

interface Translator {
	translate(input: string, options?: TranslatorTranslateOptions): Promise<string>;
	translateStreaming(input: string, options?: TranslatorTranslateOptions): ReadableStream<string>;
	destroy(): void;
}

interface TranslatorLanguagePair {
	sourceLanguage: string;
	targetLanguage: string;
}

declare const Translator: {
	availability(options: TranslatorLanguagePair): Promise<AIAvailability>;
	create(options: TranslatorLanguagePair & AICreateOptions): Promise<Translator>;
};

// ── LanguageDetector ──

interface LanguageDetectionResult {
	detectedLanguage: string;
	confidence: number;
}

interface LanguageDetector {
	/** Returns candidates sorted by descending confidence. */
	detect(input: string, options?: { signal?: AbortSignal }): Promise<LanguageDetectionResult[]>;
	destroy(): void;
}

declare const LanguageDetector: {
	availability(): Promise<AIAvailability>;
	create(options?: AICreateOptions): Promise<LanguageDetector>;
};

// ── Summarizer ──

interface SummarizerSummarizeOptions {
	context?: string;
	signal?: AbortSignal;
}

interface Summarizer {
	summarize(input: string, options?: SummarizerSummarizeOptions): Promise<string>;
	summarizeStreaming(input: string, options?: SummarizerSummarizeOptions): ReadableStream<string>;
	measureInputUsage(input: string, options?: { signal?: AbortSignal }): Promise<number>;
	readonly inputQuota: number;
	destroy(): void;
}

interface SummarizerCreateOptions extends AICreateOptions {
	type?: 'tldr' | 'key-points' | 'teaser' | 'headline';
	format?: 'plain-text' | 'markdown';
	length?: 'short' | 'medium' | 'long';
	sharedContext?: string;
	expectedInputLanguages?: string[];
	outputLanguage?: string;
}

declare const Summarizer: {
	availability(options?: SummarizerCreateOptions): Promise<AIAvailability>;
	create(options?: SummarizerCreateOptions): Promise<Summarizer>;
};

// ── LanguageModel (Prompt API) ──

interface LanguageModelPromptOptions {
	signal?: AbortSignal;
}

interface LanguageModelInitialPrompt {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

interface LanguageModel {
	prompt(input: string, options?: LanguageModelPromptOptions): Promise<string>;
	promptStreaming(input: string, options?: LanguageModelPromptOptions): ReadableStream<string>;
	measureInputUsage(input: string, options?: { signal?: AbortSignal }): Promise<number>;
	readonly inputQuota: number;
	readonly inputUsage: number;
	destroy(): void;
}

interface LanguageModelCreateOptions extends AICreateOptions {
	initialPrompts?: LanguageModelInitialPrompt[];
	temperature?: number;
	topK?: number;
}

declare const LanguageModel: {
	availability(options?: LanguageModelCreateOptions): Promise<AIAvailability>;
	create(options?: LanguageModelCreateOptions): Promise<LanguageModel>;
};
