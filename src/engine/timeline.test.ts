import { describe, expect, it } from 'vitest';
import {
	addMarker,
	addTrack,
	addTransition,
	maxTransitionDurationS,
	revalidateTransitions,
	closeGaps,
	createEmptyTimeline,
	DEFAULT_TRACK_MIX,
	DEFAULT_TITLE_TEXT,
	deleteMarker,
	defaultClipEffects,
	defaultClipTransform,
	defaultTimelineClip,
	defaultTitleClip,
	duplicateClips,
	isTitleClip,
	resolveAllAt,
	setClipTransform,
	setTitleContent,
	getTimelineDuration,
	insertClip,
	moveClips,
	moveClipTo,
	pasteClips,
	removeClip,
	removeTrack,
	reorderTrack,
	resolveAt,
	setClipDuration,
	setClipEffectParam,
	setClipAudioFade,
	setTrackPan,
	splitClipAt,
	trimClip,
	setTrackLock,
	setTrackVisible,
	setTrackSyncLock,
	setTrackEditTarget,
	linkClips,
	unlinkClips,
	expandLinkedGroup,
	shiftMarkers,
	removeMarkersInRange,
	rippleDelete,
	rippleTrim,
	rollTrim,
	slipEdit,
	slideEdit,
	insertEdit,
	overwriteEdit,
	liftRegion,
	extractRegion,
	type TimelineClip,
	type TimelineTrack,
	type TimelineMarker
} from './timeline';

function clip(
	partial: Omit<TimelineClip, 'effects' | 'transform' | 'audioFadeIn' | 'audioFadeOut'> &
		Partial<Pick<TimelineClip, 'effects' | 'transform' | 'audioFadeIn' | 'audioFadeOut'>>
): TimelineClip {
	return {
		effects: defaultClipEffects(),
		transform: defaultClipTransform(),
		audioFadeIn: 0,
		audioFadeOut: 0,
		...partial
	};
}

