import { describe, it, expect, afterEach, vi } from 'vite-plus/test';
import { render } from 'solid-js/web';
import { Inspector, type SelectedClip } from '../ui/Inspector';
import type { ClipEffectParamsSnapshot, TransformParamsSnapshot } from '../protocol';

const disposers: Array<() => void> = [];

const defaultEffects: ClipEffectParamsSnapshot = {
	brightness: 0,
	contrast: 1,
	saturation: 1,
	temperature: 6500,
	temperatureStrength: 1,
	lutStrength: 0,
	skinSmoothStrength: 0,
	grainStrength: 0,
	grainSize: 1.0,
	halationThreshold: 0.75,
	halationRadius: 0,
	halationTintR: 1.0,
	halationTintG: 0.3,
	halationTintB: 0.1,
	vignetteAmount: 0,
	vignetteFeather: 0.5,
	vignetteRoundness: 1.0
};

const defaultTransform: TransformParamsSnapshot = {
	x: 0,
	y: 0,
	scale: 1,
	rotation: 0,
	opacity: 1,
	anchorX: 0.5,
	anchorY: 0.5,
	fit: 'fill'
};

function createClip(overrides: Partial<SelectedClip> = {}): SelectedClip {
	return {
		trackId: 'track-1',
		clipId: 'clip-1',
		start: 0,
		duration: 5,
		effects: defaultEffects,
		transform: defaultTransform,
		...overrides
	};
}

function renderInspector(
	clip: SelectedClip,
	overrides: Partial<Parameters<typeof Inspector>[0]> = {}
) {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const props: Parameters<typeof Inspector>[0] = {
		metadata: null,
		selectedClip: clip,
		selectedTrackMix: null,
		selectedClipFades: null,
		selectedClipTransform: null,
		selectedTitle: null,
		selectedTransition: null,
		playheadTime: 0,
		onSetTitle: vi.fn(),
		onEffectParam: vi.fn(),
		onTransform: vi.fn(),
		onSeek: vi.fn(),
		onSetKeyframe: vi.fn(),
		onDeleteKeyframe: vi.fn(),
		onImportLut: vi.fn(),
		onLutStrength: vi.fn(),
		onTrackGain: vi.fn(),
		onTrackMute: vi.fn(),
		onTrackSolo: vi.fn(),
		onTrackPan: vi.fn(),
		onClipFade: vi.fn(),
		onSkinMask: vi.fn(),
		onSkinSmoothBypass: vi.fn(),
		...overrides
	};
	const dispose = render(() => <Inspector {...props} />, container);
	disposers.push(dispose);
	return { container, props };
}

function maskInput(container: Element, label: string): HTMLInputElement {
	const input = container.querySelector(`input[aria-label="${label}"]`);
	expect(input).not.toBeNull();
	return input as HTMLInputElement;
}

afterEach(() => {
	for (const dispose of disposers) dispose();
	disposers.length = 0;
	document.body.innerHTML = '';
});

describe('Inspector skin smoothing controls', () => {
	it('groups strength, mask, and bypass controls before LUT controls', () => {
		const { container } = renderInspector(
			createClip({
				effects: { ...defaultEffects, skinSmoothStrength: 0.35 }
			})
		);
		const skinPanel = container.querySelector('.skin-smooth-panel');
		const lutControls = container.querySelector('.lut-controls');
		const strengthKeyframe = container.querySelector(
			'[aria-label="Toggle Skin Smoothing keyframe"]'
		);
		const bypass = container.querySelector('[aria-label="Bypass skin smoothing (A/B)"]');

		expect(skinPanel).not.toBeNull();
		expect(lutControls).not.toBeNull();
		expect(strengthKeyframe).not.toBeNull();
		expect(bypass).not.toBeNull();
		expect(skinPanel!.contains(strengthKeyframe)).toBe(true);
		expect(skinPanel!.contains(bypass)).toBe(true);
		expect(skinPanel!.contains(maskInput(container, 'Cb min'))).toBe(true);
		expect(
			Boolean(skinPanel!.compareDocumentPosition(lutControls!) & Node.DOCUMENT_POSITION_FOLLOWING)
		).toBe(true);
	});

	it('does not present inactive mask controls as actionable at zero strength', () => {
		const { container } = renderInspector(createClip());

		expect(container.textContent).toContain('Inactive at 0.00 strength');
		expect(container.textContent).toContain('Raise Skin Smoothing above 0.00');
		expect(container.querySelector('[aria-label="Bypass skin smoothing (A/B)"]')).toBeNull();
		expect(maskInput(container, 'Cb min').disabled).toBe(true);
		expect(container.querySelector<HTMLButtonElement>('.skin-mask-reset')?.disabled).toBe(true);
	});

	it('enables mask and bypass controls when smoothing is active', () => {
		const onSkinMask = vi.fn();
		const { container } = renderInspector(
			createClip({
				effects: { ...defaultEffects, skinSmoothStrength: 0.35 }
			}),
			{ onSkinMask }
		);

		expect(container.textContent).toContain('Preview active');
		expect(container.textContent).toContain('Natural range');
		expect(container.querySelector('[aria-label="Bypass skin smoothing (A/B)"]')).not.toBeNull();
		expect(maskInput(container, 'Cb min').disabled).toBe(false);
		expect(container.querySelector<HTMLButtonElement>('.skin-mask-reset')?.disabled).toBe(false);

		container.querySelector<HTMLButtonElement>('.skin-mask-reset')?.click();
		expect(onSkinMask).toHaveBeenCalledWith('track-1', 'clip-1', {
			cbMin: -0.2,
			cbMax: 0,
			crMin: 0.05,
			crMax: 0.2,
			softness: 0.04
		});
	});

	it('warns when the strength is pushed into the artificial-looking range', () => {
		const { container } = renderInspector(
			createClip({
				effects: { ...defaultEffects, skinSmoothStrength: 0.8 }
			})
		);

		expect(container.textContent).toContain('Strong smoothing');
		expect(container.textContent).toContain('High strength can make faces look synthetic');
		expect(container.querySelector('.skin-smooth-note')?.classList.contains('is-warning')).toBe(
			true
		);
		expect(container.querySelector('.skin-smooth-status-pill')?.textContent).toContain('Strong');
	});

	it('keeps controls available for keyframed smoothing even when the sampled value is zero', () => {
		const { container } = renderInspector(
			createClip({
				keyframes: {
					skinSmoothStrength: [
						{ t: 0, value: 0, easing: 'linear' },
						{ t: 1, value: 1, easing: 'linear' }
					]
				}
			})
		);

		expect(container.textContent).toContain('Keyframed');
		expect(container.querySelector('[aria-label="Bypass skin smoothing (A/B)"]')).not.toBeNull();
		expect(maskInput(container, 'Cb min').disabled).toBe(false);
	});
});
