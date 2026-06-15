import { describe, expect, it } from 'vite-plus/test';
import {
	buildMissingSourceFixtureDoc,
	buildMultiTrackFixtureDoc,
	FIXTURE_FINGERPRINT_DIGEST
} from './fixture-docs';
import {
	serializeTimelineToOtio,
	type OtioClip,
	type OtioTimeline,
	type OtioTrack,
	type OtioTransition
} from './otio';
import { validateOtioDocument } from './otio-validate';

const OPTIONS = { displayName: 'Fixture Project', appVersion: '0.1.0' };

function parse(text: string): OtioTimeline {
	return JSON.parse(text) as OtioTimeline;
}

function trackChildren(timeline: OtioTimeline, index: number): OtioTrack['children'] {
	return timeline.tracks.children[index]!.children;
}

describe('serializeTimelineToOtio structure', () => {
	it('maps tracks in compositing order with Video/Audio kinds and mix metadata', () => {
		const { text, warnings } = serializeTimelineToOtio(buildMultiTrackFixtureDoc(), OPTIONS);
		expect(warnings).toEqual([]);
		const timeline = parse(text);
		expect(timeline.OTIO_SCHEMA).toBe('Timeline.1');
		expect(timeline.name).toBe('Fixture Project');
		const tracks = timeline.tracks.children;
		expect(tracks.map((track) => track.kind)).toEqual(['Video', 'Video', 'Audio']);
		expect(tracks.map((track) => track.name)).toEqual(['V1', 'V2', 'A1']);
		const mix = tracks[0]!.metadata.localcut as Record<string, unknown>;
		expect(mix.trackId).toBe('track-v1');
		expect(mix.gain).toBe(1);
		expect(mix.muted).toBe(false);
	});

	it('emits explicit gaps so record timing is preserved', () => {
		const timeline = parse(serializeTimelineToOtio(buildMultiTrackFixtureDoc(), OPTIONS).text);
		const v2 = trackChildren(timeline, 1);
		expect(v2[0]!.OTIO_SCHEMA).toBe('Gap.1');
		const gap = v2[0]! as Extract<(typeof v2)[number], { OTIO_SCHEMA: 'Gap.1' }>;
		expect(gap.source_range.duration.value).toBe(60); // 2 s at 30 fps
		expect(v2[1]!.OTIO_SCHEMA).toBe('Clip.2');
	});

	it('derives source_range from inPoint/duration at the sequence rate', () => {
		const timeline = parse(serializeTimelineToOtio(buildMultiTrackFixtureDoc(), OPTIONS).text);
		const clip = trackChildren(timeline, 0)[0] as OtioClip;
		expect(clip.name).toBe('beach.mp4');
		expect(clip.source_range.start_time.value).toBe(30); // inPoint 1 s
		expect(clip.source_range.duration.value).toBe(120); // 4 s
		expect(clip.source_range.duration.rate).toBe(30);
	});

	it('carries P23 fingerprints and sourceIds in external reference metadata', () => {
		const timeline = parse(serializeTimelineToOtio(buildMultiTrackFixtureDoc(), OPTIONS).text);
		const clip = trackChildren(timeline, 0)[0] as OtioClip;
		const ref = clip.media_references[clip.active_media_reference_key]!;
		expect(ref.OTIO_SCHEMA).toBe('ExternalReference.1');
		if (ref.OTIO_SCHEMA !== 'ExternalReference.1') return;
		expect(ref.target_url).toBe('beach.mp4');
		const localcut = ref.metadata.localcut as Record<string, unknown>;
		expect(localcut.sourceId).toBe('source-a');
		expect(localcut.fingerprint).toEqual({
			algorithm: 'sha-256',
			digest: FIXTURE_FINGERPRINT_DIGEST
		});
	});

	it('uses resolveTargetUrl for bundle-relative paths', () => {
		const { text } = serializeTimelineToOtio(buildMultiTrackFixtureDoc(), {
			...OPTIONS,
			resolveTargetUrl: (sourceId) => (sourceId === 'source-a' ? 'media/abc_beach.mp4' : null)
		});
		const clip = trackChildren(parse(text), 0)[0] as OtioClip;
		const ref = clip.media_references[clip.active_media_reference_key]!;
		if (ref.OTIO_SCHEMA !== 'ExternalReference.1') throw new Error('expected external ref');
		expect(ref.target_url).toBe('media/abc_beach.mp4');
	});

	it('maps title clips to a localcut generator reference with title metadata', () => {
		const timeline = parse(serializeTimelineToOtio(buildMultiTrackFixtureDoc(), OPTIONS).text);
		const clip = trackChildren(timeline, 1)[1] as OtioClip;
		expect(clip.name).toBe('Opening');
		const ref = clip.media_references[clip.active_media_reference_key]!;
		expect(ref.OTIO_SCHEMA).toBe('GeneratorReference.1');
		if (ref.OTIO_SCHEMA !== 'GeneratorReference.1') return;
		expect(ref.generator_kind).toBe('localcut.title');
		const localcut = clip.metadata.localcut as Record<string, unknown>;
		expect((localcut.title as { text: string }).text).toBe('Opening');
	});

	it('attaches frame-snapped global markers to the top-level stack', () => {
		const timeline = parse(serializeTimelineToOtio(buildMultiTrackFixtureDoc(), OPTIONS).text);
		const markers = timeline.tracks.markers;
		expect(markers.map((marker) => marker.name)).toEqual(['Start', 'Scene 2', 'End']);
		expect(markers[1]!.marked_range.start_time.value).toBe(105); // 3.5 s at 30 fps
		expect(markers[1]!.marked_range.duration.value).toBe(0);
		expect(markers[1]!.color).toBe('PURPLE');
		expect((markers[1]!.metadata.localcut as Record<string, unknown>).markerId).toBe('marker-2');
	});

	it('places the dissolve between the clips with offsets summing to the snapped total', () => {
		const timeline = parse(serializeTimelineToOtio(buildMultiTrackFixtureDoc(), OPTIONS).text);
		const v1 = trackChildren(timeline, 0);
		expect(v1.map((child) => child.OTIO_SCHEMA)).toEqual(['Clip.2', 'Transition.1', 'Clip.2']);
		const transition = v1[1] as OtioTransition;
		expect(transition.transition_type).toBe('SMPTE_Dissolve');
		expect(transition.in_offset.value + transition.out_offset.value).toBe(30); // 1 s
		const localcut = transition.metadata.localcut as { transition: Record<string, unknown> };
		expect(localcut.transition.kind).toBe('cross-dissolve');
	});

	it('splits odd snapped transition totals without gaining a frame', () => {
		const doc = buildMultiTrackFixtureDoc();
		doc.transitions[0]!.durationS = 0.5; // 15 frames at 30 fps
		const timeline = parse(serializeTimelineToOtio(doc, OPTIONS).text);
		const transition = trackChildren(timeline, 0)[1] as OtioTransition;
		expect(transition.in_offset.value).toBe(7);
		expect(transition.out_offset.value).toBe(8);
	});

	it('keeps everything LocalCut-specific under metadata.localcut', () => {
		const timeline = parse(serializeTimelineToOtio(buildMultiTrackFixtureDoc(), OPTIONS).text);
		const top = timeline.metadata.localcut as Record<string, unknown>;
		expect(top.projectId).toBe('fixture-multi-track');
		expect(top.masterGain).toBe(1);
		expect(top.appVersion).toBe('0.1.0');
		expect(Array.isArray(top.captionTracks)).toBe(true);
		const clip = trackChildren(timeline, 0)[0] as OtioClip;
		const clipMeta = clip.metadata.localcut as Record<string, unknown>;
		expect(clipMeta.clipId).toBe('clip-1');
		expect(clipMeta.effects).toBeDefined();
		expect(clipMeta.transform).toBeDefined();
		expect(clipMeta.audioFadeIn).toBe(0);
	});

	it('preserves time-remap metadata in LocalCut clip metadata', () => {
		const doc = buildMultiTrackFixtureDoc();
		doc.timeline[0]!.clips[0]!.timeRemap = {
			keyframes: [
				{ outTimeS: 0, speed: 1, easing: 'linear' },
				{ outTimeS: 2, speed: 0.5, easing: 'ease' }
			],
			pitchPreserve: true,
			sourceDurationS: 4
		};
		const timeline = parse(serializeTimelineToOtio(doc, OPTIONS).text);
		const clip = trackChildren(timeline, 0)[0] as OtioClip;
		const clipMeta = clip.metadata.localcut as Record<string, unknown>;

		expect(clipMeta.timeRemap).toEqual(doc.timeline[0]!.clips[0]!.timeRemap);
	});
});

