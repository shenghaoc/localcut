/**
 * Phase 40: On-Device Language Tools capability probe.
 *
 * Chrome's built-in AI is exposed as global classes — `Translator`,
 * `LanguageDetector`, `Summarizer`, `LanguageModel` — each with a static
 * `availability()` method that returns `'available' | 'downloadable' |
 * 'downloading' | 'unavailable'`. This probe maps those straight through.
 *
 * Side-effect free: it never calls `create()`, never downloads, never opens a
 * session. Safe to call at boot and re-run without consequences.
 */
import type {
	AiAvailability,
	LanguageToolsProbeResult,
	TranslatorAvailabilityMap
} from '../../protocol';

/** Static shape of `Translator` we probe. */
interface TranslatorStatic {
	availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
}

/** Static shape shared by `LanguageDetector` / `Summarizer` / `LanguageModel`. */
interface AvailabilityStatic {
	availability(options?: unknown): Promise<string>;
}

/**
 * Scope exposing the Chrome AI globals. Defaults to `globalThis`; accept a
 * param so tests can inject mock globals without touching the real scope.
 */
export interface LanguageToolsScope {
	Translator?: TranslatorStatic;
	LanguageDetector?: AvailabilityStatic;
	Summarizer?: AvailabilityStatic;
	LanguageModel?: AvailabilityStatic;
}

/** Map a raw `availability()` string to our normalized set; anything
 *  unexpected (or a missing API) becomes `'unknown'`. */
function normalize(value: string): AiAvailability {
	switch (value) {
		case 'available':
		case 'downloadable':
		case 'downloading':
		case 'unavailable':
			return value;
		default:
			return 'unknown';
	}
}

/** Run an `availability()` call, returning `'unknown'` if the API is absent or throws. */
async function safeAvailability(
	api: { availability(options?: unknown): Promise<string> } | undefined,
	options?: unknown
): Promise<AiAvailability> {
	try {
		if (!api || typeof api.availability !== 'function') return 'unknown';
		return normalize(await api.availability(options));
	} catch {
		return 'unknown';
	}
}

async function probeTranslatorPair(
	scope: LanguageToolsScope,
	sourceLanguage: string,
	targetLanguage: string
): Promise<AiAvailability> {
	return safeAvailability(scope.Translator, { sourceLanguage, targetLanguage });
}

/**
 * Probe all Chrome built-in AI APIs used by Phase 40.
 *
 * @param scope Object exposing the AI globals (defaults to `globalThis`).
 */
export async function probeLanguageTools(
	scope: LanguageToolsScope = globalThis as unknown as LanguageToolsScope
): Promise<LanguageToolsProbeResult> {
	const [enToZh, zhToEn, languageDetector, summarizer, languageModel] = await Promise.all([
		probeTranslatorPair(scope, 'en', 'zh'),
		probeTranslatorPair(scope, 'zh', 'en'),
		safeAvailability(scope.LanguageDetector),
		safeAvailability(scope.Summarizer),
		safeAvailability(scope.LanguageModel)
	]);

	const translator: TranslatorAvailabilityMap = {
		'en->zh': enToZh,
		'zh->en': zhToEn
	};

	return { translator, languageDetector, summarizer, languageModel };
}
