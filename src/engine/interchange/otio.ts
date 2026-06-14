import type { ProjectDoc, SourceDescriptor } from '../project';
import type { TimelineClip, TimelineTrack, TimelineTransition } from '../timeline';
import { compareStrings, interchangeRate, snapToFrames } from './time';

/**
 * OpenTimelineIO serialized-JSON emitter (Phase 48).
 *
 * Emits only the schema versions in {@link OTIO_SCHEMA_ALLOWLIST} — the set
 * written by OpenTimelineIO >= 0.15 and read by Kdenlive 25.04+ and current
 * DaVinci Resolve. Everything LocalCut-specific nests under a
 * `metadata.localcut` namespace so foreign tools ignore it and a future OTIO
 * import phase can round-trip it. Output is a pure, deterministic function of
 * the `ProjectDoc`: no `Date.now()`, no generated IDs.
 */

export const OTIO_SCHEMA_ALLOWLIST = [
	'Timeline.1',
	'Stack.1',
	'Track.1',
	'Clip.2',
	'Gap.1',
	'Transition.1',
	'Marker.2',
	'ExternalReference.1',
	'GeneratorReference.1',
	'MissingReference.1',
	'RationalTime.1',
	'TimeRange.1'
] as const;

export type OtioMetadata = Record<string, unknown>;

export interface OtioRationalTime {
	OTIO_SCHEMA: 'RationalTime.1';
	rate: number;
	value: number;
}

export interface OtioTimeRange {
	OTIO_SCHEMA: 'TimeRange.1';
	duration: OtioRationalTime;
	start_time: OtioRationalTime;
}

export interface OtioMarker {
	OTIO_SCHEMA: 'Marker.2';
	metadata: OtioMetadata;
	name: string;
	color: string;
	marked_range: OtioTimeRange;
}

export interface OtioExternalReference {
	OTIO_SCHEMA: 'ExternalReference.1';
	metadata: OtioMetadata;
	name: string;
	available_range: OtioTimeRange | null;
	available_image_bounds: null;
	target_url: string;
}

export interface OtioGeneratorReference {
	OTIO_SCHEMA: 'GeneratorReference.1';
	metadata: OtioMetadata;
	name: string;
	available_range: OtioTimeRange | null;
	available_image_bounds: null;
	generator_kind: string;
	parameters: OtioMetadata;
}

export interface OtioMissingReference {
	OTIO_SCHEMA: 'MissingReference.1';
	metadata: OtioMetadata;
	name: string;
	available_range: OtioTimeRange | null;
	available_image_bounds: null;
}

export type OtioMediaReference =
	| OtioExternalReference
	| OtioGeneratorReference
	| OtioMissingReference;

export interface OtioClip {
	OTIO_SCHEMA: 'Clip.2';
	metadata: OtioMetadata;
	name: string;
	source_range: OtioTimeRange;
	effects: never[];
	markers: OtioMarker[];
	enabled: boolean;
	media_references: Record<string, OtioMediaReference>;
	active_media_reference_key: string;
}

export interface OtioGap {
	OTIO_SCHEMA: 'Gap.1';
	metadata: OtioMetadata;
	name: string;
	source_range: OtioTimeRange;
	effects: never[];
	markers: OtioMarker[];
	enabled: boolean;
}

export interface OtioTransition {
	OTIO_SCHEMA: 'Transition.1';
	metadata: OtioMetadata;
	name: string;
	transition_type: string;
	in_offset: OtioRationalTime;
	out_offset: OtioRationalTime;
}

export type OtioTrackChild = OtioClip | OtioGap | OtioTransition;

export interface OtioTrack {
	OTIO_SCHEMA: 'Track.1';
	metadata: OtioMetadata;
	name: string;
	source_range: null;
	effects: never[];
	markers: OtioMarker[];
	enabled: boolean;
	children: OtioTrackChild[];
	kind: 'Video' | 'Audio';
}

export interface OtioStack {
	OTIO_SCHEMA: 'Stack.1';
	metadata: OtioMetadata;
	name: string;
	source_range: null;
	effects: never[];
	markers: OtioMarker[];
	enabled: boolean;
	children: OtioTrack[];
}

export interface OtioTimeline {
	OTIO_SCHEMA: 'Timeline.1';
	metadata: OtioMetadata;
	name: string;
	global_start_time: OtioRationalTime;
	tracks: OtioStack;
}

export interface OtioSerializeOptions {
	displayName: string;
	appVersion: string;
	/**
	 * Maps a sourceId to the `target_url` for its media reference. Bundle
	 * export supplies bundle-relative `media/…` paths; `null`/absent falls
	 * back to the original file name (standalone export).
	 */
	resolveTargetUrl?: (sourceId: string) => string | null;
}

export interface InterchangeOutput {
	text: string;
	warnings: string[];
}

const DEFAULT_MEDIA_KEY = 'DEFAULT_MEDIA';
const MARKER_COLOR = 'PURPLE';

function rational(value: number, rate: number): OtioRationalTime {
	return { OTIO_SCHEMA: 'RationalTime.1', rate, value };
}

