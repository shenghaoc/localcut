/**
 * Phase 40: On-Device Language Tools capability probe.
 *
 * Chrome's built-in AI APIs (Translator, LanguageDetector, Summarizer,
 * LanguageModel) are exposed under the `translation` and `ai` namespaces.
 * This probe performs feature-detection + availability/capability checks
 * only — it never calls `create()`, never downloads, never opens a session.
 *
 * Side-effect free: safe to call at boot and re-run without consequences.
 */
import type {
	AiAvailability,
	LanguageToolsProbeResult,
	TranslatorAvailabilityMap
} from '../../protocol';

/** Raw return from `translation.canTranslate()`. */
type CanTranslateResult = 'readily' | 'after-download' | 'no';

/** Raw return from `ai.summarizer.capabilities()` / `ai.languageModel.capabilities()`. */
interface AiCapabilitiesResult {
	available: 'readily' | 'after-download' | 'no';
}

/** Minimal shape of the `translation` namespace we probe. */
interface TranslationNamespace {
	canTranslate(options: {
		sourceLanguage: string;
		targetLanguage: string;
	}): Promise<CanTranslateResult>;
}

/** Minimal shape of the `ai` namespace we probe. */
interface AiNamespace {
	summarizer?: {
		capabilities(): Promise<AiCapabilitiesResult>;
	};
	languageModel?: {
		capabilities(): Promise<AiCapabilitiesResult>;
	};
}

/** Scope object that may contain the Chrome AI namespaces. */
export interface LanguageToolsScope {
	translation?: TranslationNamespace;
	ai?: AiNamespace;
}

function mapCanTranslate(result: CanTranslateResult): AiAvailability {
	switch (result) {
		case 'readily':
			return 'available';
		case 'after-download':
			return 'downloadable';
		case 'no':
			return 'unavailable';
	}
}

function mapCapabilities(result: AiCapabilitiesResult): AiAvailability {
	switch (result.available) {
		case 'readily':
			return 'available';
		case 'after-download':
			return 'downloadable';
		case 'no':
			return 'unavailable';
	}
}

/** Check one translator pair's availability. Returns 'unknown' if the API
 *  is not feature-detected or the call fails. */
async function probeTranslatorPair(
	scope: LanguageToolsScope,
	sourceLanguage: string,
	targetLanguage: string
): Promise<AiAvailability> {
	try {
		const ns = scope.translation;
		if (!ns) return 'unknown';
		const result = await ns.canTranslate({ sourceLanguage, targetLanguage });
		return mapCanTranslate(result);
	} catch {
		return 'unknown';
	}
}

/** Probe LanguageDetector availability via `translation.canTranslate()`.
 *  LanguageDetector shares the translation download, so we check the
 *  translation namespace's general readiness. */
async function probeLanguageDetector(scope: LanguageToolsScope): Promise<AiAvailability> {
	try {
		const ns = scope.translation;
		if (!ns) return 'unknown';
		// LanguageDetector shares the translation infrastructure.
		// Use a trivial pair to check if the translation namespace is usable.
		const result = await ns.canTranslate({
			sourceLanguage: 'en',
			targetLanguage: 'zh'
		});
		// If translation is at least downloadable, detection is too.
		return mapCanTranslate(result);
	} catch {
		return 'unknown';
	}
}

async function probeSummarizer(scope: LanguageToolsScope): Promise<AiAvailability> {
	try {
		const summarizer = scope.ai?.summarizer;
		if (!summarizer) return 'unknown';
		const result = await summarizer.capabilities();
		return mapCapabilities(result);
	} catch {
		return 'unknown';
	}
}

async function probeLanguageModel(scope: LanguageToolsScope): Promise<AiAvailability> {
	try {
		const languageModel = scope.ai?.languageModel;
		if (!languageModel) return 'unknown';
		const result = await languageModel.capabilities();
		return mapCapabilities(result);
	} catch {
		return 'unknown';
	}
}

/**
 * Probe all Chrome built-in AI APIs used by Phase 40.
 *
 * The probe is side-effect-free: it never calls `create()`, never downloads,
 * and never opens a session. Safe to call at boot and re-run.
 *
 * @param scope Object exposing `translation` and `ai` namespaces
 *              (defaults to `globalThis`). Accept a scope param for testability.
 */
export async function probeLanguageTools(
	scope: LanguageToolsScope = globalThis as unknown as LanguageToolsScope
): Promise<LanguageToolsProbeResult> {
	const [enToZh, zhToEn, languageDetector, summarizer, languageModel] = await Promise.all([
		probeTranslatorPair(scope, 'en', 'zh'),
		probeTranslatorPair(scope, 'zh', 'en'),
		probeLanguageDetector(scope),
		probeSummarizer(scope),
		probeLanguageModel(scope)
	]);

	const translator: TranslatorAvailabilityMap = {
		'en->zh': enToZh,
		'zh->en': zhToEn
	};

	return { translator, languageDetector, summarizer, languageModel };
}
