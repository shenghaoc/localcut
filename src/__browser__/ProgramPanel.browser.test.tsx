import { describe, it, expect, afterEach, vi } from 'vite-plus/test';
import { render } from 'solid-js/web';
import { ProgramPanel, type ProgramPanelProps } from '../ui/ProgramPanel';
import type { CapabilityProbeResult, FeatureSupport } from '../protocol';

const disposers: Array<() => void> = [];

function probe(
	captureOverrides: Partial<CapabilityProbeResult['capture']> = {}
): CapabilityProbeResult {
	const allCodecs = {
		h264Decode: 'supported',
		vp9Decode: 'supported',
		av1Decode: 'supported',
		h264Encode: 'supported',
		vp9Encode: 'supported',
		av1Encode: 'supported',
		aacDecode: 'supported',
		opusDecode: 'supported',
		aacEncode: 'supported',
		opusEncode: 'supported'
	};
	return {
		tier: 'core-webgpu',
		crossOriginIsolated: true,
		sharedArrayBuffer: 'supported',
		offscreenCanvas: 'supported',
		webGPUCore: 'supported',
		codecs: allCodecs,
		capture: {
			mediaStreamTrackProcessor: 'supported',
			transferableMediaStreamTrack: 'supported',
			displayCapture: 'supported',
			displayAudioCapture: 'supported',
			videoEncodeRealtime: 'supported',
			audioEncodeOpus: 'supported',
			audioEncodeAac: 'supported',
			opfsSyncAccessHandle: 'supported',
			...captureOverrides
		}
	} as unknown as CapabilityProbeResult;
}

function renderProgramPanel(overrides: Partial<ProgramPanelProps>) {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const props: ProgramPanelProps = {
		programMode: () => 'unsupported' as FeatureSupport,
		probe: null,
		scenes: () => [],
		sessionState: () => 'idle',
		activeSceneId: () => null,
		sourceStatus: () => [],
		budgetUsage: () => ({ active: 0, max: 4 }),
		acquiredSources: () => [],
		error: () => null,
		transitionMs: () => 0,
		onAddScreen: vi.fn(),
		onAddCamera: vi.fn(),
		onAddMic: vi.fn(),
		onRemoveSource: vi.fn(),
		onAddScene: vi.fn(),
		onRemoveScene: vi.fn(),
		onRenameScene: vi.fn(),
		onSetHotkey: vi.fn(),
		onUpdateLayers: vi.fn(),
		onSetTransitionMs: vi.fn(),
		onStart: vi.fn(),
		onStop: vi.fn(),
		onSwitchScene: vi.fn(),
		...overrides
	};
	const dispose = render(() => <ProgramPanel {...props} />, container);
	disposers.push(dispose);
	return container;
}

afterEach(() => {
	for (const dispose of disposers) dispose();
	disposers.length = 0;
	document.body.innerHTML = '';
});

describe('ProgramPanel compact unavailable state (IA-T3 / D16)', () => {
	it('collapses the disabled reasons into a status chip plus a disclosure', () => {
		const container = renderProgramPanel({
			programMode: () => 'unsupported',
			probe: probe({ videoEncodeRealtime: 'unsupported' })
		});
		const notice = container.querySelector('.capture-unavailable');
		expect(notice).not.toBeNull();
		expect(notice!.querySelector('.capture-unavailable-status')!.textContent).toContain(
			'Program Mode unavailable'
		);
		const reasons = Array.from(
			notice!.querySelectorAll('details.capture-unavailable-details li')
		).map((li) => li.textContent);
		expect(reasons).toEqual(['Realtime video encode is unavailable.']);
		// No raw full-body reason dump remains.
		expect(container.querySelector('.program-panel-disabled-reason ul')).toBeNull();
	});

	it('shows a probe-running message instead of a notice while the probe is pending', () => {
		const container = renderProgramPanel({ programMode: () => 'unsupported', probe: null });
		expect(container.querySelector('.capture-unavailable')).toBeNull();
		expect(container.querySelector('.program-panel-disabled-reason')!.textContent).toContain(
			'Checking browser capabilities…'
		);
	});

	it('renders the live panel (no notice) when Program Mode is supported', () => {
		const container = renderProgramPanel({
			programMode: () => 'supported',
			probe: probe()
		});
		expect(container.querySelector('.capture-unavailable')).toBeNull();
		expect(container.querySelector('.program-panel')).not.toBeNull();
		expect(container.querySelector('.program-panel--disabled')).toBeNull();
	});
});
