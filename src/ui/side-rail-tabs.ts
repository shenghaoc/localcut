/**
 * Right-rail (side-panel) tab definitions, extracted from `App.tsx` so the IA
 * label invariants (IA-T2/D12 — one honest label per audio concept, no bare
 * `Cleanup`) are unit-testable by importing the data directly rather than
 * string-matching the component source.
 */

export const SIDE_RAIL_TABS = [
	{ id: 'inspector', label: 'Inspector' },
	{ id: 'captions', label: 'Captions' },
	{ id: 'record', label: 'Record' },
	{ id: 'program', label: 'Program' },
	{ id: 'replay', label: 'Replay' },
	{ id: 'live-audio', label: 'Audio' },
	{ id: 'voice-cleanup', label: 'Voice FX' }
] as const;

export type SideRailTab = (typeof SIDE_RAIL_TABS)[number]['id'];

export const SIDE_RAIL_COLLAPSED_KEY = 'side-rail-collapsed';

export function isSideRailTab(value: string | null): value is SideRailTab {
	return SIDE_RAIL_TABS.some((tab) => tab.id === value);
}