describe('timeline', () => {
	it('starts empty', () => {
		expect(createEmptyTimeline()).toEqual([]);
	});

	it('computes total duration from track end times', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					clip({ id: 'a', sourceId: 'src-1', start: 2, duration: 3, inPoint: 0 }),
					clip({ id: 'b', sourceId: 'src-1', start: 10, duration: 4, inPoint: 1 })
				]
			}
		];
		expect(getTimelineDuration(timeline)).toBe(14);
	});

	it('resolves a timestamp into owning clip + source timestamp', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					clip({ id: 'a', sourceId: 'src-1', start: 1, duration: 2, inPoint: 10 }),
					clip({ id: 'b', sourceId: 'src-1', start: 5, duration: 3, inPoint: 20 })
				]
			}
		];

		const resolved = resolveAt(timeline, 5.2);
		expect(resolved).not.toBeNull();
		expect(resolved!.clip.id).toBe('b');
		expect(resolved!.sourceTime).toBeCloseTo(20.2);
	});

	it('does not resolve outside all clips', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 1, inPoint: 0 })]
			}
		];
		expect(resolveAt(timeline, 1)).toBeNull();
		expect(resolveAt(timeline, -1)).toBeNull();
		expect(resolveAt(timeline, Number.NaN)).toBeNull();
	});

	it('splits a clip at timeline time', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 10, inPoint: 100 })]
			}
		];

		const next = splitClipAt(timeline, 'video-track', 4);
		expect(next[0]!.clips).toHaveLength(2);
		expect(next[0]!.clips[0]).toMatchObject({
			id: 'a',
			duration: 4,
			inPoint: 100
		});
		expect(next[0]!.clips[1]).toMatchObject({
			id: expect.stringMatching(/^a-/),
			duration: 6,
			start: 4,
			inPoint: 104
		});
	});

	it('splits keyframes into clip-local halves with boundary samples', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					clip({
						id: 'a',
						sourceId: 'src-1',
						start: 0,
						duration: 6,
						inPoint: 0,
						effects: { ...defaultClipEffects(), brightness: 0 },
						transform: { ...defaultClipTransform(), x: 0 },
						keyframes: {
							brightness: [
								{ t: 0, value: 0, easing: 'linear' },
								{ t: 6, value: 6, easing: 'linear' }
							],
							x: [
								{ t: 1, value: 10, easing: 'linear' },
								{ t: 5, value: 50, easing: 'linear' }
							]
						}
					})
				]
			}
		];

		const next = splitClipAt(timeline, 'video-track', 2);
		const [left, right] = next[0]!.clips;
		expect(left!.keyframes?.brightness).toEqual([
			{ t: 0, value: 0, easing: 'linear' },
			{ t: 2, value: 2, easing: 'linear' }
		]);
		expect(right!.keyframes?.brightness).toEqual([
			{ t: 0, value: 2, easing: 'linear' },
			{ t: 4, value: 6, easing: 'linear' }
		]);
		expect(left!.keyframes?.x).toEqual([
			{ t: 1, value: 10, easing: 'linear' },
			{ t: 2, value: 20, easing: 'linear' }
		]);
		expect(right!.keyframes?.x).toEqual([
			{ t: 0, value: 20, easing: 'linear' },
			{ t: 3, value: 50, easing: 'linear' }
		]);
	});

	it('does not split out of clip bounds', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 10, inPoint: 0 })]
			}
		];
		expect(splitClipAt(timeline, 'video-track', -1)).toEqual(timeline);
		expect(splitClipAt(timeline, 'video-track', 10)).toEqual(timeline);
	});

	it('removes a clip and keeps sibling timing', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 2, inPoint: 0 }),
					clip({ id: 'b', sourceId: 'src-1', start: 2, duration: 2, inPoint: 2 }),
					clip({ id: 'c', sourceId: 'src-1', start: 4, duration: 2, inPoint: 4 })
				]
			}
		];
		const next = removeClip(timeline, 'video-track', 'b');
		expect(next[0]!.clips.map((clip) => clip.id)).toEqual(['a', 'c']);
		expect(next[0]!.clips[1]).toMatchObject({ id: 'c', start: 4 });
	});

	it('moves a clip across compatible tracks to an absolute start without relayout', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 2, inPoint: 0 }),
					clip({ id: 'b', sourceId: 'src-1', start: 2, duration: 2, inPoint: 2 })
				]
			},
			{
				id: 'video-track-2',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					clip({ id: 'c', sourceId: 'src-2', start: 1, duration: 2, inPoint: 0 }),
					clip({ id: 'd', sourceId: 'src-2', start: 8, duration: 1, inPoint: 3 })
				]
			}
		];

		const next = moveClipTo(timeline, 'video-track', 'b', 'video-track-2', 4);
		expect(next[0]!.clips.map((clip) => clip.id)).toEqual(['a']);
		expect(next[1]!.clips.map((clip) => clip.id)).toEqual(['c', 'b', 'd']);
		expect(next[1]!.clips[0]).toMatchObject({ id: 'c', start: 1, duration: 2 });
		expect(next[1]!.clips[1]).toMatchObject({
			id: 'b',
			start: 4,
			duration: 2
		});
		expect(next[1]!.clips[2]).toMatchObject({ id: 'd', start: 8, duration: 1 });
	});

	it('moves a clip within its own track while preserving gaps', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 2, inPoint: 0 }),
					clip({ id: 'b', sourceId: 'src-1', start: 4, duration: 2, inPoint: 0 }),
					clip({ id: 'c', sourceId: 'src-1', start: 9, duration: 1, inPoint: 0 })
				]
			}
		];

		const next = moveClipTo(timeline, 'video-track', 'b', 'video-track', 2);
		expect(next[0]!.clips.map((clip) => [clip.id, clip.start])).toEqual([
			['a', 0],
			['b', 2],
			['c', 9]
		]);
	});

	it('rejects absolute moves that would overlap destination-track clips', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 2, inPoint: 0 }),
					clip({ id: 'b', sourceId: 'src-1', start: 4, duration: 2, inPoint: 0 }),
					clip({ id: 'c', sourceId: 'src-1', start: 7, duration: 2, inPoint: 0 })
				]
			}
		];

		expect(moveClipTo(timeline, 'video-track', 'b', 'video-track', 6)).toBe(timeline);
		expect(resolveAt(timeline, 7.25)!.clip.id).toBe('c');
	});

	it('rejects moves across incompatible track types', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 2, inPoint: 0 })]
			},
			{
				id: 'audio-track',
				type: 'audio',
				...DEFAULT_TRACK_MIX,
				clips: []
			}
		];

		expect(moveClipTo(timeline, 'video-track', 'a', 'audio-track', 3)).toBe(timeline);
	});

	it('closes gaps only through the explicit closeGaps operation', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 2, inPoint: 0 }),
					clip({ id: 'b', sourceId: 'src-1', start: 6, duration: 2, inPoint: 0 })
				]
			}
		];

		expect(moveClipTo(timeline, 'video-track', 'b', 'video-track', 3)[0]!.clips[1]!.start).toBe(3);
		const closed = closeGaps(timeline, 'video-track');
		expect(closed[0]!.clips.map((clip) => clip.start)).toEqual([0, 2]);
	});

	it('moves a batch of clips as one validated placement', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 1, inPoint: 0 }),
					clip({ id: 'b', sourceId: 'src-1', start: 3, duration: 1, inPoint: 0 }),
					clip({ id: 'c', sourceId: 'src-1', start: 10, duration: 1, inPoint: 0 })
				]
			}
		];

		const next = moveClips(timeline, [
			{ trackId: 'video-track', clipId: 'a', toTrackId: 'video-track', toStart: 5 },
			{ trackId: 'video-track', clipId: 'b', toTrackId: 'video-track', toStart: 8 }
		]);
		expect(next[0]!.clips.map((item) => [item.id, item.start])).toEqual([
			['a', 5],
			['b', 8],
			['c', 10]
		]);

		expect(
			moveClips(timeline, [
				{ trackId: 'video-track', clipId: 'a', toTrackId: 'video-track', toStart: 9.5 },
				{ trackId: 'video-track', clipId: 'b', toTrackId: 'video-track', toStart: 11 }
			])
		).toBe(timeline);
	});

	it('duplicates and pastes clips while preserving their relative offsets', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 1, inPoint: 0 }),
					clip({ id: 'b', sourceId: 'src-1', start: 3, duration: 1, inPoint: 0 })
				]
			}
		];

		const duplicated = duplicateClips(timeline, [
			{ trackId: 'video-track', clipId: 'a' },
			{ trackId: 'video-track', clipId: 'b' }
		]);
		expect(duplicated[0]!.clips.map((item) => item.start)).toEqual([0, 3, 4, 7]);
		// Duplicated clips get exactly one fresh id segment appended to the source
		// id (e.g. "a-<uuid>"), not a compounded "a-<uuid>-<uuid>" from cloning twice.
		const dupIds = [duplicated[0]!.clips[2]!.id, duplicated[0]!.clips[3]!.id];
		expect(dupIds[0]!.startsWith('a-')).toBe(true);
		expect(dupIds[1]!.startsWith('b-')).toBe(true);
		// A single appended UUID yields 6 dash-separated segments; a compounded id
		// would have 11.
		expect(dupIds[0]!.split('-')).toHaveLength(6);
		expect(dupIds[1]!.split('-')).toHaveLength(6);
		expect(new Set(dupIds).size).toBe(2);

		const pasted = pasteClips(
			timeline,
			[
				{ trackId: 'video-track', clip: timeline[0]!.clips[0]! },
				{ trackId: 'video-track', clip: timeline[0]!.clips[1]! }
			],
			10
		);
		expect(pasted[0]!.clips.map((item) => item.start)).toEqual([0, 3, 10, 13]);
	});

	it('pastes clips with their full LUT data intact', () => {
		const lut = {
			key: 'lut-a',
			fileName: 'grade.cube',
			title: 'Grade',
			size: 2,
			domainMin: [0.1, 0.2, 0.3] as [number, number, number],
			domainMax: [0.9, 0.8, 0.7] as [number, number, number],
			values: new Float32Array(24).fill(0.5)
		};
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 2, inPoint: 0, lut })]
			}
		];

		const pasted = pasteClips(
			timeline,
			[{ trackId: 'video-track', clip: timeline[0]!.clips[0]! }],
			3
		);
		const pastedLut = pasted[0]!.clips[1]!.lut;
		expect(pastedLut?.key).toBe('lut-a');
		expect(pastedLut?.domainMin).toEqual([0.1, 0.2, 0.3]);
		expect(pastedLut?.domainMax).toEqual([0.9, 0.8, 0.7]);
		expect(pastedLut?.values).toBeInstanceOf(Float32Array);
		expect(pastedLut?.values).toBe(lut.values);
	});

	it('returns the original timeline reference on no-op edits', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 10, inPoint: 0 })]
			}
		];
		expect(splitClipAt(timeline, 'video-track', 10)).toBe(timeline);
		expect(removeClip(timeline, 'video-track', 'missing')).toBe(timeline);
		expect(moveClipTo(timeline, 'video-track', 'missing', 'video-track', 0)).toBe(timeline);
		expect(trimClip(timeline, 'video-track', 'a', { edge: 'in', time: 0 })).toBe(timeline);
	});

	it('supports in/out trim boundaries as absolute timeline times', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [clip({ id: 'a', sourceId: 'src-1', start: 1, duration: 10, inPoint: 100 })]
			}
		];

		const trimmedIn = trimClip(timeline, 'video-track', 'a', { edge: 'in', time: 4 });
		expect(trimmedIn[0]!.clips[0]).toMatchObject({
			start: 4,
			inPoint: 103,
			duration: 7
		});

		const trimmedOut = trimClip(timeline, 'video-track', 'a', { edge: 'out', time: 6 });
		expect(trimmedOut[0]!.clips[0]).toMatchObject({
			duration: 5,
			start: 1,
			inPoint: 100
		});
	});

	it('rebases keyframes when trimming a clip in edge', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					defaultTimelineClip({
						id: 'a',
						sourceId: 'src-1',
						start: 0,
						duration: 6,
						inPoint: 0,
						effects: { ...defaultClipEffects(), brightness: 0 },
						transform: { ...defaultClipTransform(), x: 0 },
						keyframes: {
							brightness: [
								{ t: 0, value: 0, easing: 'linear' },
								{ t: 6, value: 6, easing: 'linear' }
							],
							x: [
								{ t: 1, value: 10, easing: 'linear' },
								{ t: 5, value: 50, easing: 'linear' }
							]
						}
					})
				]
			}
		];

		const trimmed = trimClip(timeline, 'video-track', 'a', { edge: 'in', time: 2 });
		const clip = trimmed[0]!.clips[0]!;
		expect(clip.start).toBe(2);
		expect(clip.duration).toBe(4);
		expect(clip.keyframes?.brightness).toEqual([
			{ t: 0, value: 2, easing: 'linear' },
			{ t: 4, value: 6, easing: 'linear' }
		]);
		expect(clip.keyframes?.x).toEqual([
			{ t: 0, value: 20, easing: 'linear' },
			{ t: 3, value: 50, easing: 'linear' }
		]);
	});

	it('extends the in-edge backward when the source has earlier content', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [clip({ id: 'a', sourceId: 'src-1', start: 5, duration: 5, inPoint: 100 })]
			}
		];
		// Drag the in-edge from t=5 back to t=3; source-time 98 still in bounds.
		const next = trimClip(timeline, 'video-track', 'a', {
			edge: 'in',
			time: 3,
			sourceDuration: 200
		});
		expect(next[0]!.clips[0]).toMatchObject({ start: 3, duration: 7, inPoint: 98 });
	});

	it('refuses an in-edge extension that would require negative source time', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 2 })]
			}
		];
		expect(
			trimClip(timeline, 'video-track', 'a', { edge: 'in', time: -3, sourceDuration: 200 })
		).toBe(timeline);
	});

	it('extends the out-edge forward up to the source duration', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 10 })]
			}
		];
		// Source ends at 20; clip uses inPoint=10, so out can extend to t=0+(20-10)=10.
		const next = trimClip(timeline, 'video-track', 'a', {
			edge: 'out',
			time: 9,
			sourceDuration: 20
		});
		expect(next[0]!.clips[0]).toMatchObject({ start: 0, duration: 9, inPoint: 10 });
	});

	it('refuses an out-edge extension that would overlap the next same-track clip', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 }),
					clip({ id: 'b', sourceId: 'src-1', start: 8, duration: 2, inPoint: 0 })
				]
			}
		];
		// Source has plenty of headroom but the neighbor would be shadowed.
		expect(
			trimClip(timeline, 'video-track', 'a', { edge: 'out', time: 9, sourceDuration: 100 })
		).toBe(timeline);
		// Extending exactly up to the neighbor's start is OK.
		const next = trimClip(timeline, 'video-track', 'a', {
			edge: 'out',
			time: 8,
			sourceDuration: 100
		});
		expect(next[0]!.clips[0]).toMatchObject({ start: 0, duration: 8 });
	});

	it('refuses an in-edge extension that would overlap the previous same-track clip', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 }),
					clip({ id: 'b', sourceId: 'src-1', start: 8, duration: 5, inPoint: 10 })
				]
			}
		];
		// Pulling b's in-edge back to t=4 would overlap a (which ends at 5).
		expect(
			trimClip(timeline, 'video-track', 'b', { edge: 'in', time: 4, sourceDuration: 100 })
		).toBe(timeline);
		// Pulling back to exactly t=5 (touching a's out-edge) is OK.
		const next = trimClip(timeline, 'video-track', 'b', {
			edge: 'in',
			time: 5,
			sourceDuration: 100
		});
		expect(next[0]!.clips[1]).toMatchObject({ start: 5, duration: 8, inPoint: 7 });
	});

	it('refuses an out-edge extension past the source duration', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 10 })]
			}
		];
		expect(
			trimClip(timeline, 'video-track', 'a', { edge: 'out', time: 15, sourceDuration: 20 })
		).toBe(timeline);
	});

	it('without sourceDuration, refuses to extend past the current clip end', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 })]
			}
		];
		expect(trimClip(timeline, 'video-track', 'a', { edge: 'out', time: 10 })).toBe(timeline);
	});

	it('updates one effect param on a clip', () => {
		const custom = { ...defaultClipEffects(), saturation: 1.4 };
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0, effects: custom })
				]
			}
		];

		const next = setClipEffectParam(timeline, 'video-track', 'a', 'saturation', 0.6);
		expect(next).not.toBe(timeline);
		expect(next[0]!.clips[0]!.effects.saturation).toBeCloseTo(0.6);
		expect(timeline[0]!.clips[0]!.effects.saturation).toBeCloseTo(1.4);
		expect(setClipEffectParam(timeline, 'video-track', 'a', 'saturation', 1.4)).toBe(timeline);
	});

	it('keeps no-op trims when time is on clip edges', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [clip({ id: 'a', sourceId: 'src-1', start: 1, duration: 10, inPoint: 100 })]
			}
		];

		expect(trimClip(timeline, 'video-track', 'a', { edge: 'in', time: 1 })[0]!.clips[0]).toEqual(
			timeline[0]!.clips[0]
		);
		expect(trimClip(timeline, 'video-track', 'a', { edge: 'out', time: 11 })[0]!.clips[0]).toEqual(
			timeline[0]!.clips[0]
		);
	});

	it('updates track pan within the legal range', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'audio-track',
				type: 'audio',
				...DEFAULT_TRACK_MIX,
				clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 })]
			}
		];

		const next = setTrackPan(timeline, 'audio-track', -0.75);
		expect(next[0]!.pan).toBeCloseTo(-0.75);
		expect(setTrackPan(next, 'audio-track', -0.75)).toBe(next);
		expect(setTrackPan(timeline, 'audio-track', 2)).toBe(timeline);
	});

	it('updates clip audio fades without exceeding clip duration', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'audio-track',
				type: 'audio',
				...DEFAULT_TRACK_MIX,
				clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 2, inPoint: 0 })]
			}
		];

		const next = setClipAudioFade(timeline, 'audio-track', 'a', 'in', 0.5);
		expect(next[0]!.clips[0]!.audioFadeIn).toBeCloseTo(0.5);
		expect(setClipAudioFade(timeline, 'audio-track', 'a', 'out', 3)).toBe(timeline);
	});

	it('adds, sorts, and deletes timeline markers', () => {
		const markers = addMarker([{ id: 'marker-existing', time: 8, label: 'Existing' }], 2, 'Intro');
		expect(markers.map((marker) => marker.label)).toEqual(['Intro', 'Existing']);
		expect(markers[0]!.id).toMatch(/^marker-/);

		const deleted = deleteMarker(markers, markers[0]!.id);
		expect(deleted).toEqual([{ id: 'marker-existing', time: 8, label: 'Existing' }]);
		expect(deleteMarker(deleted, 'missing')).toBe(deleted);
	});
});

