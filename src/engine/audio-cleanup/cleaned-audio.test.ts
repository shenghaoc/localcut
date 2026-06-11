import { describe, expect, it } from 'vite-plus/test';
import {
	cleanedAudioCoversClip,
	cleanedAudioMissing,
	cleanedAudioSubstitute
} from './cleaned-audio';
import { defaultTimelineClip, setClipCleanedAudio, type Timeline } from '../timeline';
import { DEFAULT_TRACK_MIX } from '../timeline';

const REF = {
	assetId: 'cleaned-1',
	clipInPointS: 2,
	durationS: 5,
	modelId: 'rnnoise',
	modelVersion: 'test'
};

function clipWithCleanup(overrides: Partial<Parameters<typeof defaultTimelineClip>[0]> = {}) {
	return {
		...defaultTimelineClip({
			id: 'clip-1',
			sourceId: 'original',
			start: 0,
			duration: 5,
			inPoint: 2,
			...overrides
		}),
		cleanedAudio: { ...REF }
	};
}

function handles(ids: string[]): Map<string, { audioSource: object | null }> {
	return new Map(ids.map((id) => [id, { audioSource: {} }]));
}

describe('cleanedAudioSubstitute', () => {
	it('returns null for clips without cleanup (normal path untouched)', () => {
		const clip = defaultTimelineClip({
			id: 'c',
			sourceId: 'original',
			start: 0,
			duration: 5,
			inPoint: 0
		});
		expect(cleanedAudioSubstitute(clip, handles(['original', 'cleaned-1']))).toBeNull();
	});

	it('substitutes the derived asset with a remapped in-point', () => {
		const clip = clipWithCleanup();
		const result = cleanedAudioSubstitute(clip, handles(['original', 'cleaned-1']));
		expect(result).not.toBeNull();
		expect(result!.clip.sourceId).toBe('cleaned-1');
		expect(result!.clip.inPoint).toBe(0); // clip.inPoint 2 − ref.clipInPointS 2
		expect(result!.clip.start).toBe(clip.start);
		expect(result!.clip.duration).toBe(clip.duration);
	});

	it('remaps a forward-trimmed clip into the cleaned range', () => {
		const clip = clipWithCleanup({ inPoint: 4, duration: 3 });
		const result = cleanedAudioSubstitute(clip, handles(['cleaned-1']));
		expect(result!.clip.inPoint).toBe(2);
	});

	it('falls back to original audio when the derived asset is missing', () => {
		const clip = clipWithCleanup();
		expect(cleanedAudioSubstitute(clip, handles(['original']))).toBeNull();
		expect(cleanedAudioMissing(clip, handles(['original']))).toBe(true);
		expect(cleanedAudioMissing(clip, handles(['original', 'cleaned-1']))).toBe(false);
	});

	it('falls back when the asset has no decodable audio', () => {
		const clip = clipWithCleanup();
		const sources = new Map([['cleaned-1', { audioSource: null }]]);
		expect(cleanedAudioSubstitute(clip, sources)).toBeNull();
		expect(cleanedAudioMissing(clip, sources)).toBe(true);
	});

	it('treats a retrim past the cleaned range as stale and plays the original', () => {
		// Cleaned range covers source [2, 7); retrimming to [1, 6) leaves the
		// head uncovered, so the whole clip reverts to original audio.
		const clip = clipWithCleanup({ inPoint: 1 });
		expect(cleanedAudioCoversClip(clip)).toBe(false);
		expect(cleanedAudioSubstitute(clip, handles(['cleaned-1']))).toBeNull();
		// Trimming the tail later than covered also reverts.
		const tail = clipWithCleanup({ inPoint: 3, duration: 5 });
		expect(cleanedAudioCoversClip(tail)).toBe(false);
		// A retrim inside the covered range keeps the cleaned audio.
		const inside = clipWithCleanup({ inPoint: 3, duration: 2 });
		expect(cleanedAudioCoversClip(inside)).toBe(true);
	});
});

describe('setClipCleanedAudio', () => {
	function timelineWith(clip = clipWithCleanup()): Timeline {
		return [{ id: 'track-1', type: 'audio', clips: [clip], ...DEFAULT_TRACK_MIX }];
	}

	it('sets and clears the reference immutably', () => {
		const base: Timeline = [
			{
				id: 'track-1',
				type: 'audio',
				clips: [
					defaultTimelineClip({ id: 'clip-1', sourceId: 's', start: 0, duration: 5, inPoint: 0 })
				],
				...DEFAULT_TRACK_MIX
			}
		];
		const withRef = setClipCleanedAudio(base, 'track-1', 'clip-1', REF);
		expect(withRef).not.toBe(base);
		expect(base[0]!.clips[0]!.cleanedAudio).toBeUndefined();
		expect(withRef[0]!.clips[0]!.cleanedAudio).toEqual(REF);
		// Stored ref is a copy, not the caller's object.
		expect(withRef[0]!.clips[0]!.cleanedAudio).not.toBe(REF);

		const cleared = setClipCleanedAudio(withRef, 'track-1', 'clip-1', null);
		expect(cleared[0]!.clips[0]!.cleanedAudio).toBeUndefined();
		expect(withRef[0]!.clips[0]!.cleanedAudio).toEqual(REF);
	});

	it('is a no-op (same reference) when nothing changes — keeps undo history clean', () => {
		const base = timelineWith();
		expect(setClipCleanedAudio(base, 'track-1', 'clip-1', { ...REF })).toBe(base);
		const noRef = setClipCleanedAudio(base, 'track-1', 'missing', null);
		expect(noRef).toBe(base);
	});

	it('rejects title clips', () => {
		const title = {
			...defaultTimelineClip({ id: 't', sourceId: '', start: 0, duration: 2, inPoint: 0 }),
			kind: 'title' as const
		};
		const base: Timeline = [{ id: 'track-1', type: 'video', clips: [title], ...DEFAULT_TRACK_MIX }];
		expect(setClipCleanedAudio(base, 'track-1', 't', REF)).toBe(base);
	});
});
