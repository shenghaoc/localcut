/**
 * Phase 40 (T11.4 / A1): the Language Tools surface renders no actionable UI when
 * Chrome's built-in AI is unavailable, and produces zero console errors in a real
 * browser. The toolbar entry-point gate (App passes `onOpenLanguageTools=undefined`
 * when `languageToolsSurfaceVisible` is false) is covered by the probe unit tests;
 * here we verify the panel itself in real Chromium.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vite-plus/test';
import { render } from 'solid-js/web';
import { LanguageToolsPanel } from '../ui/LanguageToolsPanel';
import {
	TranslationController,
	type TranslationControllerState
} from '../ui/language-tools/translation-controller';
import { DraftController } from '../ui/language-tools/draft-controller';
import type { CaptionTrackSnapshot, LanguageToolsProbeResult } from '../protocol';

const UNAVAILABLE: LanguageToolsProbeResult = {
	translator: { 'en->zh': 'unavailable', 'zh->en': 'unavailable' },
	languageDetector: 'unavailable',
	summarizer: 'unavailable',
	languageModel: 'unavailable'
};

const AVAILABLE: LanguageToolsProbeResult = {
	translator: { 'en->zh': 'available', 'zh->en': 'available' },
	languageDetector: 'available',
	summarizer: 'available',
	languageModel: 'available'
};

const disposers: Array<() => void> = [];
let consoleErrors: string[] = [];
const originalError = console.error;

beforeEach(() => {
	consoleErrors = [];
	console.error = (...args: unknown[]) => {
		consoleErrors.push(args.map(String).join(' '));
	};
});

afterEach(() => {
	console.error = originalError;
	for (const dispose of disposers) dispose();
	disposers.length = 0;
	document.body.innerHTML = '';
});

function captionTrack(id: string, name: string, language: string): CaptionTrackSnapshot {
	return {
		id,
		kind: 'caption',
		name,
		language,
		segments: [],
		defaultStyle: {} as CaptionTrackSnapshot['defaultStyle'],
		burnedIn: false,
		visible: true
	};
}

async function nextFrame(): Promise<void> {
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function mount(
	probe: LanguageToolsProbeResult,
	open = true,
	options: {
		translationState?: Partial<TranslationControllerState>;
		captionTracks?: readonly CaptionTrackSnapshot[];
		onExportBilingual?: (sourceTrackId: string, translatedTrackId: string) => void;
	} = {}
) {
	const translation = new TranslationController({ createTranslatedTrack: () => {} });
	translation.setProbe(probe);
	const draft = new DraftController();
	draft.setProbe(probe);

	const container = document.createElement('div');
	document.body.appendChild(container);
	const dispose = render(
		() => (
			<LanguageToolsPanel
				open={open}
				translationState={{ ...translation.getState(), ...options.translationState }}
				draftState={draft.getState()}
				captionTracks={options.captionTracks ?? []}
				onTranslate={() => {}}
				onCancelTranslate={() => {}}
				onGenerateDraft={() => {}}
				onCancelDraft={() => {}}
				onExportBilingual={options.onExportBilingual ?? (() => {})}
				onClose={() => {}}
			/>
		),
		container
	);
	disposers.push(dispose);
	return container;
}

function buttonLabels(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
}

describe('LanguageToolsPanel surface gating', () => {
	it('renders nothing when closed', () => {
		const container = mount(UNAVAILABLE, false);
		expect(container.querySelector('[role="dialog"]')).toBeNull();
		expect(consoleErrors).toEqual([]);
	});

	it('shows no Translate or Draft controls when the APIs are unavailable', () => {
		const container = mount(UNAVAILABLE, true);
		// The dialog opens, but neither feature section renders.
		expect(container.querySelector('[role="dialog"]')).not.toBeNull();
		const labels = buttonLabels(container);
		expect(labels).not.toContain('Translate');
		expect(labels).not.toContain('Generate Draft');
		expect(consoleErrors).toEqual([]);
	});

	it('shows Translate and Draft controls when the APIs are available', () => {
		const container = mount(AVAILABLE, true);
		const labels = buttonLabels(container);
		expect(labels).toContain('Translate');
		expect(labels).toContain('Generate Draft');
		expect(consoleErrors).toEqual([]);
	});

	it('hides bilingual export when the selected source track changes', async () => {
		const exported: string[] = [];
		const container = mount(AVAILABLE, true, {
			captionTracks: [
				captionTrack('captions-a', 'English Captions', 'en'),
				captionTrack('captions-b', 'Chinese Captions', 'zh')
			],
			translationState: {
				lastTranslatedTrackId: 'translated-a',
				lastTranslatedSourceTrackId: 'captions-a'
			},
			onExportBilingual: (sourceTrackId, translatedTrackId) =>
				exported.push(`${sourceTrackId}:${translatedTrackId}`)
		});
		await nextFrame();

		expect(buttonLabels(container)).toContain('Export bilingual (SRT + VTT)');

		const sourcePicker = container.querySelector(
			'select[aria-label="Select caption track"]'
		) as HTMLSelectElement;
		sourcePicker.value = 'captions-b';
		sourcePicker.dispatchEvent(new Event('change', { bubbles: true }));

		expect(buttonLabels(container)).not.toContain('Export bilingual (SRT + VTT)');
		expect(exported).toEqual([]);
		expect(consoleErrors).toEqual([]);
	});
});