function timeRange(startFrames: number, durationFrames: number, rate: number): OtioTimeRange {
	return {
		OTIO_SCHEMA: 'TimeRange.1',
		duration: rational(durationFrames, rate),
		start_time: rational(startFrames, rate)
	};
}

function availableRange(descriptor: SourceDescriptor, rate: number): OtioTimeRange | null {
	const frames = snapToFrames(descriptor.durationS, rate);
	return frames > 0 ? timeRange(0, frames, rate) : null;
}

function clipLocalcutMetadata(clip: TimelineClip): Record<string, unknown> {
	const localcut: Record<string, unknown> = {
		clipId: clip.id,
		effects: clip.effects,
		transform: clip.transform,
		audioFadeIn: clip.audioFadeIn,
		audioFadeOut: clip.audioFadeOut
	};
	if (clip.keyframes) localcut.keyframes = clip.keyframes;
	if (clip.lut) localcut.lut = { key: clip.lut.key, fileName: clip.lut.fileName };
	if (clip.linkedGroupId) localcut.linkedGroupId = clip.linkedGroupId;
	if (clip.kind === 'title' && clip.title) localcut.title = clip.title;
	return localcut;
}

function mediaReference(
	clip: TimelineClip,
	descriptor: SourceDescriptor | undefined,
	rate: number,
	options: OtioSerializeOptions,
	warnings: string[]
): OtioMediaReference {
	if (clip.kind === 'title') {
		return {
			OTIO_SCHEMA: 'GeneratorReference.1',
			metadata: {},
			name: clip.title?.text ?? 'Title',
			available_range: timeRange(0, Math.max(1, snapToFrames(clip.duration, rate)), rate),
			available_image_bounds: null,
			generator_kind: 'localcut.title',
			parameters: {}
		};
	}
	if (!descriptor) {
		warnings.push(
			`Clip ${clip.id} references unknown source ${clip.sourceId}; emitted as missing.`
		);
		return {
			OTIO_SCHEMA: 'MissingReference.1',
			metadata: { localcut: { sourceId: clip.sourceId } },
			name: clip.sourceId,
			available_range: null,
			available_image_bounds: null
		};
	}
	const localcut: Record<string, unknown> = {
		sourceId: descriptor.sourceId,
		mimeType: descriptor.mimeType ?? null
	};
	if (descriptor.fingerprint) localcut.fingerprint = descriptor.fingerprint;
	return {
		OTIO_SCHEMA: 'ExternalReference.1',
		metadata: { localcut },
		name: descriptor.fileName,
		available_range: availableRange(descriptor, rate),
		available_image_bounds: null,
		target_url: options.resolveTargetUrl?.(descriptor.sourceId) ?? descriptor.fileName
	};
}

interface PlacedClip {
	node: OtioClip;
	clipId: string;
	startFrames: number;
}

function buildTrackChildren(
	track: TimelineTrack,
	sourceById: Map<string, SourceDescriptor>,
	rate: number,
	options: OtioSerializeOptions,
	warnings: string[]
): { children: OtioTrackChild[]; placed: Map<string, PlacedClip>; dropped: Set<string> } {
	const children: OtioTrackChild[] = [];
	const placed = new Map<string, PlacedClip>();
	const dropped = new Set<string>();
	const sorted = track.clips.toSorted((a, b) => a.start - b.start || compareStrings(a.id, b.id));
	let cursor = 0;
	for (const clip of sorted) {
		const startFrames = snapToFrames(clip.start, rate);
		const endFrames = snapToFrames(clip.start + clip.duration, rate);
		if (endFrames <= startFrames) {
			dropped.add(clip.id);
			warnings.push(
				`Clip ${clipDisplayName(clip, sourceById)} collapses to zero frames at ${rate} fps and was dropped.`
			);
			continue;
		}
		if (startFrames < cursor) {
			dropped.add(clip.id);
			warnings.push(
				`Clip ${clipDisplayName(clip, sourceById)} overlaps the previous clip after frame snapping and was dropped.`
			);
			continue;
		}
		if (startFrames > cursor) {
			children.push({
				OTIO_SCHEMA: 'Gap.1',
				metadata: {},
				name: '',
				source_range: timeRange(0, startFrames - cursor, rate),
				effects: [],
				markers: [],
				enabled: true
			});
		}
		const descriptor = clip.kind === 'title' ? undefined : sourceById.get(clip.sourceId);
		const sourceStartFrames = clip.kind === 'title' ? 0 : snapToFrames(clip.inPoint, rate);
		const node: OtioClip = {
			OTIO_SCHEMA: 'Clip.2',
			metadata: { localcut: clipLocalcutMetadata(clip) },
			name: clipDisplayName(clip, sourceById),
			source_range: timeRange(sourceStartFrames, endFrames - startFrames, rate),
			effects: [],
			markers: [],
			enabled: true,
			media_references: {
				[DEFAULT_MEDIA_KEY]: mediaReference(clip, descriptor, rate, options, warnings)
			},
			active_media_reference_key: DEFAULT_MEDIA_KEY
		};
		children.push(node);
		placed.set(clip.id, { node, clipId: clip.id, startFrames });
		cursor = endFrames;
	}
	return { children, placed, dropped };
}