describe('timeline tracks', () => {
	function videoTrack(id: string, clips: TimelineClip[] = []): TimelineTrack {
		return { id, type: 'video', ...DEFAULT_TRACK_MIX, clips };
	}

	it('adds an empty track of the requested type with default mix', () => {
		const next = addTrack(createEmptyTimeline(), 'audio');
		expect(next).toHaveLength(1);
		expect(next[0]!.type).toBe('audio');
		expect(next[0]!.clips).toEqual([]);
		expect(next[0]!).toMatchObject(DEFAULT_TRACK_MIX);
		expect(next[0]!.id).toMatch(/^track-audio-/);
	});

	it('removes a track and returns the original on a missing id', () => {
		const timeline = [videoTrack('a'), videoTrack('b')];
		expect(removeTrack(timeline, 'a').map((t) => t.id)).toEqual(['b']);
		expect(removeTrack(timeline, 'missing')).toBe(timeline);
	});

	it('reorders tracks within bounds and is a no-op otherwise', () => {
		const timeline = [videoTrack('a'), videoTrack('b'), videoTrack('c')];
		expect(reorderTrack(timeline, 'c', 0).map((t) => t.id)).toEqual(['c', 'a', 'b']);
		expect(reorderTrack(timeline, 'a', 99).map((t) => t.id)).toEqual(['b', 'c', 'a']);
		expect(reorderTrack(timeline, 'a', 0)).toBe(timeline);
		expect(reorderTrack(timeline, 'missing', 1)).toBe(timeline);
	});

	it('inserts a clip when there is room and rejects overlaps', () => {
		const timeline = [
			videoTrack('v', [
				defaultTimelineClip({ id: 'a', sourceId: 's', start: 0, duration: 2, inPoint: 0 })
			])
		];
		const placed = insertClip(
			timeline,
			'v',
			defaultTimelineClip({ id: 'b', sourceId: 's', start: 3, duration: 2, inPoint: 0 })
		);
		expect(placed[0]!.clips.map((c) => c.id)).toEqual(['a', 'b']);

		const overlapping = insertClip(
			timeline,
			'v',
			defaultTimelineClip({ id: 'c', sourceId: 's', start: 1, duration: 2, inPoint: 0 })
		);
		expect(overlapping).toBe(timeline);
		expect(
			insertClip(
				timeline,
				'missing',
				defaultTimelineClip({ id: 'd', sourceId: 's', start: 9, duration: 1, inPoint: 0 })
			)
		).toBe(timeline);
	});

	it('sets still clip duration, bounded by the next neighbor', () => {
		const timeline = [
			videoTrack('v', [
				defaultTimelineClip({ id: 'still', sourceId: 'img', start: 0, duration: 5, inPoint: 0 }),
				defaultTimelineClip({ id: 'next', sourceId: 's', start: 8, duration: 2, inPoint: 0 })
			])
		];
		const grown = setClipDuration(timeline, 'v', 'still', 6);
		expect(grown[0]!.clips[0]!.duration).toBe(6);

		// Clamps to the gap before the next clip (start 8 - start 0).
		const clamped = setClipDuration(timeline, 'v', 'still', 20);
		expect(clamped[0]!.clips[0]!.duration).toBe(8);

		expect(setClipDuration(timeline, 'v', 'still', 0)).toBe(timeline);
		expect(setClipDuration(timeline, 'v', 'still', 5)).toBe(timeline);
	});

	describe('resolveAllAt', () => {
		function stack(): TimelineTrack[] {
			return [
				{
					id: 'video-base',
					type: 'video',
					...DEFAULT_TRACK_MIX,
					clips: [clip({ id: 'base', sourceId: 's1', start: 0, duration: 10, inPoint: 5 })]
				},
				{
					id: 'audio',
					type: 'audio',
					...DEFAULT_TRACK_MIX,
					clips: [clip({ id: 'aud', sourceId: 's1', start: 0, duration: 10, inPoint: 0 })]
				},
				{
					id: 'video-top',
					type: 'video',
					...DEFAULT_TRACK_MIX,
					clips: [clip({ id: 'pip', sourceId: 's2', start: 2, duration: 3, inPoint: 1 })]
				}
			];
		}

		it('returns overlapping video layers bottom-to-top, skipping audio', () => {
			const layers = resolveAllAt(stack(), 3);
			expect(layers.map((l) => l.clip.id)).toEqual(['base', 'pip']);
			expect(layers[0]!.sourceTime).toBeCloseTo(8); // base inPoint 5 + (3 - 0)
			expect(layers[1]!.sourceTime).toBeCloseTo(2); // pip inPoint 1 + (3 - 2)
		});

		it('returns only the base layer outside the overlap window', () => {
			const layers = resolveAllAt(stack(), 7);
			expect(layers.map((l) => l.clip.id)).toEqual(['base']);
		});

		it('returns nothing in a gap or before zero', () => {
			expect(resolveAllAt(stack(), 50)).toEqual([]);
			expect(resolveAllAt(stack(), -1)).toEqual([]);
		});
	});

	describe('setClipTransform', () => {
		function withClip(): TimelineTrack[] {
			return [
				{
					id: 'v',
					type: 'video',
					...DEFAULT_TRACK_MIX,
					clips: [clip({ id: 'a', sourceId: 's', start: 0, duration: 5, inPoint: 0 })]
				}
			];
		}

		it('merges a partial transform and normalizes it', () => {
			const next = setClipTransform(withClip(), 'v', 'a', { scale: 0.5, opacity: 2 });
			expect(next[0]!.clips[0]!.transform.scale).toBe(0.5);
			expect(next[0]!.clips[0]!.transform.opacity).toBe(1);
		});

		it('returns the original timeline on no-op and unknown clips', () => {
			const timeline = withClip();
			expect(setClipTransform(timeline, 'v', 'a', { scale: 1 })).toBe(timeline);
			expect(setClipTransform(timeline, 'v', 'missing', { scale: 0.5 })).toBe(timeline);
		});
	});

	describe('splitClipAt with overlapping tracks', () => {
		function stacked(): TimelineTrack[] {
			return [
				{
					id: 'video-base',
					type: 'video',
					...DEFAULT_TRACK_MIX,
					clips: [clip({ id: 'base', sourceId: 's1', start: 0, duration: 10, inPoint: 0 })]
				},
				{
					id: 'video-top',
					type: 'video',
					...DEFAULT_TRACK_MIX,
					clips: [clip({ id: 'pip', sourceId: 's2', start: 0, duration: 10, inPoint: 0 })]
				}
			];
		}

		it('splits the clip on the requested track, not the first overlapping one', () => {
			const next = splitClipAt(stacked(), 'video-top', 4);
			expect(next[0]!.clips.map((c) => c.id)).toEqual(['base']); // base untouched
			expect(next[1]!.clips).toHaveLength(2); // top track split into two
			expect(next[1]!.clips[0]!.duration).toBe(4);
			expect(next[1]!.clips[1]!.inPoint).toBe(4);
		});
	});
	it('adds cut-point transitions and clamps duration to source headroom', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					clip({ id: 'a', sourceId: 'src-a', start: 0, duration: 4, inPoint: 1 }),
					clip({ id: 'b', sourceId: 'src-b', start: 4, duration: 4, inPoint: 0.75 })
				]
			}
		];
		const durations = {
			durationForSource: (sourceId: string) => (sourceId === 'src-a' ? 5.25 : 8)
		};

		const transitions = addTransition(timeline, [], durations, {
			id: 'transition-1',
			trackId: 'video-track',
			fromClipId: 'a',
			toClipId: 'b',
			durationS: 3,
			kind: 'wipe',
			params: { direction: 'right' }
		});

		expect(transitions).toEqual([
			{
				id: 'transition-1',
				trackId: 'video-track',
				fromClipId: 'a',
				toClipId: 'b',
				durationS: 0.5,
				kind: 'wipe',
				params: { direction: 'right' }
			}
		]);
		expect(maxTransitionDurationS(timeline, durations, 'video-track', 'a', 'b')).toBe(0.5);
	});

	it('rejects transitions between separated, missing, or non-video neighbours', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					clip({ id: 'a', sourceId: 'src-a', start: 0, duration: 3, inPoint: 1 }),
					clip({ id: 'b', sourceId: 'src-b', start: 4, duration: 3, inPoint: 1 })
				]
			},
			{
				id: 'audio-track',
				type: 'audio',
				...DEFAULT_TRACK_MIX,
				clips: [clip({ id: 'c', sourceId: 'src-c', start: 0, duration: 3, inPoint: 1 })]
			}
		];
		const durations = { durationForSource: () => 10 };

		expect(
			addTransition(timeline, [], durations, {
				id: 'transition-1',
				trackId: 'video-track',
				fromClipId: 'a',
				toClipId: 'b',
				durationS: 1
			})
		).toEqual([]);
		expect(
			addTransition(timeline, [], durations, {
				id: 'transition-2',
				trackId: 'audio-track',
				fromClipId: 'c',
				toClipId: 'missing',
				durationS: 1
			})
		).toEqual([]);
	});

	it('revalidates transitions after trim, move, and delete edits', () => {
		const timeline: TimelineTrack[] = [
			{
				id: 'video-track',
				type: 'video',
				...DEFAULT_TRACK_MIX,
				clips: [
					clip({ id: 'a', sourceId: 'src-a', start: 0, duration: 4, inPoint: 1 }),
					clip({ id: 'b', sourceId: 'src-b', start: 4, duration: 4, inPoint: 1 })
				]
			}
		];
		const durations = { durationForSource: () => 10 };
		const transitions = addTransition(timeline, [], durations, {
			id: 'transition-1',
			trackId: 'video-track',
			fromClipId: 'a',
			toClipId: 'b',
			durationS: 2
		});

		const trimmed = trimClip(timeline, 'video-track', 'b', {
			edge: 'in',
			time: 4.75,
			sourceDuration: 10
		});
		expect(revalidateTransitions(trimmed, transitions, durations)).toEqual([]);

		const moved = moveClipTo(timeline, 'video-track', 'b', 'video-track', 5);
		expect(revalidateTransitions(moved, transitions, durations)).toEqual([]);

		const deleted = removeClip(timeline, 'video-track', 'b');
		expect(revalidateTransitions(deleted, transitions, durations)).toEqual([]);

		const stillAdjacent = trimClip(timeline, 'video-track', 'a', {
			edge: 'in',
			time: 0.5,
			sourceDuration: 10
		});
		expect(revalidateTransitions(stillAdjacent, transitions, durations)).toHaveLength(1);
	});
});