describe('serializeTimelineToOtio omission paths', () => {
	it('emits missing references for unknown sources with a warning', () => {
		const { text, warnings } = serializeTimelineToOtio(buildMissingSourceFixtureDoc(), OPTIONS);
		const clip = trackChildren(parse(text), 0)[0] as OtioClip;
		const ref = clip.media_references[clip.active_media_reference_key]!;
		expect(ref.OTIO_SCHEMA).toBe('MissingReference.1');
		expect((ref.metadata.localcut as Record<string, unknown>).sourceId).toBe('source-ghost');
		expect(warnings.some((warning) => warning.includes('unknown source'))).toBe(true);
	});

	it('drops zero-frame clips and transitions that touch them, with warnings', () => {
		const { text, warnings } = serializeTimelineToOtio(buildMissingSourceFixtureDoc(), OPTIONS);
		const children = trackChildren(parse(text), 0);
		expect(children.some((child) => child.OTIO_SCHEMA === 'Transition.1')).toBe(false);
		// clip-tiny collapses; clip-ghost and clip-after survive with a gap between.
		expect(children.filter((child) => child.OTIO_SCHEMA === 'Clip.2')).toHaveLength(2);
		expect(warnings.some((warning) => warning.includes('zero frames'))).toBe(true);
		expect(warnings.some((warning) => warning.includes('dropped clip'))).toBe(true);
	});
});