function clipDisplayName(clip: TimelineClip, sourceById: Map<string, SourceDescriptor>): string {
	if (clip.kind === 'title') return clip.title?.text ?? 'Title';
	return sourceById.get(clip.sourceId)?.fileName ?? clip.id;
}

function transitionType(kind: TimelineTransition['kind']): string {
	return kind === 'cross-dissolve' ? 'SMPTE_Dissolve' : 'Custom_Transition';
}

function insertTransitions(
	track: TimelineTrack,
	children: OtioTrackChild[],
	placed: Map<string, PlacedClip>,
	dropped: Set<string>,
	transitions: readonly TimelineTransition[],
	rate: number,
	warnings: string[]
): void {
	const onTrack = transitions
		.filter((transition) => transition.trackId === track.id)
		.sort((a, b) => compareStrings(a.id, b.id));
	for (const transition of onTrack) {
		if (dropped.has(transition.fromClipId) || dropped.has(transition.toClipId)) {
			warnings.push(`Transition ${transition.id} touches a dropped clip and was omitted.`);
			continue;
		}
		const from = placed.get(transition.fromClipId);
		const to = placed.get(transition.toClipId);
		if (!from || !to) {
			warnings.push(`Transition ${transition.id} references a missing clip and was omitted.`);
			continue;
		}
		const fromIndex = children.indexOf(from.node);
		if (fromIndex < 0 || children[fromIndex + 1] !== to.node) {
			warnings.push(
				`Transition ${transition.id} no longer sits between adjacent clips and was omitted.`
			);
			continue;
		}
		// Snap the total first, then split, so odd totals never gain a frame.
		const totalFrames = snapToFrames(transition.durationS, rate);
		if (totalFrames <= 0) {
			warnings.push(`Transition ${transition.id} collapses to zero frames and was omitted.`);
			continue;
		}
		const inFrames = Math.floor(totalFrames / 2);
		children.splice(fromIndex + 1, 0, {
			OTIO_SCHEMA: 'Transition.1',
			metadata: {
				localcut: {
					transition: {
						id: transition.id,
						kind: transition.kind,
						params: transition.params
					}
				}
			},
			name: transition.kind,
			transition_type: transitionType(transition.kind),
			in_offset: rational(inFrames, rate),
			out_offset: rational(totalFrames - inFrames, rate)
		});
	}
}

function stackMarkers(doc: ProjectDoc, rate: number): OtioMarker[] {
	return doc.markers.map((marker) => ({
		OTIO_SCHEMA: 'Marker.2' as const,
		metadata: { localcut: { markerId: marker.id } },
		name: marker.label,
		color: MARKER_COLOR,
		marked_range: timeRange(snapToFrames(marker.time, rate), 0, rate)
	}));
}

export function serializeTimelineToOtio(
	doc: ProjectDoc,
	options: OtioSerializeOptions
): InterchangeOutput {
	const warnings: string[] = [];
	const rate = interchangeRate(doc);
	const sourceById = new Map(doc.sources.map((source) => [source.sourceId, source]));

	let videoIndex = 0;
	let audioIndex = 0;
	const tracks: OtioTrack[] = doc.timeline.map((track) => {
		const { children, placed, dropped } = buildTrackChildren(
			track,
			sourceById,
			rate,
			options,
			warnings
		);
		insertTransitions(track, children, placed, dropped, doc.transitions, rate, warnings);
		const name = track.type === 'video' ? `V${++videoIndex}` : `A${++audioIndex}`;
		return {
			OTIO_SCHEMA: 'Track.1',
			metadata: {
				localcut: {
					trackId: track.id,
					gain: track.gain,
					pan: track.pan,
					muted: track.muted,
					solo: track.solo,
					locked: track.locked,
					visible: track.visible,
					syncLocked: track.syncLocked,
					editTarget: track.editTarget
				}
			},
			name,
			source_range: null,
			effects: [],
			markers: [],
			enabled: true,
			// LocalCut composites timeline array order with the last track on
			// top — the same bottom-first order OTIO stacks use.
			children,
			kind: track.type === 'video' ? 'Video' : 'Audio'
		};
	});

	const timeline: OtioTimeline = {
		OTIO_SCHEMA: 'Timeline.1',
		metadata: {
			localcut: {
				projectId: doc.projectId,
				projectSchemaVersion: doc.schemaVersion,
				appVersion: options.appVersion,
				savedAt: doc.savedAt,
				masterGain: doc.masterGain,
				captionTracks: doc.captionTracks
			}
		},
		name: options.displayName,
		global_start_time: rational(0, rate),
		tracks: {
			OTIO_SCHEMA: 'Stack.1',
			metadata: {},
			name: 'tracks',
			source_range: null,
			effects: [],
			markers: stackMarkers(doc, rate),
			enabled: true,
			children: tracks
		}
	};

	return { text: `${JSON.stringify(timeline, null, 2)}\n`, warnings };
}