describe('title clips', () => {
	function videoTrack(clips: TimelineClip[] = []): TimelineTrack {
		return { id: 'v', type: 'video', clips, ...DEFAULT_TRACK_MIX };
	}

	it('defaultTitleClip is a source-less title with defaults', () => {
		const t = defaultTitleClip({ id: 'title-1', start: 2, duration: 5 });
		expect(t.kind).toBe('title');
		expect(isTitleClip(t)).toBe(true);
		expect(t.sourceId).toBe('');
		expect(t.inPoint).toBe(0);
		expect(t.title?.text).toBe(DEFAULT_TITLE_TEXT);
		expect(t.transform).toEqual(defaultClipTransform());
	});

	it('inserts onto a video track and resolves as a layer', () => {
		const title = defaultTitleClip({ id: 'title-1', start: 1, duration: 4 });
		const timeline = insertClip([videoTrack()], 'v', title);
		const layers = resolveAllAt(timeline, 2);
		expect(layers).toHaveLength(1);
		expect(isTitleClip(layers[0]!.clip)).toBe(true);
	});

	it('setTitleContent updates text, merges style, and is a no-op when unchanged', () => {
		const title = defaultTitleClip({ id: 'title-1', start: 0, duration: 4 });
		const timeline = [videoTrack([title])];

		const renamed = setTitleContent(timeline, 'v', 'title-1', { text: 'Lower third' });
		expect(renamed).not.toBe(timeline);
		expect(renamed[0]!.clips[0]!.title?.text).toBe('Lower third');
		// Style preserved on a text-only edit.
		expect(renamed[0]!.clips[0]!.title?.style.color).toBe(title.title!.style.color);

		const restyled = setTitleContent(renamed, 'v', 'title-1', { style: { color: '#ff0000' } });
		expect(restyled[0]!.clips[0]!.title?.style.color).toBe('#ff0000');
		expect(restyled[0]!.clips[0]!.title?.text).toBe('Lower third');

		// Identical content returns the same reference (no churn).
		expect(setTitleContent(restyled, 'v', 'title-1', { text: 'Lower third' })).toBe(restyled);
	});

	it('setTitleContent ignores non-title clips and missing targets', () => {
		const videoClip = clip({ id: 'c', sourceId: 's', start: 0, duration: 3, inPoint: 0 });
		const timeline = [videoTrack([videoClip])];
		expect(setTitleContent(timeline, 'v', 'c', { text: 'x' })).toBe(timeline);
		expect(setTitleContent(timeline, 'v', 'missing', { text: 'x' })).toBe(timeline);
	});

	it('split preserves title content on both halves with distinct ids', () => {
		const title = defaultTitleClip({
			id: 'title-1',
			start: 0,
			duration: 6,
			title: { text: 'Keep me', style: { color: '#00ff00' } }
		});
		const timeline = [videoTrack([title])];
		const split = splitClipAt(timeline, 'v', 3);
		const clips = split[0]!.clips;
		expect(clips).toHaveLength(2);
		expect(clips[0]!.id).not.toBe(clips[1]!.id);
		for (const c of clips) {
			expect(isTitleClip(c)).toBe(true);
			expect(c.title?.text).toBe('Keep me');
			expect(c.title?.style.color).toBe('#00ff00');
		}
	});

	it('move and delete operate on title clips', () => {
		const title = defaultTitleClip({ id: 'title-1', start: 0, duration: 4 });
		const timeline = [videoTrack([title])];
		const moved = moveClipTo(timeline, 'v', 'title-1', 'v', 5);
		expect(moved[0]!.clips[0]!.start).toBe(5);
		expect(removeClip(moved, 'v', 'title-1')[0]!.clips).toHaveLength(0);
	});

	it('title out-edge can extend past its current end (still-like, no source)', () => {
		const title = defaultTitleClip({ id: 'title-1', start: 0, duration: 5 });
		const timeline = [videoTrack([title])];

		// Shrink, then lengthen back out past the original end — no sourceDuration.
		const shorter = trimClip(timeline, 'v', 'title-1', { edge: 'out', time: 3 });
		expect(shorter[0]!.clips[0]!.duration).toBe(3);
		const longer = trimClip(shorter, 'v', 'title-1', { edge: 'out', time: 9 });
		expect(longer[0]!.clips[0]!.duration).toBe(9);
	});

	it('title in-edge can extend left and keeps in-point at 0', () => {
		const title = defaultTitleClip({ id: 'title-1', start: 4, duration: 4 });
		const timeline = [videoTrack([title])];
		const extended = trimClip(timeline, 'v', 'title-1', { edge: 'in', time: 1 });
		expect(extended[0]!.clips[0]!.start).toBe(1);
		expect(extended[0]!.clips[0]!.duration).toBe(7);
		expect(extended[0]!.clips[0]!.inPoint).toBe(0);
	});

	it('title out-edge is still bounded by the next neighbor', () => {
		const title = defaultTitleClip({ id: 'title-1', start: 0, duration: 4 });
		const blocker = defaultTitleClip({ id: 'title-2', start: 6, duration: 2 });
		const timeline = [videoTrack([title, blocker])];
		// Extending past the neighbor's start (6) is rejected.
		expect(trimClip(timeline, 'v', 'title-1', { edge: 'out', time: 7 })).toBe(timeline);
		expect(
			trimClip(timeline, 'v', 'title-1', { edge: 'out', time: 6 })[0]!.clips[0]!.duration
		).toBe(6);
	});
});

