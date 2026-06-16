/**
 * Phase 40 (T11.2): TranslationController.translateTrack behaviour with the
 * Chrome AI globals stubbed.
 */
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import {
	TranslationController,
	type CreateTranslatedTrackRequest,
	type TranslationControllerState
} from './translation-controller';
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

	it('pairs bilingual export state with the source track that produced it', async () => {
		stubTranslator((t) => `zh:${t}`);
		const controller = new TranslationController({ createTranslatedTrack: () => {} });
		controller.setProbe(PROBE);

		await controller.translateTrack(
			{ id: 'captions-a', name: 'Clip A', segments: segs(['hello']) },
			'zh'
		);
		controller.onTranslatedTrackCreated('translated-a');

		expect(controller.getState().lastTranslatedTrackId).toBe('translated-a');
		expect(controller.getState().lastTranslatedSourceTrackId).toBe('captions-a');

		await controller.translateTrack(
			{ id: 'captions-b', name: 'Clip B', segments: segs(['world']) },
			'zh'
		);

		expect(controller.getState().lastTranslatedTrackId).toBeNull();
		expect(controller.getState().lastTranslatedSourceTrackId).toBe('captions-b');
	});

	it('reports LanguageDetector download progress while auto-detecting', async () => {
		const states: TranslationControllerState[] = [];
		vi.stubGlobal('Translator', {
			availability: async () => 'available',
			create: async () => ({
				translate: async (input: string) => `zh:${input}`,
				destroy: () => {}
			})
		});
		vi.stubGlobal('LanguageDetector', {
			availability: async () => 'downloadable',
			create: async (options?: AICreateOptions) => {
				options?.monitor?.({
					addEventListener: (
						_type: 'downloadprogress',
						listener: (event: AIDownloadProgressEvent) => void
					) => listener({ loaded: 0.5 } as AIDownloadProgressEvent),
					removeEventListener: () => {}
				} as unknown as AICreateMonitor);
				return {
					detect: async () => [{ detectedLanguage: 'en', confidence: 0.9 }],
					destroy: () => {}
				};
			}
		});
		const controller = new TranslationController({ createTranslatedTrack: () => {} });
		controller.setProbe({ ...PROBE, languageDetector: 'downloadable' });
		controller.subscribe((state) =>
			states.push({ ...state, job: state.job ? { ...state.job } : null })
		);

		await controller.translateTrack({ id: 'src', name: 'Clip', segments: segs(['hello']) });

		expect(
			states.some((state) => state.job?.phase === 'detecting' && state.job.downloadFraction === 0.5)
		).toBe(true);
	});
});
