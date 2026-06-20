import { describe, it, expect, afterEach, vi } from 'vite-plus/test';
import { render } from 'solid-js/web';
import { RecordPanel } from '../ui/RecordPanel';
import type { CapabilityProbeResult } from '../protocol';

const disposers: Array<() => void> = [];

function probe(
	captureOverrides: Partial<CapabilityProbeResult['capture']> = {},
	probeOverrides: Partial<CapabilityProbeResult> = {}
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
		},
		...probeOverrides
	} as unknown as CapabilityProbeResult;
}

function renderRecordPanel(probeValue: CapabilityProbeResult | null) {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const dispose = render(
		() => (
			<RecordPanel
				probe={probeValue}
				status={null}
				retakeClipId={null}
				retakeSourceKinds={[]}
				landedSessionId={null}
				onAddSource={vi.fn()}
				onPushFrame={vi.fn()}
				onSourceEnded={vi.fn()}
				onStart={vi.fn()}
				onPause={vi.fn()}
				onResume={vi.fn()}
				onStop={vi.fn()}
				onApplyRegion={vi.fn()}
				onRetakeCleared={vi.fn()}
			/>
		),
		container
	);
	disposers.push(dispose);
	return container;
}

afterEach(() => {
	for (const dispose of disposers) dispose();
	disposers.length = 0;
	document.body.innerHTML = '';
});

describe('RecordPanel compact unavailable state (IA-T3 / D16)', () => {
	it('collapses the reasons into a one-line status chip plus a disclosure', () => {
		const container = renderRecordPanel(probe({ videoEncodeRealtime: 'unsupported' }));
		const notice = container.querySelector('.capture-unavailable');
		expect(notice).not.toBeNull();

		// One-line status chip names the subject and the requirement count.
		const status = notice!.querySelector('.capture-unavailable-status');
		expect(status!.textContent).toContain('Recording unavailable');
		expect(notice!.querySelector('.capture-unavailable-count')!.textContent).toContain(
			'1 requirement'
		);

		// Full reason copy lives behind a <details> disclosure, unchanged from B4/D4.
		const details = notice!.querySelector('details.capture-unavailable-details');
		expect(details).not.toBeNull();
		const reasons = Array.from(details!.querySelectorAll('li')).map((li) => li.textContent);
		expect(reasons).toEqual(['Realtime video encode is unavailable.']);
		// The reason dump no longer occupies the panel body directly.
		expect(container.querySelector('.record-disabled-note')).toBeNull();
	});

	it('keeps the source actions as the primary call-to-action', () => {
		const container = renderRecordPanel(probe({ videoEncodeRealtime: 'unsupported' }));
		const labels = Array.from(container.querySelectorAll('.record-source-actions button')).map(
			(button) => button.textContent?.trim()
		);
		expect(labels.some((label) => label?.includes('Add screen'))).toBe(true);
		expect(labels.some((label) => label?.includes('Camera'))).toBe(true);
		expect(labels.some((label) => label?.includes('Mic'))).toBe(true);
	});

	it('shows a probe-running message instead of a notice while the probe is pending', () => {
		const container = renderRecordPanel(null);
		expect(container.querySelector('.capture-unavailable')).toBeNull();
		expect(container.querySelector('.record-disabled-note')!.textContent).toContain(
			'Checking browser capabilities…'
		);
	});

	it('renders no unavailable notice when recording is available', () => {
		const container = renderRecordPanel(probe());
		expect(container.querySelector('.capture-unavailable')).toBeNull();
		expect(container.querySelector('.record-disabled-note')).toBeNull();
	});
});
