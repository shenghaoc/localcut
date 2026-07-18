import { describe, expect, it } from 'vite-plus/test';
import appSource from './App.tsx?raw';
import diagnosticsSource from './DiagnosticsPanel.tsx?raw';
import liveAudioChainSource from './LiveAudioChainPanel.tsx?raw';

describe('design-system and chrome regression guards', () => {
	it('keeps Replay before Record in the Capture composition', () => {
		const capturePanel = appSource.indexOf('class="capture-record-rail-panel"');
		const replay = appSource.indexOf('<ReplayBufferPanel', capturePanel);
		const record = appSource.indexOf('<RecordPanel', capturePanel);
		expect(capturePanel).toBeGreaterThan(0);
		expect(replay).toBeGreaterThan(capturePanel);
		expect(record).toBeGreaterThan(replay);
	});

	it('uses runtime-honest diagnostics and recording-path audio guidance', () => {
		expect(diagnosticsSource).toContain('No recovery actions are available for this report.');
		expect(diagnosticsSource).not.toContain('All diagnostics passed — no issues detected');
		expect(liveAudioChainSource).toContain('Configure before recording');
		expect(liveAudioChainSource).toContain('live monitoring stays unprocessed');
		expect(liveAudioChainSource).not.toContain('run on the monitor path');
	});
});
