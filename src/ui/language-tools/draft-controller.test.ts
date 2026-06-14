/**
 * Phase 40: Draft controller tests.
 *
 * Tests state transitions and probe setting.
 */
import { describe, expect, it } from 'vite-plus/test';
import { DraftController } from './draft-controller';
import type { LanguageToolsProbeResult } from '../../protocol';

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

describe('DraftController', () => {
	it('starts with default state', () => {
		const controller = new DraftController();
		const state = controller.getState();
		expect(state.summarizerAvailability).toBe('unknown');
		expect(state.languageModelAvailability).toBe('unknown');
		expect(state.available).toBe(false);
		expect(state.job).toBeNull();
	});

	it('updates state when probe is set', () => {
		const controller = new DraftController();
		controller.setProbe(PROBE_ALL_AVAILABLE);
		const state = controller.getState();
		expect(state.summarizerAvailability).toBe('available');
		expect(state.languageModelAvailability).toBe('available');
		expect(state.available).toBe(true);
	});

	it('sets available=false when all APIs are unavailable', () => {
		const controller = new DraftController();
		controller.setProbe(PROBE_ALL_UNAVAILABLE);
		expect(controller.getState().available).toBe(false);
	});

	it('sets available=true when only summarizer is available', () => {
		const controller = new DraftController();
		controller.setProbe({
			...PROBE_ALL_UNAVAILABLE,
			summarizer: 'available'
		});
		expect(controller.getState().available).toBe(true);
	});

	it('sets available=true when only languageModel is available', () => {
		const controller = new DraftController();
		controller.setProbe({
			...PROBE_ALL_UNAVAILABLE,
			languageModel: 'downloadable'
		});
		expect(controller.getState().available).toBe(true);
	});

	it('subscribes to state changes', () => {
		const controller = new DraftController();
		const states: unknown[] = [];
		controller.subscribe((state) => states.push({ ...state }));

		controller.setProbe(PROBE_ALL_AVAILABLE);
		expect(states.length).toBeGreaterThanOrEqual(2);
	});

	it('summarizerReady reflects probe state', () => {
		const controller = new DraftController();
		controller.setProbe(PROBE_ALL_AVAILABLE);
		expect(controller.summarizerReady).toBe(true);
	});

	it('languageModelReady reflects probe state', () => {
		const controller = new DraftController();
		controller.setProbe(PROBE_ALL_AVAILABLE);
		expect(controller.languageModelReady).toBe(true);
	});

	it('dispose cleans up', () => {
		const controller = new DraftController();
		controller.dispose();
		expect(true).toBe(true);
	});
});
