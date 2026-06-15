/**
 * Phase 40 (T11.2): TranslationController.translateTrack behaviour with the
 * Chrome AI globals stubbed.
 */
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { TranslationController, type CreateTranslatedTrackRequest } from './translation-controller';
import type { CaptionSegmentSnapshot, LanguageToolsProbeResult } from '../../protocol';

const PROBE: LanguageToolsProbeResult = {
	translator: { 'en->zh': 'available', 'zh->en': 'available' },
	languageDetector: 'available',
	summarizer: 'unavailable',
	languageModel: 'unavailable'
};

function segs(texts: string[]): CaptionSegmentSnapshot[] {
	return texts.map((t, i) => ({ id: `s${i}`, start: i, duration: 1, text: t }));
}

function stubTranslator(translate: (input: string) => Promise<string> | string): void {
	vi.stubGlobal('Translator', {
		availability: async () => 'available',
		create: async () => ({
			translate: async (input: string) => translate(input),
			destroy: () => {}
		})
	});
	vi.stubGlobal('LanguageDetector', {
		availability: async () => 'available',
		create: async () => ({
			detect: async () => [{ detectedLanguage: 'en', confidence: 0.9 }],
			destroy: () => {}
		})
	});
}

afterEach(() => vi.unstubAllGlobals());

describe('TranslationController.translateTrack', () => {
	it('translates each segment and creates a track with timing copied verbatim', async () => {
		stubTranslator((t) => `zh:${t}`);
		const created: CreateTranslatedTrackRequest[] = [];
		const controller = new TranslationController({
			createTranslatedTrack: (r) => created.push(r)
		});
		controller.setProbe(PROBE);

		await controller.translateTrack(
			{ id: 'src', name: 'Clip', segments: segs(['hello', 'world']) },
			'zh'
		);

		expect(created).toHaveLength(1);
		expect(created[0]!.language).toBe('zh');
		expect(created[0]!.segments.map((s) => s.text)).toEqual(['zh:hello', 'zh:world']);
		expect(created[0]!.segments[0]!.start).toBe(0);
		expect(created[0]!.segments[1]!.start).toBe(1);
		expect(controller.getState().job?.phase).toBe('done');
	});

	it('creates no track when every translation is empty', async () => {
		stubTranslator(() => '   ');
		const created: CreateTranslatedTrackRequest[] = [];
		const controller = new TranslationController({
			createTranslatedTrack: (r) => created.push(r)
		});
		controller.setProbe(PROBE);

		await controller.translateTrack({ id: 'src', name: 'Clip', segments: segs(['hello']) }, 'zh');

		expect(created).toHaveLength(0);
		expect(controller.getState().job?.phase).toBe('error');
	});

	it('cancels promptly and creates no track', async () => {
		stubTranslator(async (t) => {
			await new Promise((r) => setTimeout(r, 5));
			return `zh:${t}`;
		});
		const created: CreateTranslatedTrackRequest[] = [];
		const controller = new TranslationController({
			createTranslatedTrack: (r) => created.push(r)
		});
		controller.setProbe(PROBE);

		const job = controller.translateTrack(
			{ id: 'src', name: 'Clip', segments: segs(['a', 'b', 'c', 'd']) },
			'zh'
		);
		controller.cancel();
		await job;

		expect(created).toHaveLength(0);
		expect(controller.getState().job?.phase).toBe('idle');
	});

	it('fails cleanly without calling create() when the resolved pair is unavailable', async () => {
		let createCalled = false;
		vi.stubGlobal('Translator', {
			availability: async () => 'unavailable',
			create: async () => {
				createCalled = true;
				return { translate: async (t: string) => t, destroy: () => {} };
			}
		});
		const created: CreateTranslatedTrackRequest[] = [];
		const controller = new TranslationController({
			createTranslatedTrack: (r) => created.push(r)
		});
		controller.setProbe({
			...PROBE,
			translator: { 'en->zh': 'unavailable', 'zh->en': 'unavailable' }
		});

		await controller.translateTrack({ id: 'src', name: 'Clip', segments: segs(['hi']) }, 'zh');

		expect(createCalled).toBe(false);
		expect(created).toHaveLength(0);
		expect(controller.getState().job?.phase).toBe('error');
	});

	it('records the translated track id for bilingual export', () => {
		const controller = new TranslationController({ createTranslatedTrack: () => {} });
		controller.onTranslatedTrackCreated('track-123');
		expect(controller.getState().lastTranslatedTrackId).toBe('track-123');
	});
});
