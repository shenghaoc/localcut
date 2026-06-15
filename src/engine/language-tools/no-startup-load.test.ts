/**
 * Phase 40 hard constraints (R0.2 / A2) guarded at the module-graph + runtime level:
 *
 *  - The probe is side-effect-free: feature-detect + availability() only.
 *  - Importing the controllers performs zero create()/download/fetch calls.
 *  - The pipeline-worker capability probe does NOT probe language tools — that
 *    runs on the main thread (the Prompt API is document-context-only).
 */
import { describe, expect, it, vi } from 'vite-plus/test';
import appSource from '../../ui/App.tsx?raw';
import probeSource from '../capability-probe-v2.ts?raw';
import translationControllerSource from '../../ui/language-tools/translation-controller.ts?raw';
import draftControllerSource from '../../ui/language-tools/draft-controller.ts?raw';

describe('Phase 40: no model load at startup', () => {
	it('the worker capability probe does not probe language tools', () => {
		expect(probeSource).not.toMatch(/probeLanguageTools|language-tools\/probe/);
	});

	it('language tools are probed on the main thread (App.tsx)', () => {
		expect(appSource).toMatch(/probeLanguageTools/);
	});

	it('the controllers never fetch directly', () => {
		expect(translationControllerSource).not.toMatch(/fetch\(/);
		expect(draftControllerSource).not.toMatch(/fetch\(/);
	});

	it('importing controllers + probe triggers zero create()/download/fetch', async () => {
		const createSpy = vi.fn(async () => ({}));
		const availabilitySpy = vi.fn(async () => 'available');
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		for (const name of ['Translator', 'LanguageDetector', 'Summarizer', 'LanguageModel']) {
			vi.stubGlobal(name, { availability: availabilitySpy, create: createSpy });
		}
		try {
			await import('../../ui/language-tools/translation-controller');
			await import('../../ui/language-tools/draft-controller');
			const { probeLanguageTools } = await import('./probe');
			await probeLanguageTools();
			expect(createSpy).not.toHaveBeenCalled();
			expect(fetchSpy).not.toHaveBeenCalled();
			// availability() is allowed (it never downloads).
			expect(availabilitySpy).toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
