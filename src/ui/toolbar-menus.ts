/**
 * Toolbar menu-bar taxonomy (extracted so the IA invariants are unit-testable
 * without rendering the Ark `Menu` portals).
 *
 * IA design D13: the menu bar is the command *taxonomy*, the toolbar holds
 * frequent actions, and every command has exactly one home. Concretely:
 *   - no per-menu `Search actions…` duplicate (the single `command-search`
 *     Popover trigger + ⌘K own the palette);
 *   - `Browser capabilities` lives only under `Help` (not `View`, not a chip);
 *   - menus that would be left empty by those removals are dropped rather than
 *     shown blank.
 */

export type MenuBarItem =
	| { kind: 'separator' }
	| {
			kind: 'item';
			id: string;
			label: string;
			kbd?: string;
			detail?: string;
			disabled?: boolean;
	  };

export interface MenuBarGroup {
	id: string;
	label: string;
	items: readonly MenuBarItem[];
}

export interface MenuBarBuildOptions {
	/** Platform-correct modifier glyph (⌘ on macOS, Ctrl elsewhere). */
	mod: string;
	importBlocked: boolean;
	canUndo: boolean;
	canRedo: boolean;
	timelineSnapEnabled: boolean;
	timelineSnapToBeats: boolean;
}

/**
 * Build the menu-bar groups for the given toolbar state. Pure: no Solid
 * reactivity, no DOM — the component wraps this in a `createMemo`.
 */
export function buildMenuBarGroups(options: MenuBarBuildOptions): MenuBarGroup[] {
	const { mod } = options;
	return [
		{
			id: 'project',
			label: 'Project',
			items: [
				{ kind: 'item', id: 'import', label: 'Import media…', disabled: options.importBlocked }
			]
		},
		{
			id: 'edit',
			label: 'Edit',
			items: [
				{ kind: 'item', id: 'undo', label: 'Undo', kbd: `${mod}+Z`, disabled: !options.canUndo },
				{
					kind: 'item',
					id: 'redo',
					label: 'Redo',
					kbd: `${mod}+⇧+Z`,
					disabled: !options.canRedo
				}
			]
		},
		{
			id: 'clip',
			label: 'Clip',
			items: [
				{ kind: 'item', id: 'split', label: 'Split at playhead', kbd: 'S', detail: 'on timeline' },
				{ kind: 'item', id: 'delete', label: 'Delete selected', kbd: '⌫', detail: 'on timeline' }
			]
		},
		{
			id: 'timeline',
			label: 'Timeline',
			items: [
				{
					kind: 'item',
					id: 'snap',
					label: options.timelineSnapEnabled ? 'Disable snap' : 'Enable snap'
				},
				{
					kind: 'item',
					id: 'beat-snap',
					label: options.timelineSnapToBeats ? 'Disable beat snap' : 'Enable beat snap',
					disabled: !options.timelineSnapEnabled
				}
			]
		},
		{
			id: 'help',
			label: 'Help',
			items: [
				{ kind: 'item', id: 'user-guide', label: 'User guide' },
				{ kind: 'item', id: 'capabilities', label: 'Browser capabilities' }
			]
		}
	];
}
