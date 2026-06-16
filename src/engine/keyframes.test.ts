import { describe, expect, it } from 'vite-plus/test';
import { DEFAULT_BEAUTY_EFFECT } from '../protocol';
import { DEFAULT_CLIP_EFFECTS } from './effects';
import { DEFAULT_TRANSFORM } from './transform';
import {
	deleteKeyframe,
	insertKeyframe,
	isBeautyKeyframeParam,
	isEffectKeyframeParam,
	moveKeyframe,
	normalizeKeyframeTrack,
	sampleClipParamsAt,
	sampleKeyframes,
	type Keyframe
} from './keyframes';
import {
	DEFAULT_TRACK_MIX,
	defaultTimelineClip,
	setClipKeyframe,
	setClipKeyframes,
	trimClip,
	type Timeline
} from './timeline';

describe('keyframes', () => {
	it('inserts sorted keyframes and replaces matching timestamps', () => {
		const track = insertKeyframe(
			[
				{ t: 2, value: 20, easing: 'linear' },
				{ t: 0, value: 0, easing: 'linear' }
			],
			{ t: 1, value: 10, easing: 'ease' }
		);
		expect(track.map((frame) => frame.t)).toEqual([0, 1, 2]);
		const replaced = insertKeyframe(track, { t: 1, value: 12, easing: 'hold' });
		expect(replaced).toHaveLength(3);
		expect(replaced[1]).toEqual({ t: 1, value: 12, easing: 'hold' });
	});

	it('normalizes tracks with one sort pass and keeps the last duplicate timestamp', () => {
		const track = normalizeKeyframeTrack([
			{ t: 2, value: 20, easing: 'linear' },
			{ t: 1.00001, value: 11, easing: 'linear' },
			{ t: 1, value: 10, easing: 'ease' },
			{ t: 1.00002, value: 12, easing: 'hold' }
		]);
		expect(track).toEqual([
			{ t: 1.00002, value: 12, easing: 'hold' },
			{ t: 2, value: 20, easing: 'linear' }
		]);
	});

	it('moves and deletes keyframes without mutating the input track', () => {
		const original: Keyframe[] = [
			{ t: 0, value: 0, easing: 'linear' },
			{ t: 2, value: 1, easing: 'linear' }
		];
		expect(moveKeyframe(original, 2, 1).map((frame) => frame.t)).toEqual([0, 1]);
		expect(deleteKeyframe(original, 0).map((frame) => frame.t)).toEqual([2]);
		expect(original.map((frame) => frame.t)).toEqual([0, 2]);
	});

	it('samples linear, ease, and hold interpolation', () => {
		expect(
			sampleKeyframes(
				[
					{ t: 0, value: 0, easing: 'linear' },
					{ t: 2, value: 10, easing: 'linear' }
				],
				1,
				99
			)
		).toBeCloseTo(5);
		expect(
			sampleKeyframes(
				[
					{ t: 0, value: 0, easing: 'ease' },
					{ t: 2, value: 10, easing: 'linear' }
				],
				0.5,
				99
			)
		).toBeCloseTo(1.5625);
		expect(
			sampleKeyframes(
				[
					{ t: 0, value: 0, easing: 'hold' },
					{ t: 2, value: 10, easing: 'linear' }
				],
				1.5,
				99
			)
		).toBe(0);
	});

	it('samples clip effect and transform params at the shared timeline timestamp', () => {
		const clip = defaultTimelineClip({
			id: 'clip-a',
			sourceId: 'source-a',
			start: 5,
			duration: 4,
			inPoint: 0,
			effects: { ...DEFAULT_CLIP_EFFECTS, brightness: 0 },
			transform: { ...DEFAULT_TRANSFORM, x: 0 },
			keyframes: {
				brightness: [
					{ t: 0, value: 0, easing: 'linear' },
					{ t: 4, value: 1, easing: 'linear' }
				],
				x: [
					{ t: 0, value: -0.5, easing: 'linear' },
					{ t: 4, value: 0.5, easing: 'linear' }
				]
			}
		});

		const previewSample = sampleClipParamsAt(clip, 7);
		const exportSample = sampleClipParamsAt(clip, 7);
		expect(previewSample.effects.brightness).toBeCloseTo(0.5);
		expect(previewSample.transform.x).toBeCloseTo(0);
		expect(exportSample).toEqual(previewSample);
	});

	it('stores keyframe command times clip-local', () => {
		const timeline: Timeline = [
			{
				id: 'track-video',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					defaultTimelineClip({
						id: 'clip-a',
						sourceId: 'source-a',
						start: 10,
						duration: 5,
						inPoint: 0
					})
				]
			}
		];

		const next = setClipKeyframe(timeline, 'track-video', 'clip-a', 'opacity', 12, 0.5, 'linear');
		expect(next[0]!.clips[0]!.keyframes?.opacity).toEqual([{ t: 2, value: 0.5, easing: 'linear' }]);
	});

	it('stores batched keyframe command values in one clip-local update', () => {
		const timeline: Timeline = [
			{
				id: 'track-video',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					defaultTimelineClip({
						id: 'clip-a',
						sourceId: 'source-a',
						start: 10,
						duration: 5,
						inPoint: 0
					})
				]
			}
		];

		const next = setClipKeyframes(timeline, 'track-video', 'clip-a', 12, [
			{ key: 'x', value: 0.25, easing: 'linear' },
			{ key: 'y', value: -0.5, easing: 'linear' }
		]);
		const clip = next[0]!.clips[0]!;
		expect(clip.keyframes?.x).toEqual([{ t: 2, value: 0.25, easing: 'linear' }]);
		expect(clip.keyframes?.y).toEqual([{ t: 2, value: -0.5, easing: 'linear' }]);
		expect(clip.transform.x).toBe(0.25);
		expect(clip.transform.y).toBe(-0.5);
	});

	it('recognises skinSmoothStrength as an effect keyframe param', () => {
		expect(isEffectKeyframeParam('skinSmoothStrength')).toBe(true);
	});

	it('recognises beauty params and samples them from shared clip keyframes', () => {
		expect(isBeautyKeyframeParam('beauty.jawSlim')).toBe(true);
		const clip = defaultTimelineClip({
			id: 'clip-beauty',
			sourceId: 'source-beauty',
			start: 5,
			duration: 4,
			inPoint: 0,
			beauty: { ...DEFAULT_BEAUTY_EFFECT, enabled: true, jawSlim: 0 },
			keyframes: {
				'beauty.jawSlim': [
					{ t: 0, value: 0, easing: 'linear' },
					{ t: 4, value: 1, easing: 'linear' }
				],
				'beauty.eyeEnlarge': [
					{ t: 0, value: 0.1, easing: 'linear' },
					{ t: 4, value: 0.5, easing: 'linear' }
				]
			}
		});

		const sampled = sampleClipParamsAt(clip, 7);
		expect(sampled.beauty?.jawSlim).toBeCloseTo(0.5);
		expect(sampled.beauty?.eyeEnlarge).toBeCloseTo(0.3);
	});

	it('stores beauty keyframe command values in normalized clip beauty state', () => {
		const timeline: Timeline = [
			{
				id: 'track-video',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					defaultTimelineClip({
						id: 'clip-a',
						sourceId: 'source-a',
						start: 10,
						duration: 5,
						inPoint: 0
					})
				]
			}
		];

		const next = setClipKeyframe(
			timeline,
			'track-video',
			'clip-a',
			'beauty.jawSlim',
			12,
			0.75,
			'linear'
		);
		const clip = next[0]!.clips[0]!;
		expect(clip.keyframes?.['beauty.jawSlim']).toEqual([{ t: 2, value: 0.75, easing: 'linear' }]);
		expect(clip.beauty?.jawSlim).toBe(0.75);
	});

	it('sampleClipParamsAt interpolates skinSmoothStrength keyframes', () => {
		const clip = defaultTimelineClip({
			id: 'clip-k',
			sourceId: 'source-k',
			start: 0,
			duration: 10,
			inPoint: 0,
			keyframes: {
				skinSmoothStrength: [
					{ t: 0, value: 0, easing: 'linear' },
					{ t: 10, value: 1, easing: 'linear' }
				]
			}
		});
		const at5 = sampleClipParamsAt(clip, 5);
		expect(at5.effects.skinSmoothStrength).toBeCloseTo(0.5, 1);
		const at0 = sampleClipParamsAt(clip, 0);
		expect(at0.effects.skinSmoothStrength).toBeCloseTo(0, 1);
	});

	it('keeps keyframes normalized when trimming a clip shorter', () => {
		const timeline: Timeline = [
			{
				id: 'track-video',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					defaultTimelineClip({
						id: 'clip-a',
						sourceId: 'source-a',
						start: 0,
						duration: 5,
						inPoint: 0,
						keyframes: {
							opacity: [
								{ t: 1, value: 0.5, easing: 'linear' },
								{ t: 4, value: 1, easing: 'linear' }
							]
						}
					})
				]
			}
		];

		const next = trimClip(timeline, 'track-video', 'clip-a', { edge: 'out', time: 2 });
		expect(next[0]!.clips[0]!.keyframes?.opacity).toEqual([{ t: 1, value: 0.5, easing: 'linear' }]);
	});
});