// --- Phase 20: Editing Tools V2 ---

function track(
	id: string,
	type: 'video' | 'audio',
	clips: TimelineClip[],
	overrides?: Partial<TimelineTrack>
): TimelineTrack {
	return { id, type, clips, ...DEFAULT_TRACK_MIX, ...overrides };
}

const sourceDurations = {
	durationForSource: (sourceId: string) => {
		if (sourceId === 'src-1') return 30;
		if (sourceId === 'src-2') return 20;
		if (sourceId === 'src-3') return 15;
		return undefined;
	}
};

describe('track state', () => {
	it('setTrackLock toggles locked', () => {
		const tl = [track('v', 'video', [])];
		expect(tl[0]!.locked).toBe(false);
		const next = setTrackLock(tl, 'v', true);
		expect(next[0]!.locked).toBe(true);
		expect(setTrackLock(next, 'v', true)).toBe(next);
	});

	it('setTrackVisible toggles visible', () => {
		const tl = [track('v', 'video', [])];
		const next = setTrackVisible(tl, 'v', false);
		expect(next[0]!.visible).toBe(false);
	});

	it('setTrackSyncLock toggles syncLocked', () => {
		const tl = [track('v', 'video', [])];
		const next = setTrackSyncLock(tl, 'v', true);
		expect(next[0]!.syncLocked).toBe(true);
	});

	it('setTrackEditTarget toggles editTarget', () => {
		const tl = [track('v', 'video', [])];
		expect(tl[0]!.editTarget).toBe(true);
		const next = setTrackEditTarget(tl, 'v', false);
		expect(next[0]!.editTarget).toBe(false);
	});

	it('resolveAllAt skips hidden tracks', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const tl = [track('v', 'video', [a], { visible: false })];
		expect(resolveAllAt(tl, 2)).toHaveLength(0);
		const tl2 = [track('v', 'video', [a], { visible: true })];
		expect(resolveAllAt(tl2, 2)).toHaveLength(1);
	});
});

describe('linked clips', () => {
	it('linkClips assigns shared linkedGroupId', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const b = clip({ id: 'b', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const tl = [track('v', 'video', [a]), track('a', 'audio', [b])];
		const next = linkClips(tl, [
			{ trackId: 'v', clipId: 'a' },
			{ trackId: 'a', clipId: 'b' }
		]);
		const groupId = next[0]!.clips[0]!.linkedGroupId;
		expect(groupId).toBeTruthy();
		expect(next[1]!.clips[0]!.linkedGroupId).toBe(groupId);
	});

	it('unlinkClips clears linkedGroupId', () => {
		const a = clip({
			id: 'a',
			sourceId: 'src-1',
			start: 0,
			duration: 5,
			inPoint: 0,
			linkedGroupId: 'g1'
		});
		const b = clip({
			id: 'b',
			sourceId: 'src-1',
			start: 0,
			duration: 5,
			inPoint: 0,
			linkedGroupId: 'g1'
		});
		const tl = [track('v', 'video', [a]), track('a', 'audio', [b])];
		const next = unlinkClips(tl, [
			{ trackId: 'v', clipId: 'a' },
			{ trackId: 'a', clipId: 'b' }
		]);
		expect(next[0]!.clips[0]!.linkedGroupId).toBeUndefined();
		expect(next[1]!.clips[0]!.linkedGroupId).toBeUndefined();
	});

	it('expandLinkedGroup returns all members', () => {
		const a = clip({
			id: 'a',
			sourceId: 'src-1',
			start: 0,
			duration: 5,
			inPoint: 0,
			linkedGroupId: 'g1'
		});
		const b = clip({
			id: 'b',
			sourceId: 'src-1',
			start: 0,
			duration: 5,
			inPoint: 0,
			linkedGroupId: 'g1'
		});
		const c = clip({ id: 'c', sourceId: 'src-2', start: 10, duration: 3, inPoint: 0 });
		const tl = [track('v', 'video', [a, c]), track('a', 'audio', [b])];
		const expanded = expandLinkedGroup(tl, [{ trackId: 'v', clipId: 'a' }]);
		expect(expanded).toHaveLength(2);
		expect(expanded.some((r) => r.clipId === 'b')).toBe(true);
	});

	it('linkClips requires at least 2 refs', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const tl = [track('v', 'video', [a])];
		expect(linkClips(tl, [{ trackId: 'v', clipId: 'a' }])).toBe(tl);
	});

	it('unlinkClips clears orphaned sole member', () => {
		const a = clip({
			id: 'a',
			sourceId: 'src-1',
			start: 0,
			duration: 5,
			inPoint: 0,
			linkedGroupId: 'g1'
		});
		const b = clip({
			id: 'b',
			sourceId: 'src-1',
			start: 0,
			duration: 5,
			inPoint: 0,
			linkedGroupId: 'g1'
		});
		const tl = [track('v', 'video', [a]), track('a', 'audio', [b])];
		const next = unlinkClips(tl, [{ trackId: 'v', clipId: 'a' }]);
		expect(next[0]!.clips[0]!.linkedGroupId).toBeUndefined();
		expect(next[1]!.clips[0]!.linkedGroupId).toBeUndefined();
	});
});

describe('lock guard', () => {
	it('locked track rejects slipEdit', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 3 });
		const tl = [track('v', 'video', [a], { locked: true })];
		expect(slipEdit(tl, 'v', 'a', 1, 30)).toBe(tl);
	});

	it('locked track rejects rippleDelete', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const tl = [track('v', 'video', [a], { locked: true })];
		expect(rippleDelete(tl, [{ trackId: 'v', clipId: 'a' }], [])).toBe(tl);
	});

	it('linked clip on locked track rejects rippleDelete on the other', () => {
		const a = clip({
			id: 'a',
			sourceId: 'src-1',
			start: 0,
			duration: 5,
			inPoint: 0,
			linkedGroupId: 'g1'
		});
		const b = clip({
			id: 'b',
			sourceId: 'src-1',
			start: 0,
			duration: 5,
			inPoint: 0,
			linkedGroupId: 'g1'
		});
		const tl = [track('v', 'video', [a]), track('a', 'audio', [b], { locked: true })];
		expect(rippleDelete(tl, [{ trackId: 'v', clipId: 'a' }], [])).toBe(tl);
	});
});

describe('shiftMarkers', () => {
	it('shifts markers at or after the given time', () => {
		const markers: TimelineMarker[] = [
			{ id: 'm1', time: 2, label: 'A' },
			{ id: 'm2', time: 5, label: 'B' },
			{ id: 'm3', time: 8, label: 'C' }
		];
		const shifted = shiftMarkers(markers, 5, -2);
		expect(shifted[0]!.time).toBe(2);
		expect(shifted[1]!.time).toBe(3);
		expect(shifted[2]!.time).toBe(6);
	});

	it('returns original on zero delta', () => {
		const markers: TimelineMarker[] = [{ id: 'm1', time: 2, label: 'A' }];
		expect(shiftMarkers(markers, 0, 0)).toBe(markers);
	});
});

