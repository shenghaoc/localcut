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
				// No `detail`: the menu template renders `kbd ?? detail`, so with a kbd set
				// the detail never shows (it was dead). These are timeline keyboard actions
				// surfaced in the menu for discoverability.
				{ kind: 'item', id: 'split', label: 'Split at playhead', kbd: 'S' },
				{ kind: 'item', id: 'delete', label: 'Delete selected', kbd: '⌫' }
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

export interface CommandAction {
	label: string;
	detail: string;
	disabled?: boolean;
	onSelect: () => void | Promise<void>;
}

export interface CommandActionsBuildOptions {
	importHint?: string | null;
	importBlocked: boolean;
	playing: boolean;
	transportDisabled: boolean;
	/** True when an audio clip is selected — gates the Audio Cleanup action. */
	audioCleanupAvailable: boolean;
	/** True only when the on-device language tools are supported/visible. */
	languageToolsAvailable: boolean;
	onImport: () => void | Promise<void>;
	/** Resolved to play or pause by the caller per the current `playing` state. */
	onPlayPause: () => void;
	onAudioCleanup: () => void;
	onAutoCaptions: () => void;
	onLanguageTools: () => void;
	onSmartReframe: () => void;
	onSilenceReview: () => void;
	onPublish: () => void;
	onCapabilities: () => void;
	onHelp: () => void;
}

/**
 * Build the command-palette (⌘K) action list. Pure — no Solid reactivity, no
 * DOM — so the IA routing/gating invariants (D13: infrequent launchers live in
 * the palette; D12: Audio Cleanup is clip-gated) are unit-testable without
 * opening the Ark `Popover`.
 *
 * The launcher strip was collapsed (IA-T1.4), so Audio Cleanup, Auto captions,
 * Translate, Smart reframe, and Remove silences are reachable here.
 */
export function buildCommandActions(options: CommandActionsBuildOptions): CommandAction[] {
	return [
		{
			label: 'Import media',
			detail: options.importHint ?? 'Add clips, images, or audio',
			disabled: options.importBlocked,
			onSelect: options.onImport
		},
		{
			label: options.playing ? 'Pause transport' : 'Play transport',
			detail: 'Preview playback',
			disabled: options.transportDisabled,
			onSelect: options.onPlayPause
		},
		{
			label: 'Audio Cleanup',
			detail: options.audioCleanupAvailable
				? 'Reduce noise on the selected clip'
				: 'Select an audio clip first',
			disabled: !options.audioCleanupAvailable,
			onSelect: options.onAudioCleanup
		},
		{
			label: 'Auto captions',
			detail: 'On-device speech recognition',
			onSelect: options.onAutoCaptions
		},
		...(options.languageToolsAvailable
			? [
					{
						// Broader than "Translate" so the Draft titles/hashtags flow in the
						// same panel stays discoverable — this is its only launcher.
						label: 'Language Tools',
						detail: 'Translate captions · draft titles, hashtags & copy on-device',
						onSelect: options.onLanguageTools
					}
				]
			: []),
		{
			label: 'Smart reframe',
			detail: 'Generate crop-path keyframes',
			onSelect: options.onSmartReframe
		},
		{
			label: 'Remove silences',
			detail: 'Find and trim silent gaps',
			onSelect: options.onSilenceReview
		},
		{
			label: 'Go live',
			detail: 'Open WHIP publish controls',
			onSelect: options.onPublish
		},
		{
			label: 'Browser capabilities',
			detail: 'Inspect browser pipeline support',
			onSelect: options.onCapabilities
		},
		{
			label: 'User guide',
			detail: 'Open in-app documentation',
			onSelect: options.onHelp
		}
	];
}
