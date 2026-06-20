import { describe, expect, it } from 'vite-plus/test';
import appSource from './App.tsx?raw';
import toolbarSource from './Toolbar.tsx?raw';

/**
 * Source-level guards for the editor-chrome IA Phase 1 invariants (IA-T1/T2)
 * that live in non-exported component internals (`SIDE_RAIL_TABS`, the JSX
 * launcher strip, the App→Toolbar wiring). These run in the node quality gate
 * alongside the rendered `__browser__` panel tests.
 */
describe('editor chrome IA — audio-label disambiguation (IA-T2 / D12)', () => {
	it('renames the right-rail voice-cleanup tab to "Voice FX" — no bare "Cleanup"', () => {
		expect(appSource).toContain("{ id: 'voice-cleanup', label: 'Voice FX' }");
		expect(appSource).not.toContain("{ id: 'voice-cleanup', label: 'Cleanup' }");
	});

	it('gates the top-toolbar Audio Cleanup action on a selected clip', () => {
		// App passes the selected-clip predicate through to the Toolbar.
		expect(appSource).toContain('audioCleanupAvailable={selectedAudioCleanupClip() !== null}');
		// The palette action is renamed "Audio Cleanup" and disabled without a clip.
		expect(toolbarSource).toContain("label: 'Audio Cleanup'");
		expect(toolbarSource).toContain('disabled: !props.audioCleanupAvailable');
	});
});

describe('editor chrome IA — menu/toolbar dedupe (IA-T1 / D13)', () => {
	it('routes the infrequent launchers through the command palette', () => {
		expect(toolbarSource).toContain("label: 'Remove silences'");
		expect(toolbarSource).toContain("label: 'Browser capabilities'");
		expect(toolbarSource).toContain("label: 'Auto captions'");
	});

	it('removes the redundant Capabilities and Help top-strip chips', () => {
		expect(toolbarSource).not.toContain('What this browser supports');
		expect(toolbarSource).not.toContain('Open help and user guide');
		// The misleading bare "Cleanup" launcher chip is gone.
		expect(toolbarSource).not.toContain('Clean up audio noise — runs on your device');
	});

	it('keeps exactly one command-search trigger and no per-menu palette items', () => {
		expect(toolbarSource).toContain('class="command-search"');
		expect(toolbarSource).not.toContain("label: 'Search actions…'");
	});
});
