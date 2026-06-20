import { describe, it, expect } from 'vite-plus/test';
import {
	buildCommandActions,
	buildMenuBarGroups,
	type CommandActionsBuildOptions,
	type MenuBarBuildOptions
} from './toolbar-menus';

function options(overrides: Partial<MenuBarBuildOptions> = {}): MenuBarBuildOptions {
	return {
		mod: '⌘',
		importBlocked: false,
		canUndo: true,
		canRedo: true,
		timelineSnapEnabled: true,
		timelineSnapToBeats: false,
		hasSelection: true,
		scopesPanelVisible: false,
		scopesPanelAvailable: true,
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

	it('homes Browser capabilities under Help only — not View', () => {
		const capabilityItems = allItems().filter((item) => item.id === 'capabilities');
		expect(capabilityItems).toHaveLength(1);
		expect(capabilityItems[0]!.group).toBe('help');
		expect(capabilityItems[0]!.label).toBe('Browser capabilities');
		const viewItems = allItems().filter(
			(item) => item.group === 'view' && item.id === 'capabilities'
		);
		expect(viewItems).toHaveLength(0);
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
			'view',
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

	it('gates Clip › Split/Delete on a timeline selection', () => {
		// Both are real actions now (wired to onSplit/onDelete in the component),
		// disabled when nothing is selected so selecting them never dead-ends in
		// the palette.
		const none = allItems(options({ hasSelection: false }));
		expect(none.find((item) => item.id === 'split')!.disabled).toBe(true);
		expect(none.find((item) => item.id === 'delete')!.disabled).toBe(true);

		const selected = allItems(options({ hasSelection: true }));
		expect(selected.find((item) => item.id === 'split')!.disabled).toBe(false);
		expect(selected.find((item) => item.id === 'delete')!.disabled).toBe(false);
	});

	it('keeps the shortcut hints on the Clip actions', () => {
		const items = allItems();
		expect(items.find((item) => item.id === 'split')!.kbd).toBe('S');
		expect(items.find((item) => item.id === 'delete')!.kbd).toBe('⌫');
	});

	it('homes Scopes under the View menu (IA-T6)', () => {
		const groups = buildMenuBarGroups(options());
		const view = groups.find((group) => group.id === 'view');
		expect(view).toBeDefined();
		const items = view!.items.filter(
			(item): item is Extract<typeof item, { kind: 'item' }> => item.kind === 'item'
		);
		expect(items.some((item) => item.id === 'scopes')).toBe(true);
	});

	it('reflects scopes panel visibility in the View menu label', () => {
		const hidden = allItems(options({ scopesPanelVisible: false }));
		expect(hidden.find((item) => item.id === 'scopes')!.label).toBe('Show scopes');

		const visible = allItems(options({ scopesPanelVisible: true }));
		expect(visible.find((item) => item.id === 'scopes')!.label).toBe('Hide scopes');
	});

	it('homes Render queue under the Project menu (IA-T6)', () => {
		const groups = buildMenuBarGroups(options());
		const project = groups.find((group) => group.id === 'project');
		expect(project).toBeDefined();
		const items = project!.items.filter(
			(item): item is Extract<typeof item, { kind: 'item' }> => item.kind === 'item'
		);
		expect(items.some((item) => item.id === 'render-queue')).toBe(true);
	});
});

function commandOptions(
	overrides: Partial<CommandActionsBuildOptions> = {}
): CommandActionsBuildOptions {
	const noop = () => {};
	return {
		importHint: null,
		importBlocked: false,
		playing: false,
		transportDisabled: false,
		audioCleanupAvailable: false,
		languageToolsAvailable: true,
		onImport: noop,
		onPlayPause: noop,
		onAudioCleanup: noop,
		onAutoCaptions: noop,
		onLanguageTools: noop,
		onSmartReframe: noop,
		onSilenceReview: noop,
		onPublish: noop,
		onCapabilities: noop,
		onHelp: noop,
		onOpenRecord: noop,
		onOpenCaptions: noop,
		onToggleScopes: noop,
		onOpenRenderQueue: noop,
		scopesPanelAvailable: true,
		...overrides
	};
}

describe('buildCommandActions (IA-T1 / D13 launcher routing, D12 audio gating)', () => {
	it('routes the collapsed launcher tools into the command palette', () => {
		const labels = buildCommandActions(commandOptions()).map((action) => action.label);
		for (const expected of [
			'Audio Cleanup',
			'Auto captions',
			'Language Tools',
			'Smart reframe',
			'Remove silences',
			'Go live',
			'Browser capabilities',
			'User guide'
		]) {
			expect(labels).toContain(expected);
		}
	});

	it('gates Audio Cleanup on a selected audio clip', () => {
		const without = buildCommandActions(commandOptions({ audioCleanupAvailable: false })).find(
			(action) => action.label === 'Audio Cleanup'
		)!;
		expect(without.disabled).toBe(true);
		expect(without.detail).toBe('Select an audio clip first');

		const withClip = buildCommandActions(commandOptions({ audioCleanupAvailable: true })).find(
			(action) => action.label === 'Audio Cleanup'
		)!;
		expect(withClip.disabled).toBe(false);
		expect(withClip.detail).toBe('Reduce noise on the selected clip');
	});

	it('includes Language Tools only when the language tools are available', () => {
		const present = buildCommandActions(commandOptions({ languageToolsAvailable: true })).map(
			(action) => action.label
		);
		expect(present).toContain('Language Tools');
		const absent = buildCommandActions(commandOptions({ languageToolsAvailable: false })).map(
			(action) => action.label
		);
		expect(absent).not.toContain('Language Tools');
	});

	it('reflects transport state in the play/pause entry', () => {
		const stopped = buildCommandActions(commandOptions({ playing: false }))[1]!;
		expect(stopped.label).toBe('Play transport');
		const playing = buildCommandActions(commandOptions({ playing: true }))[1]!;
		expect(playing.label).toBe('Pause transport');
		const disabled = buildCommandActions(commandOptions({ transportDisabled: true }))[1]!;
		expect(disabled.disabled).toBe(true);
	});

	it('disables Import when importing is blocked', () => {
		const importAction = buildCommandActions(commandOptions({ importBlocked: true })).find(
			(action) => action.label === 'Import media'
		)!;
		expect(importAction.disabled).toBe(true);
	});

	it('routes dock-rail workflow launchers into the command palette (IA-T6)', () => {
		const labels = buildCommandActions(commandOptions()).map((action) => action.label);
		for (const expected of ['Record', 'Captions', 'View scopes', 'Render queue']) {
			expect(labels).toContain(expected);
		}
	});
});
