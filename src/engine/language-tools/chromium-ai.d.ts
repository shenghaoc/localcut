/**
 * Ambient type declarations for Chrome's built-in AI APIs used by Phase 40.
 *
 * These APIs are exposed under the `translation` and `ai` namespaces on
 * `globalThis`. They are NOT in the standard TypeScript DOM typings.
 * Hand-authored to cover only the surface we use — no runtime dependency.
 *
 * @see https://developer.chrome.com/docs/ai/translator
 * @see https://developer.chrome.com/docs/ai/language-detector
 * @see https://developer.chrome.com/docs/ai/summarizer
 * @see https://developer.chrome.com/docs/ai/prompt-api
 */

/** Progress event for model downloads. */
interface AICreateMonitorEventMap {
	downloadprogress: ProgressEvent;
}

interface AICreateMonitor extends EventTarget {
	addEventListener<K extends keyof AICreateMonitorEventMap>(
		type: K,
		listener: (ev: AICreateMonitorEventMap[K]) => void
	): void;
	removeEventListener<K extends keyof AICreateMonitorEventMap>(
		type: K,
		listener: (ev: AICreateMonitorEventMap[K]) => void
	): void;
}

/** Options for creating an AI session with download monitoring. */
interface AICreateMonitorOptions {
	monitor?: AICreateMonitor;
}

// ── Translation namespace ──

type TranslatorCanTranslateResult = 'readily' | 'after-download' | 'no';

interface TranslatorTranslateOptions {
	signal?: AbortSignal;
}

interface Translator {
	translate(
		input: string,
		options?: TranslatorTranslateOptions
	): Promise<string>;
	destroy(): void;
}

interface TranslatorCreateOptions extends AICreateMonitorOptions {
	sourceLanguage: string;
	targetLanguage: string;
}

interface LanguageDetectorDetectResult {
	detectedLanguage: string;
	confidence: number;
}

interface LanguageDetector {
	detect(input: string): Promise<LanguageDetectorDetectResult>;
	destroy(): void;
}

interface TranslationNamespace {
	canTranslate(options: {
		sourceLanguage: string;
		targetLanguage: string;
	}): Promise<TranslatorCanTranslateResult>;
	canDetect(language: string): Promise<TranslatorCanTranslateResult>;
	createTranslator(options: TranslatorCreateOptions): Promise<Translator>;
	createDetector(options?: AICreateMonitorOptions): Promise<LanguageDetector>;
}

// ── AI namespace (Summarizer + LanguageModel) ──

type AiAvailabilityResult = 'readily' | 'after-download' | 'no';

interface AiCapabilitiesResult {
	available: AiAvailabilityResult;
}

interface SummarizerCreateOptions extends AICreateMonitorOptions {
	type?: 'tldr' | 'key-points' | 'teaser';
	format?: 'plain-text' | 'markdown';
	sharedContext?: string;
}

interface Summarizer {
	summarize(
		input: string,
		options?: { signal?: AbortSignal }
	): Promise<string>;
	summarizeStreaming(
		input: string,
		options?: { signal?: AbortSignal }
	): ReadableStream<string>;
	countTokens(input: string): Promise<number>;
	destroy(): void;
}

interface SummarizerFactory {
	capabilities(): Promise<AiCapabilitiesResult>;
	create(options?: SummarizerCreateOptions): Promise<Summarizer>;
}

interface LanguageModelCreateOptions extends AICreateMonitorOptions {
	signal?: AbortSignal;
}

interface LanguageModelPromptOptions {
	signal?: AbortSignal;
}

interface LanguageModel {
	prompt(
		input: string,
		options?: LanguageModelPromptOptions
	): Promise<string>;
	promptStreaming(
		input: string,
		options?: LanguageModelPromptOptions
	): ReadableStream<string>;
	countTokens(input: string): Promise<number>;
	destroy(): void;
}

interface LanguageModelFactory {
	capabilities(): Promise<AiCapabilitiesResult>;
	create(options?: LanguageModelCreateOptions): Promise<LanguageModel>;
}

interface AiNamespace {
	summarizer: SummarizerFactory;
	languageModel: LanguageModelFactory;
}

// ── Global augmentation ──

interface Window {
	translation?: TranslationNamespace;
	ai?: AiNamespace;
}

interface WorkerGlobalScope {
	translation?: TranslationNamespace;
	ai?: AiNamespace;
}
