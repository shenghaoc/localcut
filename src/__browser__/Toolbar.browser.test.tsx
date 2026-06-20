import { describe, it, expect, afterEach, vi } from 'vite-plus/test';
import { render } from 'solid-js/web';
import { Toolbar } from '../ui/Toolbar';

const disposers: Array<() => void> = [];

function renderToolbar(overrides: Partial<Parameters<typeof Toolbar>[0]> = {}) {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const props: Parameters<typeof Toolbar>[0] = {
		metadata: null,
		playing: () => false,
		currentTime: () => 0,
		duration: () => 0,
		importAccept: 'video/*',
		onImportFile: vi.fn(),
		onPlay: vi.fn(),
		onPause: vi.fn(),
		onStep: vi.fn(),
		loop: () => false,
		onToggleLoop: vi.fn(),
		canUndo: false,
		canRedo: false,
		onUndo: vi.fn(),
		onRedo: vi.fn(),
		crossOriginIsolated: true,
		pipelineMode: 'accelerated',
		pipelineLabel: 'Accelerated',
		previewLabel: null,
		encodeFps: null,
		onOpenCapabilities: vi.fn(),
		onOpenHelp: vi.fn(),
		onOpenAudioCleanup: vi.fn(),
		audioCleanupAvailable: false,
		onOpenAutoCaptions: vi.fn(),
		onOpenSmartReframe: vi.fn(),
		onOpenSilenceReview: vi.fn(),
		onOpenLanguageTools: vi.fn(),
		onOpenPublish: vi.fn(),
		keystrokeOverlayAvailable: false,
		timelineSnapEnabled: true,
		timelineSnapToBeats: false,
		onSetTimelineSnapEnabled: vi.fn(),
		onSetTimelineSnapToBeats: vi.fn(),
		masterGain: 1,
		meterSab: null,
		onMasterGain: vi.fn(),
		...overrides
	};
	const dispose = render(() => <Toolbar {...props} />, container);
	disposers.push(dispose);
	return container;
}

function toolButtonLabels(container: Element): string[] {
	return Array.from(container.querySelectorAll('.pipeline-strip .pipeline-chip-button')).map(
		(button) => button.textContent?.trim() ?? ''
	);
}

afterEach(() => {
	for (const dispose of disposers) dispose();
	disposers.length = 0;
	document.body.innerHTML = '';
});

describe('Toolbar pipeline-strip collapse (IA-T1 / D13)', () => {
	it('drops the redundant Capabilities and Help chips', () => {
		const container = renderToolbar();
		const labels = toolButtonLabels(container);
		expect(labels).not.toContain('Capabilities');
		expect(labels).not.toContain('Help');
		// The chip titles are gone too (their single homes are the Help menu).
		expect(container.querySelector('[title="What this browser supports"]')).toBeNull();
		expect(container.querySelector('[title="Open help and user guide"]')).toBeNull();
	});

	it('routes the infrequent launchers off the strip, leaving frequent tools', () => {
		const container = renderToolbar();
		const labels = toolButtonLabels(container);
		for (const removed of ['Cleanup', 'Captions', 'Translate', 'Reframe', 'Silence']) {
			expect(labels).not.toContain(removed);
		}
		// Go Live stays as a frequent, persistent action.
		expect(labels.some((label) => label.includes('Go Live'))).toBe(true);
	});

	it('keeps the single command-search trigger', () => {
		const container = renderToolbar();
		expect(container.querySelector('.command-search')).not.toBeNull();
	});

	it('still offers the contextual Keys tool when a keystroke overlay is available', () => {
		const container = renderToolbar({ keystrokeOverlayAvailable: true });
		expect(toolButtonLabels(container).some((label) => label.includes('Keys'))).toBe(true);
	});
});
