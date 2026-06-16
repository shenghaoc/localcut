/**
 * Phase 40: Language Tools probe tests.
 *
 * The probe reads Chrome's global AI classes (`Translator`, `LanguageDetector`,
 * `Summarizer`, `LanguageModel`) and maps their static `availability()` straight
 * through. Tests inject a mock scope — never the real globals.
 */
import { describe, expect, it } from 'vite-plus/test';
import { probeLanguageTools, type LanguageToolsScope } from './probe';
import { languageToolsSurfaceVisible } from '../../protocol';

function staticOf(value?: string) {
	return value === undefined ? undefined : { availability: async () => value };
}

function mockScope(
	options: {
		translator?: string;
		languageDetector?: string;
		summarizer?: string;
		languageModel?: string;
	} = {}
): LanguageToolsScope {
	return {
		Translator:
			options.translator === undefined
				? undefined
				: { availability: async () => options.translator! },
		LanguageDetector: staticOf(options.languageDetector),
		Summarizer: staticOf(options.summarizer),
		LanguageModel: staticOf(options.languageModel)
	};
}

describe('probeLanguageTools', () => {
	it('returns unknown for all APIs when scope is empty', async () => {
		const result = await probeLanguageTools({});
		expect(result.translator['en->zh']).toBe('unknown');
		expect(result.translator['zh->en']).toBe('unknown');
		expect(result.languageDetector).toBe('unknown');
		expect(result.summarizer).toBe('unknown');
		expect(result.languageModel).toBe('unknown');
	});

	it('maps the four platform states straight through', async () => {
		expect(
			(await probeLanguageTools(mockScope({ translator: 'available' }))).translator['en->zh']
		).toBe('available');
		expect(
			(await probeLanguageTools(mockScope({ translator: 'downloadable' }))).translator['en->zh']
		).toBe('downloadable');
		expect(
			(await probeLanguageTools(mockScope({ translator: 'downloading' }))).translator['en->zh']
		).toBe('downloading');
		expect(
			(await probeLanguageTools(mockScope({ translator: 'unavailable' }))).translator['en->zh']
		).toBe('unavailable');
	});

	it('normalizes unexpected/legacy return values to unknown', async () => {
		// 'readily' was the deprecated early-preview value; it must not leak through.
		const result = await probeLanguageTools(mockScope({ translator: 'readily' }));
		expect(result.translator['en->zh']).toBe('unknown');
	});

	it('probes both translator directions independently', async () => {
		const scope: LanguageToolsScope = {
			Translator: {
				availability: async (o: { sourceLanguage: string; targetLanguage: string }) =>
					o.sourceLanguage === 'en' ? 'available' : 'downloadable'
			}
		};
		const result = await probeLanguageTools(scope);
		expect(result.translator['en->zh']).toBe('available');
		expect(result.translator['zh->en']).toBe('downloadable');
	});

	it('maps summarizer and languageModel availability', async () => {
		const result = await probeLanguageTools(
			mockScope({ summarizer: 'available', languageModel: 'downloadable' })
		);
		expect(result.summarizer).toBe('available');
		expect(result.languageModel).toBe('downloadable');
	});

	it('maps languageDetector availability', async () => {
		const result = await probeLanguageTools(mockScope({ languageDetector: 'available' }));
		expect(result.languageDetector).toBe('available');
	});

	it('handles all APIs available', async () => {
		const result = await probeLanguageTools(
			mockScope({
				translator: 'available',
				languageDetector: 'available',
				summarizer: 'available',
				languageModel: 'available'
			})
		);
		expect(result.translator['en->zh']).toBe('available');
		expect(result.translator['zh->en']).toBe('available');
		expect(result.languageDetector).toBe('available');
		expect(result.summarizer).toBe('available');
		expect(result.languageModel).toBe('available');
	});

	it('handles an API throwing gracefully', async () => {
		const scope: LanguageToolsScope = {
			Translator: {
				availability: async () => {
					throw new Error('API error');
				}
			}
		};
		const result = await probeLanguageTools(scope);
		expect(result.translator['en->zh']).toBe('unknown');
	});
});

describe('languageToolsSurfaceVisible', () => {
	it('returns false when all APIs are unknown', () => {
		expect(
			languageToolsSurfaceVisible({
				translator: { 'en->zh': 'unknown', 'zh->en': 'unknown' },
				languageDetector: 'unknown',
				summarizer: 'unknown',
				languageModel: 'unknown'
			})
		).toBe(false);
	});

	it('returns false when all APIs are unavailable', () => {
		expect(
			languageToolsSurfaceVisible({
				translator: { 'en->zh': 'unavailable', 'zh->en': 'unavailable' },
				languageDetector: 'unavailable',
				summarizer: 'unavailable',
				languageModel: 'unavailable'
			})
		).toBe(false);
	});

	it('returns true when a translator pair is available', () => {
		expect(
			languageToolsSurfaceVisible({
				translator: { 'en->zh': 'available', 'zh->en': 'available' },
				languageDetector: 'unavailable',
				summarizer: 'unavailable',
				languageModel: 'unavailable'
			})
		).toBe(true);
	});

	it('returns true when only summarizer is available', () => {
		expect(
			languageToolsSurfaceVisible({
				translator: { 'en->zh': 'unavailable', 'zh->en': 'unavailable' },
				languageDetector: 'unavailable',
				summarizer: 'available',
				languageModel: 'unavailable'
			})
		).toBe(true);
	});

	it('returns true when only languageModel is downloadable', () => {
		expect(
			languageToolsSurfaceVisible({
				translator: { 'en->zh': 'unavailable', 'zh->en': 'unavailable' },
				languageDetector: 'unavailable',
				summarizer: 'unavailable',
				languageModel: 'downloadable'
			})
		).toBe(true);
	});
});
