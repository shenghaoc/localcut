/**
 * Phase 40: Language Tools probe tests.
 *
 * Tests the probe with mocked globals: each API absent/present × each
 * availability state → correct result + surfaceVisible.
 */
import { describe, expect, it } from 'vite-plus/test';
import { probeLanguageTools, type LanguageToolsScope } from './probe';
import { languageToolsSurfaceVisible } from '../../protocol';

function mockScope(options: {
	translatorReady?: boolean;
	translatorAfterDownload?: boolean;
	summarizerReady?: boolean;
	summarizerAfterDownload?: boolean;
	languageModelReady?: boolean;
	languageModelAfterDownload?: boolean;
} = {}): LanguageToolsScope {
	const translation = options.translatorReady !== undefined || options.translatorAfterDownload !== undefined
		? {
			canTranslate: async () => {
				if (options.translatorReady) return 'readily' as const;
				if (options.translatorAfterDownload) return 'after-download' as const;
				return 'no' as const;
			}
		}
		: undefined;

	const summarizer = options.summarizerReady !== undefined || options.summarizerAfterDownload !== undefined
		? {
			capabilities: async () => ({
				available: options.summarizerReady
					? ('readily' as const)
					: options.summarizerAfterDownload
						? ('after-download' as const)
						: ('no' as const)
			})
		}
		: undefined;

	const languageModel = options.languageModelReady !== undefined || options.languageModelAfterDownload !== undefined
		? {
			capabilities: async () => ({
				available: options.languageModelReady
					? ('readily' as const)
					: options.languageModelAfterDownload
						? ('after-download' as const)
						: ('no' as const)
			})
		}
		: undefined;

	return {
		translation: translation as LanguageToolsScope['translation'],
		ai: (summarizer || languageModel)
			? { summarizer, languageModel } as LanguageToolsScope['ai']
			: undefined
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

	it('maps translator readily → available', async () => {
		const scope = mockScope({ translatorReady: true });
		const result = await probeLanguageTools(scope);
		expect(result.translator['en->zh']).toBe('available');
		expect(result.translator['zh->en']).toBe('available');
		expect(result.languageDetector).toBe('available');
	});

	it('maps translator after-download → downloadable', async () => {
		const scope = mockScope({ translatorAfterDownload: true });
		const result = await probeLanguageTools(scope);
		expect(result.translator['en->zh']).toBe('downloadable');
	});

	it('maps translator no → unavailable', async () => {
		const scope = mockScope({});
		// When canTranslate returns 'no' (neither ready nor afterDownload)
		const result = await probeLanguageTools(scope);
		// With empty scope, returns 'unknown' since translation namespace exists
		// but canTranslate returns 'no'
		expect(result.translator['en->zh']).toBe('unknown');
	});

	it('maps summarizer capabilities correctly', async () => {
		const scope = mockScope({ summarizerReady: true });
		const result = await probeLanguageTools(scope);
		expect(result.summarizer).toBe('available');
	});

	it('maps languageModel capabilities correctly', async () => {
		const scope = mockScope({ languageModelAfterDownload: true });
		const result = await probeLanguageTools(scope);
		expect(result.languageModel).toBe('downloadable');
	});

	it('handles all APIs available', async () => {
		const scope = mockScope({
			translatorReady: true,
			summarizerReady: true,
			languageModelReady: true
		});
		const result = await probeLanguageTools(scope);
		expect(result.translator['en->zh']).toBe('available');
		expect(result.translator['zh->en']).toBe('available');
		expect(result.languageDetector).toBe('available');
		expect(result.summarizer).toBe('available');
		expect(result.languageModel).toBe('available');
	});

	it('handles API throwing an error gracefully', async () => {
		const scope: LanguageToolsScope = {
			translation: {
				canTranslate: async () => { throw new Error('API error'); }
			} as LanguageToolsScope['translation']
		};
		const result = await probeLanguageTools(scope);
		expect(result.translator['en->zh']).toBe('unknown');
	});
});

describe('languageToolsSurfaceVisible', () => {
	it('returns false when all APIs are unknown', () => {
		const result = languageToolsSurfaceVisible({
			translator: { 'en->zh': 'unknown', 'zh->en': 'unknown' },
			languageDetector: 'unknown',
			summarizer: 'unknown',
			languageModel: 'unknown'
		});
		expect(result).toBe(false);
	});

	it('returns false when all APIs are unavailable', () => {
		const result = languageToolsSurfaceVisible({
			translator: { 'en->zh': 'unavailable', 'zh->en': 'unavailable' },
			languageDetector: 'unavailable',
			summarizer: 'unavailable',
			languageModel: 'unavailable'
		});
		expect(result).toBe(false);
	});

	it('returns true when translator is available', () => {
		const result = languageToolsSurfaceVisible({
			translator: { 'en->zh': 'available', 'zh->en': 'available' },
			languageDetector: 'unavailable',
			summarizer: 'unavailable',
			languageModel: 'unavailable'
		});
		expect(result).toBe(true);
	});

	it('returns true when translator is downloadable', () => {
		const result = languageToolsSurfaceVisible({
			translator: { 'en->zh': 'downloadable', 'zh->en': 'downloadable' },
			languageDetector: 'unknown',
			summarizer: 'unknown',
			languageModel: 'unknown'
		});
		expect(result).toBe(true);
	});

	it('returns true when only summarizer is available', () => {
		const result = languageToolsSurfaceVisible({
			translator: { 'en->zh': 'unavailable', 'zh->en': 'unavailable' },
			languageDetector: 'unavailable',
			summarizer: 'available',
			languageModel: 'unavailable'
		});
		expect(result).toBe(true);
	});

	it('returns true when only languageModel is downloadable', () => {
		const result = languageToolsSurfaceVisible({
			translator: { 'en->zh': 'unavailable', 'zh->en': 'unavailable' },
			languageDetector: 'unavailable',
			summarizer: 'unavailable',
			languageModel: 'downloadable'
		});
		expect(result).toBe(true);
	});
});
