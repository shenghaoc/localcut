import { describe, it, expect, afterEach, vi } from 'vite-plus/test';
import { render } from 'solid-js/web';
import { AutoCaptionsPanel } from '../ui/AutoCaptionsPanel';
import type { AsrClipTarget, AsrControllerState } from '../ui/asr-controller';
import { ASR_MODEL_CATALOG, defaultModel } from '../engine/asr/model-catalog';

const disposers: Array<() => void> = [];

const clip: AsrClipTarget = {
	trackId: 'track-1',
	clipId: 'clip-1',
	timelineStartS: 12,
	durationS: 18,
	fileName: 'interview.mp4'
};

function createState(overrides: Partial<AsrControllerState> = {}): AsrControllerState {
	return {
		probe: {
			wasm: 'supported',
			webgpu: 'supported',
			webnn: 'unsupported',
			crossOriginIsolated: true,
			recommended: 'litert-whisper'
		},
		available: true,
		recommendedEngine: 'litert-whisper',
		model: defaultModel(),
		models: ASR_MODEL_CATALOG,
		modelStatus: 'not-loaded',
		modelSizeBytes: null,
		accelerator: 'webgpu',
		downloadFraction: null,
		downloadedBytes: null,
		cached: null,
		job: null,
		lastDurationMs: null,
		error: null,
		...overrides
	};
}

function renderPanel(stateOverrides: Partial<AsrControllerState> = {}) {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const dispose = render(
		() => (
			<AutoCaptionsPanel
				open
				state={createState(stateOverrides)}
				selectedClip={clip}
				onLoadModel={vi.fn()}
				onSelectModel={vi.fn()}
				onTranscribeClip={vi.fn()}
				onTranscribeRange={vi.fn()}
				onCancel={vi.fn()}
				onClose={vi.fn()}
			/>
		),
		container
	);
	disposers.push(dispose);
	return { container };
}

afterEach(() => {
	for (const dispose of disposers) dispose();
	disposers.length = 0;
	document.body.innerHTML = '';
});

describe('AutoCaptionsPanel progress', () => {
	it('renders WebNN/WebGPU/WASM backend copy', () => {
		const { container } = renderPanel();

		expect(container.textContent).toContain('LiteRT Whisper (WEBGPU)');
		expect(container.textContent).toContain('experimental WebNN');
		expect(container.textContent).toContain('WebNN, WebGPU, or WASM');
	});

	it('renders a dedicated download progress block', () => {
		const { container } = renderPanel({
			modelStatus: 'loading',
			modelSizeBytes: 290_918_186,
			downloadedBytes: 31_000_000,
			downloadFraction: 0.1066
		});

		expect(container.textContent).toContain('Progress');
		expect(container.textContent).toContain('Downloading Whisper Base');
		expect(container.textContent).toContain('11%');
		expect(container.textContent).toContain('31.0 MB / 290.9 MB');

		const progress = container.querySelector('progress[aria-label="Model download progress"]');
		expect(progress).not.toBeNull();
		expect(progress?.className).toContain('asr-progress-bar');
	});

	it('renders compile-stage copy once bytes are fully fetched', () => {
		const { container } = renderPanel({
			modelStatus: 'loading',
			modelSizeBytes: 151_814_734,
			downloadedBytes: 151_814_734,
			downloadFraction: 0.99,
			model: ASR_MODEL_CATALOG[1]!
		});

		expect(container.textContent).toContain('Compiling Whisper Tiny');
		expect(container.textContent).toContain('Verified 151.8 MB');
	});

	it('renders transcription progress with clip context', () => {
		const { container } = renderPanel({
			modelStatus: 'loaded',
			job: {
				kind: 'selected-clip',
				phase: 'transcribing',
				fraction: 0.5,
				processedSeconds: 9,
				totalSeconds: 18,
				clip
			}
		});

		expect(container.textContent).toContain('Transcribing audio');
		expect(container.textContent).toContain('50%');
		expect(container.textContent).toContain('interview.mp4');
		expect(container.textContent).toContain('9 / 18 s');

		const progress = container.querySelector('progress[aria-label="Auto captions progress"]');
		expect(progress).not.toBeNull();
		expect(progress?.className).toContain('asr-progress-bar');
	});
});
