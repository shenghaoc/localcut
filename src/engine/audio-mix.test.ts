import { describe, expect, it } from 'vite-plus/test';
import {
	accumulateMix,
	applyMasterAndClamp,
	applyMixStage,
	applyMixStageInPlace,
	computeClipFadeGain,
	equalPowerCrossfadeGains,
	equalPowerPanLaw,
	panCoefficients,
	resolveAudioTransitionAt,
	stereoBalancePanLaw,
	type MixStageParams
} from './audio-mix';

function mixPreviewExportFixture(): { preview: Float32Array; exported: Float32Array } {
	const channels = 2;
	const sampleRate = 4;
	const frameCount = 4;
	const source = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
	const mixParams: MixStageParams = {
		gain: 1.2,
		pan: -0.5,
		fadeInS: 0.25,
		fadeOutS: 0.25,
		clipOffsetS: 0,
		clipDurationS: 1,
		sampleRate
	};

	const previewPcm = source.slice(0, frameCount * channels);
	applyMixStageInPlace(previewPcm, channels, mixParams);
	const previewOut = new Float32Array(frameCount * channels);
	accumulateMix(previewOut, previewPcm);
	applyMasterAndClamp(previewOut, 0.9);

	const exportPcm = source.slice(0, frameCount * channels);
	const exportMixed = applyMixStage(exportPcm, channels, mixParams);
	const exportOut = new Float32Array(frameCount * channels);
	accumulateMix(exportOut, exportMixed);
	applyMasterAndClamp(exportOut, 0.9);

	return { preview: previewOut, exported: exportOut };
}

describe('equalPowerPanLaw', () => {
	it('is unity at center and hard-pans at the extremes', () => {
		const center = equalPowerPanLaw(0);
		expect(center.left).toBeCloseTo(Math.SQRT1_2, 5);
		expect(center.right).toBeCloseTo(Math.SQRT1_2, 5);
		expect(center.left ** 2 + center.right ** 2).toBeCloseTo(1, 5);

		const hardLeft = equalPowerPanLaw(-1);
		expect(hardLeft.left).toBeCloseTo(1, 5);
		expect(hardLeft.right).toBeCloseTo(0, 5);

		const hardRight = equalPowerPanLaw(1);
		expect(hardRight.left).toBeCloseTo(0, 5);
		expect(hardRight.right).toBeCloseTo(1, 5);
	});
});

describe('stereoBalancePanLaw', () => {
	it('leaves both channels at unity when centered', () => {
		expect(stereoBalancePanLaw(0)).toEqual({ left: 1, right: 1 });
	});

	it('hard-pans by attenuating the opposite channel', () => {
		expect(stereoBalancePanLaw(-1)).toEqual({ left: 1, right: 0 });
		expect(stereoBalancePanLaw(1)).toEqual({ left: 0, right: 1 });
	});
});

describe('panCoefficients', () => {
	it('uses balance panning for stereo and ignores pan on mono output', () => {
		expect(panCoefficients(0, 2)).toEqual({ left: 1, right: 1 });
		expect(panCoefficients(-1, 1)).toEqual({ left: 1, right: 1 });
	});
});

describe('computeClipFadeGain', () => {
	it('ramps in and out sample-accurately from clip-relative position', () => {
		expect(computeClipFadeGain(0, 2, 0.5, 0.5)).toBe(0);
		expect(computeClipFadeGain(0.25, 2, 0.5, 0.5)).toBeCloseTo(0.5, 5);
		expect(computeClipFadeGain(1, 2, 0.5, 0.5)).toBeCloseTo(1, 5);
		expect(computeClipFadeGain(1.75, 2, 0.5, 0.5)).toBeCloseTo(0.5, 5);
		expect(computeClipFadeGain(2, 2, 0.5, 0.5)).toBe(0);
	});
});

describe('equalPowerCrossfadeGains', () => {
	it('crossfades with constant power', () => {
		const start = equalPowerCrossfadeGains(0);
		expect(start.outgoing).toBeCloseTo(1, 5);
		expect(start.incoming).toBeCloseTo(0, 5);

		const mid = equalPowerCrossfadeGains(0.5);
		expect(mid.outgoing ** 2 + mid.incoming ** 2).toBeCloseTo(1, 5);

		const end = equalPowerCrossfadeGains(1);
		expect(end.outgoing).toBeCloseTo(0, 5);
		expect(end.incoming).toBeCloseTo(1, 5);
	});
});

