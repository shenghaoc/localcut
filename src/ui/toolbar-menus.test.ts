import { describe, it, expect } from 'vite-plus/test';
import { buildMenuBarGroups, type MenuBarBuildOptions } from './toolbar-menus';

function options(overrides: Partial<MenuBarBuildOptions> = {}): MenuBarBuildOptions {
	return {
		mod: '⌘',
		importBlocked: false,
		canUndo: true,
		canRedo: true,
		timelineSnapEnabled: true,
		timelineSnapToBeats: false,
		...overrides
	};
}

function allItems(opts: MenuBarBuildOptions = options()) {
	return buildMenuBarGroups(opts).flatMap((group) =>
		group.items
			.filter((item): item is Extract<typeof item, { kind: 'item' }> => item.kind === 'item')
			.map((item) => ({ group: group.id, ...item }))
	);
}

describe('buildMenuBarGroups (IA-T1 / D13 dedupe)', () => {
	it('never repeats the command palette as a per-menu item', () => {
		// The single `command-search` Popover trigger + ⌘K own the palette; menus
		// must not each append a `Search actions…` item (B13).
		const items = allItems();
		expect(items.some((item) => item.id === 'palette')).toBe(false);
		expect(items.some((item) => item.label === 'Search actions…')).toBe(false);
	});

	it('homes Browser capabilities under Help only — never View', () => {
		const groups = buildMenuBarGroups(options());
		expect(groups.some((group) => group.id === 'view')).toBe(false);
		const capabilityItems = allItems().filter((item) => item.id === 'capabilities');
		expect(capabilityItems).toHaveLength(1);
		expect(capabilityItems[0]!.group).toBe('help');
		expect(capabilityItems[0]!.label).toBe('Browser capabilities');
	});

	it('keeps Help as the home for the user guide and capabilities', () => {
		const help = buildMenuBarGroups(options()).find((group) => group.id === 'help');
		expect(help).toBeDefined();
		const ids = help!.items
			.filter((item) => item.kind === 'item')
			.map((item) => (item.kind === 'item' ? item.id : ''));
		expect(ids).toEqual(['user-guide', 'capabilities']);
	});

	it('exposes the expected top-level command taxonomy (no empty menus)', () => {
		const groups = buildMenuBarGroups(options());
		expect(groups.map((group) => group.id)).toEqual([
			'project',
			'edit',
			'clip',
			'timeline',
			'help'
		]);
		// Every group has at least one selectable item — no blank dropdowns.
		for (const group of groups) {
			expect(group.items.some((item) => item.kind === 'item')).toBe(true);
		}
	});

	it('wires disabled state from build options', () => {
		const blocked = allItems(options({ importBlocked: true, canUndo: false, canRedo: false }));
		expect(blocked.find((item) => item.id === 'import')!.disabled).toBe(true);
		expect(blocked.find((item) => item.id === 'undo')!.disabled).toBe(true);
		expect(blocked.find((item) => item.id === 'redo')!.disabled).toBe(true);

		const enabled = allItems(options({ importBlocked: false, canUndo: true, canRedo: true }));
		expect(enabled.find((item) => item.id === 'import')!.disabled).toBe(false);
		expect(enabled.find((item) => item.id === 'undo')!.disabled).toBe(false);
	});

	it('reflects timeline snap state in the toggle labels', () => {
		const snapOff = allItems(options({ timelineSnapEnabled: false }));
		expect(snapOff.find((item) => item.id === 'snap')!.label).toBe('Enable snap');
		expect(snapOff.find((item) => item.id === 'beat-snap')!.disabled).toBe(true);

		const beatOn = allItems(options({ timelineSnapEnabled: true, timelineSnapToBeats: true }));
		expect(beatOn.find((item) => item.id === 'snap')!.label).toBe('Disable snap');
		expect(beatOn.find((item) => item.id === 'beat-snap')!.label).toBe('Disable beat snap');
		expect(beatOn.find((item) => item.id === 'beat-snap')!.disabled).toBe(false);
	});
});
