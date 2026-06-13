import { serializeProject, type ProjectDoc, type SourceDescriptor } from '../project';
import { DEFAULT_TITLE_STYLE } from '../title';
import {
	DEFAULT_TRACK_MIX,
	type Timeline,
	type TimelineClip,
	type TimelineMarker,
	type TimelineTransition
} from '../timeline';

/**
 * In-memory `ProjectDoc` builders shared by the interchange unit tests and
 * the golden-fixture tests (R11.2/R11.3). No media bytes are involved —
 * interchange only reads the timeline model.
 */

const FIXTURE_SAVED_AT = new Date('2026-01-01T00:00:00.000Z');

export const FIXTURE_FINGERPRINT_DIGEST = 'a1b2c3d4'.repeat(8);

function clipFixture(input: {
	id: string;
	sourceId: string;
	start: number;
	duration: number;
	inPoint: number;
}): TimelineClip {
	return {
		...input,
		effects: {
			brightness: 0,
			contrast: 0,
			saturation: 1,
			temperature: 0,
			temperatureStrength: 0,
			lutStrength: 0,
			skinSmoothStrength: 0
		},
		transform: {
			x: 0,
			y: 0,
			scale: 1,
			rotation: 0,
			opacity: 1,
			anchorX: 0.5,
			anchorY: 0.5,
			fit: 'fill'
		},
		audioFadeIn: 0,
		audioFadeOut: 0
	};
}

function titleClipFixture(input: {
	id: string;
	start: number;
	duration: number;
	text: string;
}): TimelineClip {
	return {
		...clipFixture({
			id: input.id,
			sourceId: '',
			start: input.start,
			duration: input.duration,
			inPoint: 0
		}),
		kind: 'title',
		title: { text: input.text, style: { ...DEFAULT_TITLE_STYLE } }
	};
}

function sourceFixture(input: {
	sourceId: string;
	fileName: string;
	durationS: number;
	withFingerprint?: boolean;
}): SourceDescriptor {
	return {
		sourceId: input.sourceId,
		fileName: input.fileName,
		kind: 'video',
		byteSize: 1024,
		durationS: input.durationS,
		mimeType: 'video/mp4',
		fingerprint: input.withFingerprint
			? { algorithm: 'sha-256', digest: FIXTURE_FINGERPRINT_DIGEST }
			: undefined,
		video: { width: 1920, height: 1080, frameRate: 30, codec: 'avc1.640028', canDecode: true },
		audio: { channels: 2, sampleRate: 48000, codec: 'mp4a.40.2', canDecode: true }
	};
}

/**
 * Two video tracks (gap + title on V2), one audio track, a cross-dissolve at
 * the V1 cut, and three markers. One source carries a P23 fingerprint.
 */
export function buildMultiTrackFixtureDoc(): ProjectDoc {
	const timeline: Timeline = [
		{
			id: 'track-v1',
			type: 'video',
			...DEFAULT_TRACK_MIX,
			clips: [
				clipFixture({ id: 'clip-1', sourceId: 'source-a', start: 0, duration: 4, inPoint: 1 }),
				clipFixture({ id: 'clip-2', sourceId: 'source-b', start: 4, duration: 3, inPoint: 0.5 })
			]
		},
		{
			id: 'track-v2',
			type: 'video',
			...DEFAULT_TRACK_MIX,
			clips: [titleClipFixture({ id: 'clip-title', start: 2, duration: 3, text: 'Opening' })]
		},
		{
			id: 'track-a1',
			type: 'audio',
			...DEFAULT_TRACK_MIX,
			clips: [
				clipFixture({ id: 'clip-3', sourceId: 'source-a', start: 0.5, duration: 6, inPoint: 0 })
			]
		}
	];
	const transitions: TimelineTransition[] = [
		{
			id: 'transition-1',
			trackId: 'track-v1',
			fromClipId: 'clip-1',
			toClipId: 'clip-2',
			durationS: 1,
			kind: 'cross-dissolve',
			params: {}
		}
	];
	const markers: TimelineMarker[] = [
		{ id: 'marker-1', time: 0, label: 'Start' },
		{ id: 'marker-2', time: 3.5, label: 'Scene 2' },
		{ id: 'marker-3', time: 7, label: 'End' }
	];
	return serializeProject({
		projectId: 'fixture-multi-track',
		timeline,
		transitions,
		markers,
		sources: [
			sourceFixture({
				sourceId: 'source-a',
				fileName: 'beach.mp4',
				durationS: 10,
				withFingerprint: true
			}),
			sourceFixture({ sourceId: 'source-b', fileName: 'dunes.mp4', durationS: 8 })
		],
		masterGain: 1,
		savedAt: FIXTURE_SAVED_AT
	});
}

/**
 * A clip referencing an unknown source, a clip that collapses to zero frames
 * at 30 fps, and a transition touching the collapsed clip — the omission
 * paths of R2.4/R3.3/R5.4.
 */
export function buildMissingSourceFixtureDoc(): ProjectDoc {
	const timeline: Timeline = [
		{
			id: 'track-v1',
			type: 'video',
			...DEFAULT_TRACK_MIX,
			clips: [
				clipFixture({
					id: 'clip-ghost',
					sourceId: 'source-ghost',
					start: 0,
					duration: 2,
					inPoint: 0
				}),
				clipFixture({
					id: 'clip-tiny',
					sourceId: 'source-ghost',
					start: 2,
					duration: 0.005,
					inPoint: 0
				}),
				clipFixture({
					id: 'clip-after',
					sourceId: 'source-ghost',
					start: 3,
					duration: 1,
					inPoint: 0
				})
			]
		}
	];
	const transitions: TimelineTransition[] = [
		{
			id: 'transition-dropped',
			trackId: 'track-v1',
			fromClipId: 'clip-tiny',
			toClipId: 'clip-after',
			durationS: 0.5,
			kind: 'wipe',
			params: { direction: 'left' }
		}
	];
	return serializeProject({
		projectId: 'fixture-missing-source',
		timeline,
		transitions,
		markers: [],
		sources: [],
		masterGain: 1,
		savedAt: FIXTURE_SAVED_AT
	});
}