describe('rippleDelete', () => {
	it('removes clips and shifts downstream left', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 3, inPoint: 0 });
		const b = clip({ id: 'b', sourceId: 'src-1', start: 3, duration: 2, inPoint: 3 });
		const c = clip({ id: 'c', sourceId: 'src-1', start: 5, duration: 4, inPoint: 5 });
		const tl = [track('v', 'video', [a, b, c])];
		const next = rippleDelete(tl, [{ trackId: 'v', clipId: 'b' }], []);
		expect(next[0]!.clips).toHaveLength(2);
		expect(next[0]!.clips[1]!.start).toBe(3);
		expect(next[0]!.clips[1]!.id).toBe('c');
	});

	it('shifts sync-locked tracks', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const b = clip({ id: 'b', sourceId: 'src-1', start: 5, duration: 3, inPoint: 5 });
		const s = clip({ id: 's', sourceId: 'src-2', start: 5, duration: 4, inPoint: 0 });
		const tl = [track('v', 'video', [a, b]), track('a', 'audio', [s], { syncLocked: true })];
		const next = rippleDelete(tl, [{ trackId: 'v', clipId: 'a' }], ['a']);
		expect(next[0]!.clips[0]!.start).toBe(0);
		expect(next[1]!.clips[0]!.start).toBe(0);
	});

	it('rejects when sync-locked track is locked', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const s = clip({ id: 's', sourceId: 'src-2', start: 5, duration: 4, inPoint: 0 });
		const tl = [
			track('v', 'video', [a]),
			track('a', 'audio', [s], { syncLocked: true, locked: true })
		];
		expect(rippleDelete(tl, [{ trackId: 'v', clipId: 'a' }], ['a'])).toBe(tl);
	});
});

describe('rippleTrim', () => {
	it('trims out-edge and shifts downstream', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const b = clip({ id: 'b', sourceId: 'src-1', start: 5, duration: 3, inPoint: 5 });
		const tl = [track('v', 'video', [a, b])];
		const next = rippleTrim(tl, 'v', 'a', 'out', 3, []);
		expect(next[0]!.clips[0]!.duration).toBe(3);
		expect(next[0]!.clips[1]!.start).toBe(3);
	});

	it('trims in-edge inward and closes gap by shifting left', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const b = clip({ id: 'b', sourceId: 'src-1', start: 5, duration: 3, inPoint: 5 });
		const tl = [track('v', 'video', [a, b])];
		const next = rippleTrim(tl, 'v', 'a', 'in', 2, []);
		// In-edge inward: clip a trims from 0→2, gap closed, everything shifts left by 2
		expect(next[0]!.clips[0]!.start).toBe(0);
		expect(next[0]!.clips[0]!.duration).toBe(3);
		expect(next[0]!.clips[0]!.inPoint).toBe(2);
		expect(next[0]!.clips[1]!.start).toBe(3);
	});

	it('rejects on locked track', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const tl = [track('v', 'video', [a], { locked: true })];
		expect(rippleTrim(tl, 'v', 'a', 'out', 3, [])).toBe(tl);
	});
});

describe('rollTrim', () => {
	it('moves cut point between adjacent clips', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const b = clip({ id: 'b', sourceId: 'src-1', start: 5, duration: 5, inPoint: 5 });
		const tl = [track('v', 'video', [a, b])];
		const next = rollTrim(tl, 'v', 'a', 'out', 7, sourceDurations);
		expect(next[0]!.clips[0]!.duration).toBe(7);
		expect(next[0]!.clips[1]!.start).toBe(7);
		expect(next[0]!.clips[1]!.duration).toBe(3);
		expect(next[0]!.clips[1]!.inPoint).toBe(7);
	});

	it('rejects on locked track', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const b = clip({ id: 'b', sourceId: 'src-1', start: 5, duration: 5, inPoint: 5 });
		const tl = [track('v', 'video', [a, b], { locked: true })];
		expect(rollTrim(tl, 'v', 'a', 'out', 7, sourceDurations)).toBe(tl);
	});

	it('rejects non-adjacent clips', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 3, inPoint: 0 });
		const b = clip({ id: 'b', sourceId: 'src-1', start: 5, duration: 3, inPoint: 5 });
		const tl = [track('v', 'video', [a, b])];
		expect(rollTrim(tl, 'v', 'a', 'out', 4, sourceDurations)).toBe(tl);
	});

	it('clamps to source bounds', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const b = clip({ id: 'b', sourceId: 'src-1', start: 5, duration: 5, inPoint: 5 });
		const tl = [track('v', 'video', [a, b])];
		expect(rollTrim(tl, 'v', 'a', 'out', 35, sourceDurations)).toBe(tl);
	});

	it('rejects when source duration is unknown', () => {
		const a = clip({ id: 'a', sourceId: 'unknown', start: 0, duration: 5, inPoint: 0 });
		const b = clip({ id: 'b', sourceId: 'unknown', start: 5, duration: 5, inPoint: 5 });
		const tl = [track('v', 'video', [a, b])];
		expect(rollTrim(tl, 'v', 'a', 'out', 7, sourceDurations)).toBe(tl);
	});
});

describe('slipEdit', () => {
	it('shifts inPoint without moving clip', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 5, duration: 5, inPoint: 3 });
		const tl = [track('v', 'video', [a])];
		const next = slipEdit(tl, 'v', 'a', 2, 30);
		expect(next[0]!.clips[0]!.inPoint).toBe(5);
		expect(next[0]!.clips[0]!.start).toBe(5);
		expect(next[0]!.clips[0]!.duration).toBe(5);
	});

	it('clamps to source bounds', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const tl = [track('v', 'video', [a])];
		expect(slipEdit(tl, 'v', 'a', -1, 30)).toBe(tl);
		expect(slipEdit(tl, 'v', 'a', 26, 30)).toBe(tl);
	});

	it('rejects on locked track', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 3 });
		const tl = [track('v', 'video', [a], { locked: true })];
		expect(slipEdit(tl, 'v', 'a', 1, 30)).toBe(tl);
	});

	it('rejects on title clips', () => {
		const title = defaultTitleClip({ id: 't', start: 0, duration: 5 });
		const tl = [track('v', 'video', [title])];
		expect(slipEdit(tl, 'v', 't', 1, 30)).toBe(tl);
	});
});

describe('slideEdit', () => {
	it('slides clip and adjusts neighbors', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const b = clip({ id: 'b', sourceId: 'src-2', start: 5, duration: 5, inPoint: 0 });
		const c = clip({ id: 'c', sourceId: 'src-3', start: 10, duration: 5, inPoint: 0 });
		const tl = [track('v', 'video', [a, b, c])];
		const next = slideEdit(tl, 'v', 'b', 2, sourceDurations);
		expect(next[0]!.clips.find((c) => c.id === 'a')!.duration).toBe(7);
		expect(next[0]!.clips.find((c) => c.id === 'b')!.start).toBe(7);
		expect(next[0]!.clips.find((c) => c.id === 'c')!.start).toBe(12);
		expect(next[0]!.clips.find((c) => c.id === 'c')!.inPoint).toBe(2);
		expect(next[0]!.clips.find((c) => c.id === 'c')!.duration).toBe(3);
	});

	it('rejects on locked track', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const b = clip({ id: 'b', sourceId: 'src-2', start: 5, duration: 5, inPoint: 0 });
		const c = clip({ id: 'c', sourceId: 'src-3', start: 10, duration: 5, inPoint: 0 });
		const tl = [track('v', 'video', [a, b, c], { locked: true })];
		expect(slideEdit(tl, 'v', 'b', 2, sourceDurations)).toBe(tl);
	});

	it('rejects non-adjacent clips', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 3, inPoint: 0 });
		const b = clip({ id: 'b', sourceId: 'src-2', start: 5, duration: 3, inPoint: 0 });
		const tl = [track('v', 'video', [a, b])];
		expect(slideEdit(tl, 'v', 'b', 1, sourceDurations)).toBe(tl);
	});
});

describe('insertEdit', () => {
	it('places clips and shifts downstream', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 3, inPoint: 0 });
		const b = clip({ id: 'b', sourceId: 'src-1', start: 5, duration: 3, inPoint: 5 });
		const tl = [track('v', 'video', [a, b])];
		const newClip = clip({ id: 'new', sourceId: 'src-2', start: 0, duration: 2, inPoint: 0 });
		const next = insertEdit(tl, ['v'], [{ trackId: 'v', clip: newClip }], 3, []);
		expect(next[0]!.clips).toHaveLength(3);
		expect(next[0]!.clips[0]!.id).toBe('a');
		expect(next[0]!.clips[0]!.start).toBe(0);
		expect(next[0]!.clips[2]!.start).toBe(7);
	});

	it('rejects on locked target track', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const tl = [track('v', 'video', [a], { locked: true })];
		const newClip = clip({ id: 'new', sourceId: 'src-2', start: 0, duration: 2, inPoint: 0 });
		expect(insertEdit(tl, ['v'], [{ trackId: 'v', clip: newClip }], 6, [])).toBe(tl);
	});

	it('shifts sync-locked tracks', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 2, inPoint: 0 });
		const s = clip({ id: 's', sourceId: 'src-2', start: 3, duration: 4, inPoint: 0 });
		const tl = [track('v', 'video', [a]), track('a', 'audio', [s], { syncLocked: true })];
		const newClip = clip({ id: 'new', sourceId: 'src-2', start: 0, duration: 2, inPoint: 0 });
		const next = insertEdit(tl, ['v'], [{ trackId: 'v', clip: newClip }], 2, ['a']);
		expect(next[1]!.clips[0]!.start).toBe(5);
	});
});