describe('serializeTimelineToOtio determinism', () => {
	it('is byte-identical across repeated serialisations', () => {
		const doc = buildMultiTrackFixtureDoc();
		expect(serializeTimelineToOtio(doc, OPTIONS).text).toBe(
			serializeTimelineToOtio(doc, OPTIONS).text
		);
	});

	it('differs only via savedAt when savedAt changes', () => {
		const a = buildMultiTrackFixtureDoc();
		const b = { ...buildMultiTrackFixtureDoc(), savedAt: '2026-02-02T00:00:00.000Z' };
		const textA = serializeTimelineToOtio(a, OPTIONS).text;
		const textB = serializeTimelineToOtio(b, OPTIONS).text;
		expect(textA).not.toBe(textB);
		expect(textA.replace(a.savedAt, '')).toBe(textB.replace(b.savedAt, ''));
	});
});

describe('validateOtioDocument', () => {
	it('accepts serialiser output', () => {
		for (const doc of [buildMultiTrackFixtureDoc(), buildMissingSourceFixtureDoc()]) {
			const { text } = serializeTimelineToOtio(doc, OPTIONS);
			expect(validateOtioDocument(JSON.parse(text))).toEqual([]);
		}
	});

	it('rejects unknown schema tags', () => {
		const timeline = parse(serializeTimelineToOtio(buildMultiTrackFixtureDoc(), OPTIONS).text);
		(trackChildren(timeline, 0)[0] as { OTIO_SCHEMA: string }).OTIO_SCHEMA = 'Clip.99';
		const issues = validateOtioDocument(timeline);
		expect(issues.some((item) => item.message.includes('Clip.99'))).toBe(true);
	});

	it('rejects missing required fields', () => {
		const timeline = parse(serializeTimelineToOtio(buildMultiTrackFixtureDoc(), OPTIONS).text);
		delete (trackChildren(timeline, 0)[0] as Partial<OtioClip>).source_range;
		const issues = validateOtioDocument(timeline);
		expect(issues.some((item) => item.message.includes('source_range'))).toBe(true);
	});

	it('rejects negative times', () => {
		const timeline = parse(serializeTimelineToOtio(buildMultiTrackFixtureDoc(), OPTIONS).text);
		(trackChildren(timeline, 0)[0] as OtioClip).source_range.duration.value = -1;
		const issues = validateOtioDocument(timeline);
		expect(issues.some((item) => item.message.includes('non-negative'))).toBe(true);
	});

	it('rejects a non-Timeline root', () => {
		expect(validateOtioDocument({ OTIO_SCHEMA: 'Stack.1' })).not.toEqual([]);
	});
});
