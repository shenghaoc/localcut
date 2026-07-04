import { describe, expect, it } from 'vite-plus/test';
import audioInsertRowSource from './AudioInsertRow.tsx?raw';
import liveAudioChainPanelSource from './LiveAudioChainPanel.tsx?raw';
import replayBufferPanelSource from './ReplayBufferPanel.tsx?raw';
import voiceCleanupPanelSource from './VoiceCleanupPanel.tsx?raw';

describe('audio disclosure semantics', () => {
	it('keeps audio insert expansion separate from bypass controls', () => {
		expect(audioInsertRowSource).toContain('class="insert-header"');
		expect(audioInsertRowSource).toContain('class="insert-expand"');
		expect(audioInsertRowSource).toContain('type="button"');
		expect(audioInsertRowSource).not.toContain('role="button"');
		expect(audioInsertRowSource).not.toContain('stopPropagation');
	});

	it('uses native disclosure buttons for panel headers', () => {
		for (const source of [
			liveAudioChainPanelSource,
			replayBufferPanelSource,
			voiceCleanupPanelSource
		]) {
			expect(source).toContain('class="collapse-header"');
			expect(source).toContain('type="button"');
			expect(source).not.toContain('role="button"');
		}
	});
});