describe('overwriteEdit', () => {
	it('replaces clips in the overwrite region', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 10, inPoint: 0 });
		const tl = [track('v', 'video', [a])];
		const newClip = clip({ id: 'new', sourceId: 'src-2', start: 0, duration: 3, inPoint: 0 });
		const next = overwriteEdit(tl, ['v'], [{ trackId: 'v', clip: newClip }], 2);
		const clips = next[0]!.clips;
		expect(clips).toHaveLength(3);
		expect(clips[0]!.duration).toBe(2);
		expect(clips[1]!.start).toBe(2);
		expect(clips[1]!.duration).toBe(3);
		expect(clips[2]!.start).toBe(5);
		expect(clips[2]!.inPoint).toBe(5);
	});

	it('does not shift downstream', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const b = clip({ id: 'b', sourceId: 'src-1', start: 10, duration: 3, inPoint: 0 });
		const tl = [track('v', 'video', [a, b])];
		const newClip = clip({ id: 'new', sourceId: 'src-2', start: 0, duration: 3, inPoint: 0 });
		const next = overwriteEdit(tl, ['v'], [{ trackId: 'v', clip: newClip }], 3);
		expect(next[0]!.clips.find((c) => c.id === 'b')!.start).toBe(10);
	});

	it('rejects on locked target track', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const tl = [track('v', 'video', [a], { locked: true })];
		const newClip = clip({ id: 'new', sourceId: 'src-2', start: 0, duration: 2, inPoint: 0 });
		expect(overwriteEdit(tl, ['v'], [{ trackId: 'v', clip: newClip }], 1)).toBe(tl);
	});

	it('clears linkedGroupId on split fragments', () => {
		const a = clip({
			id: 'a',
			sourceId: 'src-1',
			start: 0,
			duration: 10,
			inPoint: 0,
			linkedGroupId: 'g1'
		});
		const tl = [track('v', 'video', [a])];
		const newClip = clip({ id: 'new', sourceId: 'src-2', start: 0, duration: 3, inPoint: 0 });
		const next = overwriteEdit(tl, ['v'], [{ trackId: 'v', clip: newClip }], 3);
		expect(next[0]!.clips[0]!.linkedGroupId).toBeUndefined();
		expect(next[0]!.clips[2]!.linkedGroupId).toBeUndefined();
	});
});

describe('liftRegion', () => {
	it('removes region and leaves gap', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 10, inPoint: 0 });
		const tl = [track('v', 'video', [a])];
		const next = liftRegion(tl, ['v'], 3, 7);
		const clips = next[0]!.clips;
		expect(clips).toHaveLength(2);
		expect(clips[0]!.duration).toBe(3);
		expect(clips[1]!.start).toBe(7);
		expect(clips[1]!.duration).toBe(3);
	});

	it('rejects on locked track', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const tl = [track('v', 'video', [a], { locked: true })];
		expect(liftRegion(tl, ['v'], 1, 3)).toBe(tl);
	});

	it('clears linkedGroupId on split fragments', () => {
		const a = clip({
			id: 'a',
			sourceId: 'src-1',
			start: 0,
			duration: 10,
			inPoint: 0,
			linkedGroupId: 'g1'
		});
		const tl = [track('v', 'video', [a])];
		const next = liftRegion(tl, ['v'], 3, 7);
		expect(next[0]!.clips[0]!.linkedGroupId).toBeUndefined();
		expect(next[0]!.clips[1]!.linkedGroupId).toBeUndefined();
	});
});

describe('extractRegion', () => {
	it('removes region and shifts downstream left', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 10, inPoint: 0 });
		const b = clip({ id: 'b', sourceId: 'src-1', start: 10, duration: 5, inPoint: 10 });
		const tl = [track('v', 'video', [a, b])];
		const next = extractRegion(tl, ['v'], 3, 7, []);
		const clips = next[0]!.clips;
		expect(clips).toHaveLength(3);
		expect(clips[0]!.duration).toBe(3);
		expect(clips[1]!.start).toBe(3);
		expect(clips[2]!.start).toBe(6);
	});

	it('rejects on locked track', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const tl = [track('v', 'video', [a], { locked: true })];
		expect(extractRegion(tl, ['v'], 1, 3, [])).toBe(tl);
	});

	it('shifts sync-locked tracks', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 10, inPoint: 0 });
		const s = clip({ id: 's', sourceId: 'src-2', start: 5, duration: 5, inPoint: 0 });
		const tl = [track('v', 'video', [a]), track('a', 'audio', [s], { syncLocked: true })];
		const next = extractRegion(tl, ['v'], 2, 5, ['a']);
		expect(next[1]!.clips[0]!.start).toBe(2);
	});

	it('rejects when sync-locked clip spans the extraction point', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 10, inPoint: 0 });
		const s = clip({ id: 's', sourceId: 'src-2', start: 2, duration: 8, inPoint: 0 });
		const tl = [track('v', 'video', [a]), track('a', 'audio', [s], { syncLocked: true })];
		expect(extractRegion(tl, ['v'], 3, 6, ['a'])).toBe(tl);
	});
});

describe('rippleDelete cumulative shifts', () => {
	it('correctly shifts clips between non-contiguous removed regions', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const b = clip({ id: 'b', sourceId: 'src-1', start: 5, duration: 5, inPoint: 5 });
		const c = clip({ id: 'c', sourceId: 'src-1', start: 10, duration: 5, inPoint: 10 });
		const d = clip({ id: 'd', sourceId: 'src-1', start: 15, duration: 5, inPoint: 15 });
		const tl = [track('v', 'video', [a, b, c, d])];
		// Remove a (0-5) and c (10-15): b (5-10) should shift by 5, d (15-20) should shift by 10
		const next = rippleDelete(
			tl,
			[
				{ trackId: 'v', clipId: 'a' },
				{ trackId: 'v', clipId: 'c' }
			],
			[]
		);
		expect(next[0]!.clips).toHaveLength(2);
		expect(next[0]!.clips[0]!.id).toBe('b');
		expect(next[0]!.clips[0]!.start).toBe(0);
		expect(next[0]!.clips[1]!.id).toBe('d');
		expect(next[0]!.clips[1]!.start).toBe(5);
	});
});

describe('sync-lock spanning rejection', () => {
	it('rippleTrim rejects when sync-locked clip spans the ripple point', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 10, inPoint: 0 });
		const s = clip({ id: 's', sourceId: 'src-2', start: 3, duration: 8, inPoint: 0 });
		const tl = [track('v', 'video', [a]), track('a', 'audio', [s], { syncLocked: true })];
		expect(rippleTrim(tl, 'v', 'a', 'out', 5, ['a'])).toBe(tl);
	});

	it('insertEdit rejects when sync-locked clip spans the insert point', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 3, inPoint: 0 });
		const s = clip({ id: 's', sourceId: 'src-2', start: 0, duration: 10, inPoint: 0 });
		const tl = [track('v', 'video', [a]), track('a', 'audio', [s], { syncLocked: true })];
		const newClip = clip({ id: 'new', sourceId: 'src-2', start: 0, duration: 2, inPoint: 0 });
		expect(insertEdit(tl, ['v'], [{ trackId: 'v', clip: newClip }], 3, ['a'])).toBe(tl);
	});

	it('rippleDelete rejects when sync-locked clip spans the ripple point', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 5, duration: 5, inPoint: 0 });
		const b = clip({ id: 'b', sourceId: 'src-1', start: 10, duration: 5, inPoint: 5 });
		const s = clip({ id: 's', sourceId: 'src-2', start: 3, duration: 8, inPoint: 0 });
		const tl = [track('v', 'video', [a, b]), track('a', 'audio', [s], { syncLocked: true })];
		// Clip s [3-11] spans the ripple point at 5 (start of deleted clip a)
		expect(rippleDelete(tl, [{ trackId: 'v', clipId: 'a' }], ['a'])).toBe(tl);
	});
});

describe('split unlinks linked clips', () => {
	it('clears linkedGroupId on both halves after split', () => {
		const a = clip({
			id: 'a',
			sourceId: 'src-1',
			start: 0,
			duration: 10,
			inPoint: 0,
			linkedGroupId: 'g1'
		});
		const b = clip({
			id: 'b',
			sourceId: 'src-1',
			start: 0,
			duration: 10,
			inPoint: 0,
			linkedGroupId: 'g1'
		});
		const tl = [track('v', 'video', [a]), track('a', 'audio', [b])];
		const next = splitClipAt(tl, 'v', 5);
		expect(next[0]!.clips[0]!.linkedGroupId).toBeUndefined();
		expect(next[0]!.clips[1]!.linkedGroupId).toBeUndefined();
		// Audio track is unaffected by the split
		expect(next[1]!.clips[0]!.linkedGroupId).toBe('g1');
	});
});

