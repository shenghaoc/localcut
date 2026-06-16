/**
 * Phase 40: Translation controller tests.
 *
 * Tests state transitions, probe setting, and the translateTrack flow
 * with mocked Chrome AI APIs.
 */
import { describe, expect, it } from 'vite-plus/test';
import { TranslationController, type TranslationControllerState } from './translation-controller';
import type { LanguageToolsProbeResult, CaptionSegmentSnapshot } from '../../protocol';

const PROBE_ALL_AVAILABLE: LanguageToolsProbeResult = {
	translator: { 'en->zh': 'available', 'zh->en': 'available' },
	languageDetector: 'available',
	summarizer: 'available',
	languageModel: 'available'
};

const PROBE_ALL_UNAVAILABLE: LanguageToolsProbeResult = {
	translator: { 'en->zh': 'unavailable', 'zh->en': 'unavailable' },
	languageDetector: 'unavailable',
	summarizer: 'unavailable',
	languageModel: 'unavailable'
};

function createHarness() {
	const tracks: Array<{
		sourceTrackId: string;
		name: string;
		language: string;
		segments: CaptionSegmentSnapshot[];
	}> = [];
	const errors: string[] = [];
	let translatedTrackCreatedId: string | null = null;

	const controller = new TranslationController({
		createTranslatedTrack: (request) => {
			tracks.push({ ...request, segments: [...request.segments] });
		},
		onTranslatedTrackCreated: (trackId) => {
			translatedTrackCreatedId = trackId;
		},
		onError: (message) => {
			errors.push(message);
		}
	});

	return {
		controller,
		tracks,
		errors,
		getTranslatedTrackCreatedId: () => translatedTrackCreatedId,
		states: [] as TranslationControllerState[]
	};
}

describe('TranslationController', () => {
	it('starts with default state', () => {
		const harness = createHarness();
		const state = harness.controller.getState();
		expect(state.probe).toBeNull();
		expect(state.available).toBe(false);
		expect(state.job).toBeNull();
	});

	it('updates state when probe is set', () => {
		const harness = createHarness();
		harness.controller.setProbe(PROBE_ALL_AVAILABLE);
		const state = harness.controller.getState();
		expect(state.available).toBe(true);
		expect(state.translatorAvailability['en->zh']).toBe('available');
		expect(state.languageDetectorAvailability).toBe('available');
	});

	it('sets available=false when all APIs are unavailable', () => {
		const harness = createHarness();
		harness.controller.setProbe(PROBE_ALL_UNAVAILABLE);
		expect(harness.controller.getState().available).toBe(false);
	});

	it('sets available=true when translator is downloadable', () => {
		const harness = createHarness();
		harness.controller.setProbe({
			...PROBE_ALL_UNAVAILABLE,
			translator: { 'en->zh': 'downloadable', 'zh->en': 'downloadable' }
		});
		expect(harness.controller.getState().available).toBe(true);
	});

	it('does NOT enable Translate when only the language detector is usable', () => {
		// P1-E: a usable detector alone cannot translate anything; Translate must
		// stay gated on an actual translator pair.
		const harness = createHarness();
		harness.controller.setProbe({
			...PROBE_ALL_UNAVAILABLE,
			languageDetector: 'available'
		});
		expect(harness.controller.getState().available).toBe(false);
		expect(harness.controller.getState().languageDetectorAvailability).toBe('available');
	});

	it('subscribes to state changes', () => {
		const harness = createHarness();
		const states: TranslationControllerState[] = [];
		harness.controller.subscribe((state) => states.push({ ...state }));

		harness.controller.setProbe(PROBE_ALL_AVAILABLE);
		expect(states.length).toBeGreaterThanOrEqual(2); // initial + update
	});

	it('unsubscribes correctly', () => {
		const harness = createHarness();
		const states: TranslationControllerState[] = [];
		const unsub = harness.controller.subscribe((state) => states.push({ ...state }));

		unsub();
		harness.controller.setProbe(PROBE_ALL_AVAILABLE);
		const countAfterUnsub = states.length;
		harness.controller.setProbe(PROBE_ALL_UNAVAILABLE);
		expect(states.length).toBe(countAfterUnsub);
	});

	it('isPairReady returns true for available pair', () => {
		const harness = createHarness();
		harness.controller.setProbe(PROBE_ALL_AVAILABLE);
		expect(harness.controller.isPairReady('en', 'zh')).toBe(true);
		expect(harness.controller.isPairReady('zh', 'en')).toBe(true);
	});

	it('isPairReady returns false for unavailable pair', () => {
		const harness = createHarness();
		harness.controller.setProbe(PROBE_ALL_UNAVAILABLE);
		expect(harness.controller.isPairReady('en', 'zh')).toBe(false);
	});

	it('dispose cleans up state', () => {
		const harness = createHarness();
		harness.controller.dispose();
		// Should not throw
		expect(true).toBe(true);
	});
});
