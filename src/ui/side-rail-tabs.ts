export const SIDE_RAIL_TABS = [
	{ id: 'inspector', label: 'Inspector' },
	{ id: 'text', label: 'Text' },
	{ id: 'audio', label: 'Audio' },
	{ id: 'capture', label: 'Capture' }
] as const;

export type SideRailTab = (typeof SIDE_RAIL_TABS)[number]['id'];

export const TEXT_SIDE_RAIL_TABS = [
	{ id: 'captions', label: 'Captions' },
	{ id: 'language-tools', label: 'Language Tools' }
] as const;

export type TextSideRailTabDefinition = (typeof TEXT_SIDE_RAIL_TABS)[number];
export type TextSideRailTab = (typeof TEXT_SIDE_RAIL_TABS)[number]['id'];

export function visibleTextSideRailTabs(
	languageToolsVisible: boolean
): readonly TextSideRailTabDefinition[] {
	return languageToolsVisible
		? TEXT_SIDE_RAIL_TABS
		: TEXT_SIDE_RAIL_TABS.filter((tab) => tab.id !== 'language-tools');
}

export const AUDIO_SIDE_RAIL_TABS = [
	{ id: 'live-chain', label: 'Live Chain' },
	{ id: 'voice-fx', label: 'Voice FX' }
] as const;

export type AudioSideRailTab = (typeof AUDIO_SIDE_RAIL_TABS)[number]['id'];

export const CAPTURE_SIDE_RAIL_TABS = [
	{ id: 'record', label: 'Record' },
	{ id: 'program', label: 'Program' },
	{ id: 'replay', label: 'Replay' },
	{ id: 'publish', label: 'Go Live' }
] as const;

export type CaptureSideRailTab = (typeof CAPTURE_SIDE_RAIL_TABS)[number]['id'];

export const SIDE_RAIL_COLLAPSED_KEY = 'side-rail-collapsed';

export function isSideRailTab(value: string | null): value is SideRailTab {
	return SIDE_RAIL_TABS.some((tab) => tab.id === value);
}

export function sideRailTabTriggerId(tab: SideRailTab): string {
	return `tab-${tab}`;
}

export function sideRailTabPanelId(tab: SideRailTab): string {
	return `panel-${tab}`;
}

export function migrateLegacySideRailTab(value: string | null): SideRailTab | null {
	switch (value) {
		case 'inspector':
		case 'text':
		case 'audio':
		case 'capture':
			return value;
		case 'captions':
			return 'text';
		case 'live-audio':
		case 'voice-cleanup':
			return 'audio';
		case 'record':
		case 'program':
		case 'replay':
			return 'capture';
		default:
			return null;
	}
}