describe('applyMixStage', () => {
	it('applies gain, pan, and fade on stereo PCM', () => {
		const pcm = new Float32Array([1, 1, 1, 1]);
		const mixed = applyMixStage(pcm, 2, {
			gain: 0.5,
			pan: -1,
			fadeInS: 0,
			fadeOutS: 0,
			clipOffsetS: 0,
			clipDurationS: 1,
			sampleRate: 2
		});
		expect(mixed[0]).toBeCloseTo(0.5, 5);
		expect(mixed[1]).toBeCloseTo(0, 5);
		expect(mixed[2]).toBeCloseTo(0.5, 5);
		expect(mixed[3]).toBeCloseTo(0, 5);
	});

	it('leaves centered stereo tracks at unity gain', () => {
		const pcm = new Float32Array([0.8, 0.6, 0.4, 0.2]);
		applyMixStageInPlace(pcm, 2, {
			gain: 1,
			pan: 0,
			fadeInS: 0,
			fadeOutS: 0,
			clipOffsetS: 0,
			clipDurationS: 1,
			sampleRate: 2
		});
		expect(pcm[0]).toBeCloseTo(0.8, 5);
		expect(pcm[1]).toBeCloseTo(0.6, 5);
		expect(pcm[2]).toBeCloseTo(0.4, 5);
		expect(pcm[3]).toBeCloseTo(0.2, 5);
	});

	it('hard-pans stereo tracks with balance law', () => {
		const pcm = new Float32Array([1, 1]);
		applyMixStageInPlace(pcm, 2, {
			gain: 1,
			pan: 1,
			fadeInS: 0,
			fadeOutS: 0,
			clipOffsetS: 0,
			clipDurationS: 1,
			sampleRate: 2
		});
		expect(pcm[0]).toBeCloseTo(0, 5);
		expect(pcm[1]).toBeCloseTo(1, 5);
	});

	it('applies master gain and clamps to ±1', () => {
		const pcm = new Float32Array([0.8, 0.8, 0.8, 0.8]);
		applyMasterAndClamp(pcm, 2);
		expect([...pcm]).toEqual([1, 1, 1, 1]);
	});
});

describe('resolveAudioTransitionAt', () => {
	const clips = [
		{ id: 'a', start: 0, duration: 2 },
		{ id: 'b', start: 2, duration: 2 }
	];

	it('returns null when no transition matches', () => {
		expect(resolveAudioTransitionAt('track-1', clips, [], 1)).toBeNull();
	});

	it('resolves mixT inside the centered transition window', () => {
		const hit = resolveAudioTransitionAt(
			'track-1',
			clips,
			[{ trackId: 'track-1', fromClipId: 'a', toClipId: 'b', durationS: 1 }],
			2
		);
		expect(hit).toMatchObject({ outgoingClipId: 'a', incomingClipId: 'b', mixT: 0.5 });
	});

	it('ignores non-adjacent clip pairs beyond the tolerance', () => {
		const gapClips = [
			{ id: 'a', start: 0, duration: 2 },
			{ id: 'b', start: 3, duration: 2 }
		];
		expect(
			resolveAudioTransitionAt(
				'track-1',
				gapClips,
				[{ trackId: 'track-1', fromClipId: 'a', toClipId: 'b', durationS: 1 }],
				2.5
			)
		).toBeNull();
	});

	it('skips zero-duration transitions', () => {
		expect(
			resolveAudioTransitionAt(
				'track-1',
				clips,
				[{ trackId: 'track-1', fromClipId: 'a', toClipId: 'b', durationS: 0 }],
				2
			)
		).toBeNull();
	});
});

describe('preview/export mix equality', () => {
	it('matches the shared fixture through the mix stage and master bus', () => {
		const { preview, exported } = mixPreviewExportFixture();
		expect([...preview]).toEqual([...exported]);
	});
});
