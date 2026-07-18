import { describe, it, expect } from 'vite-plus/test';
import {
	AUDIO_SIDE_RAIL_TABS,
	CAPTURE_SIDE_RAIL_TABS,
	SIDE_RAIL_TABS,
	TEXT_SIDE_RAIL_TABS,
	isSideRailTab,
	migrateLegacySideRailTab,
	sideRailTabPanelId,
	sideRailTabTriggerId,
	visibleTextSideRailTabs
} from './side-rail-tabs';

describe('SIDE_RAIL_TABS (IA-T4 / D10-D14 right-rail destinations)', () => {
	it('collapses the primary rail to four job destinations', () => {
		expect(SIDE_RAIL_TABS.map((tab) => tab.id)).toEqual(['inspector', 'text', 'audio', 'capture']);
		expect(SIDE_RAIL_TABS.map((tab) => tab.label)).toEqual([
			'Inspector',
			'Text',
			'Audio',
			'Capture'
		]);
	});

	it('keeps secondary destinations grouped by job', () => {
		expect(TEXT_SIDE_RAIL_TABS.map((tab) => tab.id)).toEqual(['captions', 'language-tools']);
		expect(AUDIO_SIDE_RAIL_TABS.map((tab) => tab.id)).toEqual(['live-chain', 'voice-fx']);
		expect(CAPTURE_SIDE_RAIL_TABS.map((tab) => tab.id)).toEqual(['record', 'program', 'publish']);
	});

	it('only exposes Language Tools when the capability surface is visible', () => {
		expect(visibleTextSideRailTabs(true).map((tab) => tab.id)).toEqual([
			'captions',
			'language-tools'
		]);
		expect(visibleTextSideRailTabs(false).map((tab) => tab.id)).toEqual(['captions']);
	});

	it('keeps the audio labels disambiguated', () => {
		const labels: readonly string[] = SIDE_RAIL_TABS.map((tab) => tab.label);
		const audioLabels: readonly string[] = AUDIO_SIDE_RAIL_TABS.map((tab) => tab.label);
		expect(labels).not.toContain('Cleanup');
		expect(audioLabels).toContain('Voice FX');
		expect(audioLabels).toContain('Live Chain');
	});

	it('uses a unique id and label per tab (one home per concept)', () => {
		const ids = SIDE_RAIL_TABS.map((tab) => tab.id);
		const labels = SIDE_RAIL_TABS.map((tab) => tab.label);
		expect(new Set(ids).size).toBe(ids.length);
		expect(new Set(labels).size).toBe(labels.length);
	});

	it('isSideRailTab recognises known ids and rejects everything else', () => {
		expect(isSideRailTab('capture')).toBe(true);
		expect(isSideRailTab('text')).toBe(true);
		expect(isSideRailTab('inspector')).toBe(true);
		expect(isSideRailTab('captions')).toBe(false);
		expect(isSideRailTab('record')).toBe(false);
		expect(isSideRailTab('cleanup')).toBe(false);
		expect(isSideRailTab(null)).toBe(false);
	});

	it('maps old persisted or routed tab ids to the new job destinations', () => {
		expect(migrateLegacySideRailTab('captions')).toBe('text');
		expect(migrateLegacySideRailTab('live-audio')).toBe('audio');
		expect(migrateLegacySideRailTab('voice-cleanup')).toBe('audio');
		expect(migrateLegacySideRailTab('record')).toBe('capture');
		expect(migrateLegacySideRailTab('program')).toBe('capture');
		expect(migrateLegacySideRailTab('replay')).toBe('capture');
		expect(migrateLegacySideRailTab('text')).toBe('text');
		expect(migrateLegacySideRailTab('cleanup')).toBeNull();
	});

	it('keeps keyboard/focus ids aligned with the new tab ids', () => {
		expect(sideRailTabTriggerId('capture')).toBe('tab-capture');
		expect(sideRailTabPanelId('capture')).toBe('panel-capture');
	});
});