describe('removeMarkersInRange', () => {
	it('removes markers inside the range', () => {
		const m: TimelineMarker[] = [
			{ id: 'm1', time: 2, label: 'A' },
			{ id: 'm2', time: 5, label: 'B' },
			{ id: 'm3', time: 8, label: 'C' }
		];
		const result = removeMarkersInRange(m, 3, 7);
		expect(result).toHaveLength(2);
		expect(result[0]!.id).toBe('m1');
		expect(result[1]!.id).toBe('m3');
	});

	it('returns original array when nothing removed', () => {
		const m: TimelineMarker[] = [{ id: 'm1', time: 2, label: 'A' }];
		expect(removeMarkersInRange(m, 5, 10)).toBe(m);
	});

	it('preserves markers at the exclusive end boundary', () => {
		const m: TimelineMarker[] = [
			{ id: 'm1', time: 5, label: 'At start' },
			{ id: 'm2', time: 10, label: 'At end' },
			{ id: 'm3', time: 7, label: 'Inside' }
		];
		const result = removeMarkersInRange(m, 5, 10);
		expect(result).toHaveLength(1);
		expect(result[0]!.id).toBe('m2');
	});
});

describe('review fixes', () => {
	it('rippleTrim in-edge closes gap by shifting trimmed clip and downstream left', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 10, inPoint: 0 });
		const b = clip({ id: 'b', sourceId: 'src-1', start: 10, duration: 5, inPoint: 0 });
		const c = clip({ id: 'c', sourceId: 'src-1', start: 15, duration: 5, inPoint: 0 });
		const tl = [track('v', 'video', [a, b, c])];
		const next = rippleTrim(tl, 'v', 'a', 'in', 3, []);
		expect(next[0]!.clips[0]!.start).toBe(0);
		expect(next[0]!.clips[0]!.duration).toBe(7);
		expect(next[0]!.clips[0]!.inPoint).toBe(3);
		expect(next[0]!.clips[1]!.start).toBe(7);
		expect(next[0]!.clips[2]!.start).toBe(12);
	});

	it('rippleTrim in-edge on sync-locked track shifts in tandem', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 10, inPoint: 0 });
		const b = clip({ id: 'b', sourceId: 'src-1', start: 10, duration: 5, inPoint: 0 });
		const s = clip({ id: 's', sourceId: 'src-1', start: 5, duration: 5, inPoint: 0 });
		const tl = [track('v', 'video', [a, b]), track('a', 'audio', [s], { syncLocked: true })];
		const next = rippleTrim(tl, 'v', 'a', 'in', 4, ['a']);
		expect(next[0]!.clips[0]!.start).toBe(0);
		expect(next[0]!.clips[0]!.inPoint).toBe(4);
		expect(next[0]!.clips[1]!.start).toBe(6);
		expect(next[1]!.clips[0]!.start).toBe(1);
	});

	it('duplicateClips clears linkedGroupId on clones', () => {
		const a = clip({
			id: 'a',
			sourceId: 'src-1',
			start: 0,
			duration: 5,
			inPoint: 0,
			linkedGroupId: 'g1'
		});
		const b = clip({
			id: 'b',
			sourceId: 'src-1',
			start: 0,
			duration: 5,
			inPoint: 0,
			linkedGroupId: 'g1'
		});
		const tl = [track('v', 'video', [a]), track('a', 'audio', [b])];
		const next = duplicateClips(tl, [{ trackId: 'v', clipId: 'a' }], 5);
		const dupe = next[0]!.clips[1]!;
		expect(dupe.linkedGroupId).toBeUndefined();
		expect(next[0]!.clips[0]!.linkedGroupId).toBe('g1');
	});

	it('insertEdit computes duration from targeted tracks only', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 });
		const tl = [track('v', 'video', [a]), track('a', 'audio', [])];
		const insertClips = [
			{
				trackId: 'v',
				clip: clip({ id: 'x', sourceId: 'src-1', start: 0, duration: 2, inPoint: 0 })
			},
			{
				trackId: 'a',
				clip: clip({ id: 'y', sourceId: 'src-1', start: 0, duration: 10, inPoint: 0 })
			}
		];
		// Only 'v' is targeted — insert duration should be 2, not 10
		const next = insertEdit(tl, ['v'], insertClips, 0, []);
		expect(next[0]!.clips[1]!.start).toBe(2);
	});

	it('extractRegion rejects when contained sync-locked clip overlaps range', () => {
		const a = clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 10, inPoint: 0 });
		const s = clip({ id: 's', sourceId: 'src-1', start: 3, duration: 2, inPoint: 0 });
		const tl = [track('v', 'video', [a]), track('a', 'audio', [s], { syncLocked: true })];
		// Sync-locked clip [3,5] is wholly inside extract range [2,8] — must reject
		const next = extractRegion(tl, ['v'], 2, 8, ['a']);
		expect(next).toBe(tl);
	});

	it('overwriteEdit rebases keyframes on right fragment', () => {
		const kf = {
			brightness: [
				{ t: 0, value: 0, easing: 'linear' as const },
				{ t: 5, value: 1, easing: 'linear' as const },
				{ t: 10, value: 0.5, easing: 'linear' as const }
			]
		};
		const a = clip({
			id: 'a',
			sourceId: 'src-1',
			start: 0,
			duration: 10,
			inPoint: 0,
			keyframes: kf
		});
		const tl = [track('v', 'video', [a])];
		const overClip = clip({ id: 'x', sourceId: 'src-2', start: 0, duration: 4, inPoint: 0 });
		// Overwrite [3, 7]: clip a splits into left [0,3] and right [7,10]
		const next = overwriteEdit(tl, ['v'], [{ trackId: 'v', clip: overClip }], 3);
		const clips = next[0]!.clips;
		expect(clips).toHaveLength(3);
		const rightFrag = clips[2]!;
		expect(rightFrag.start).toBe(7);
		expect(rightFrag.duration).toBe(3);
		// Right fragment keyframes should be rebased: original t=7 maps to local t=0
		if (rightFrag.keyframes?.brightness) {
			expect(rightFrag.keyframes.brightness[0]!.t).toBe(0);
		}
	});

	it('pasteClips clears linkedGroupId on pasted clips', () => {
		const a = clip({
			id: 'a',
			sourceId: 'src-1',
			start: 0,
			duration: 5,
			inPoint: 0,
			linkedGroupId: 'g1'
		});
		const tl = [track('v', 'video', [])];
		const pasted = [{ trackId: 'v', clip: a }];
		const next = pasteClips(tl, pasted, 0);
		expect(next[0]!.clips[0]!.linkedGroupId).toBeUndefined();
	});

	it('rippleTrim in-edge outward extension does not shift downstream', () => {
		// Clip a starts at 2 with inPoint 2 — extend head left to 0 (outward extension)
		const a = clip({ id: 'a', sourceId: 'src-1', start: 2, duration: 5, inPoint: 2 });
		const b = clip({ id: 'b', sourceId: 'src-1', start: 7, duration: 3, inPoint: 0 });
		const tl = [track('v', 'video', [a, b])];
		const next = rippleTrim(tl, 'v', 'a', 'in', 0, []);
		// Out-edge didn't change: downstream clip b stays at 7
		expect(next[0]!.clips[0]!.start).toBe(0);
		expect(next[0]!.clips[0]!.duration).toBe(7);
		expect(next[0]!.clips[0]!.inPoint).toBe(0);
		expect(next[0]!.clips[1]!.start).toBe(7);
	});

	it('liftRegion rebases keyframes on split fragments', () => {
		const kf = {
			brightness: [
				{ t: 0, value: 0, easing: 'linear' as const },
				{ t: 10, value: 1, easing: 'linear' as const }
			]
		};
		const a = clip({
			id: 'a',
			sourceId: 'src-1',
			start: 0,
			duration: 10,
			inPoint: 0,
			keyframes: kf
		});
		const tl = [track('v', 'video', [a])];
		// Lift [3, 7]: left fragment [0,3], right fragment [7,10]
		const next = liftRegion(tl, ['v'], 3, 7);
		const leftFrag = next[0]!.clips[0]!;
		const rightFrag = next[0]!.clips[1]!;
		expect(leftFrag.duration).toBe(3);
		expect(rightFrag.start).toBe(7);
		expect(rightFrag.duration).toBe(3);
		// Right fragment keyframes rebased: original t=7 maps to local t=0
		if (rightFrag.keyframes?.brightness) {
			expect(rightFrag.keyframes.brightness[0]!.t).toBe(0);
		}
	});
});
