import { describe, it, expect } from 'vite-plus/test';
import { SIDE_RAIL_TABS, isSideRailTab } from './side-rail-tabs';

describe('SIDE_RAIL_TABS (IA-T2 / D12 audio-label disambiguation)', () => {
	it('labels the voice-cleanup tab "Voice FX", never a bare "Cleanup"', () => {
		expect(SIDE_RAIL_TABS.find((tab) => tab.id === 'voice-cleanup')?.label).toBe('Voice FX');
		// Widen to string[] — the `as const` literal union already excludes
		// "Cleanup", so a direct comparison would be a no-overlap type error.
		const labels: readonly string[] = SIDE_RAIL_TABS.map((tab) => tab.label);
		expect(labels).not.toContain('Cleanup');
	});

	it('keeps the live-audio chain labelled "Audio"', () => {
		expect(SIDE_RAIL_TABS.find((tab) => tab.id === 'live-audio')?.label).toBe('Audio');
	});

	it('uses a unique id and label per tab (one home per concept)', () => {
		const ids = SIDE_RAIL_TABS.map((tab) => tab.id);
		const labels = SIDE_RAIL_TABS.map((tab) => tab.label);
		expect(new Set(ids).size).toBe(ids.length);
		expect(new Set(labels).size).toBe(labels.length);
	});

	it('isSideRailTab recognises known ids and rejects everything else', () => {
		expect(isSideRailTab('voice-cleanup')).toBe(true);
		expect(isSideRailTab('inspector')).toBe(true);
		expect(isSideRailTab('cleanup')).toBe(false);
		expect(isSideRailTab(null)).toBe(false);
	});
});
