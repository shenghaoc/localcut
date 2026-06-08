import type { TimelineClip } from '../timeline';
import type {
	NormalizedSourceTiming,
	NormalizedTrackTiming,
	SourceFrameRateMode,
	SourceTrackInspection
} from './types';

export type SourceTimestampTrackKind = 'video' | 'audio';
export type SourceTimestampFill =
	| 'none'
	| 'before-track-start'
	| 'after-track-end'
	| 'outside-source';

export interface SourceTimestampResolution {
	readonly normalizedSourceS: number;
	readonly adapterTimestampS: number;
	readonly available: boolean;
	readonly fill: SourceTimestampFill;
}

export interface ResolveSourceTimestampOptions {
	readonly clip: TimelineClip;
	readonly timelineTime: number;
	readonly trackKind: SourceTimestampTrackKind;
	readonly timing: NormalizedSourceTiming;
}

export interface UnavailableAudioSilenceFramesOptions {
	readonly resolution: SourceTimestampResolution;
	readonly timing: NormalizedSourceTiming;
	readonly clip: TimelineClip;
	readonly timelineTime: number;
	readonly sampleRate: number;
	readonly maxFrames: number;
}

export type AudioAvailabilityWindowFramesOptions = UnavailableAudioSilenceFramesOptions;

export interface BuildNormalizedSourceTimingOptions {
	readonly durationS: number;
	readonly video?: SourceTrackInspection;
	readonly audio?: SourceTrackInspection;
	readonly frameRateMode?: SourceFrameRateMode;
}

const TIMING_EPSILON = 1e-6;

function finiteOr(value: number | null | undefined, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function trackTiming(track: SourceTrackInspection | undefined): NormalizedTrackTiming | undefined {
	if (!track) return undefined;
	const duration = track.durationS;
	return {
		trackId: track.trackId,
		firstTimestampS: finiteOr(track.startS, 0),
		lastTimestampS:
			duration !== null && Number.isFinite(duration)
				? finiteOr(track.startS, 0) + Math.max(0, duration)
				: null,
		durationS: duration !== null && Number.isFinite(duration) ? Math.max(0, duration) : null
	};
}

export function buildNormalizedSourceTiming(
	options: BuildNormalizedSourceTimingOptions
): NormalizedSourceTiming {
	const video = trackTiming(options.video);
	const audio = trackTiming(options.audio);
	const starts = [video?.firstTimestampS, audio?.firstTimestampS].filter(
		(value): value is number => typeof value === 'number' && Number.isFinite(value)
	);
	const earliest = starts.length > 0 ? Math.min(...starts) : 0;
	const normalizedStartS = Math.max(0, earliest);
	const fallbackDuration = Math.max(0, finiteOr(options.durationS, 0));
	const ends = [video?.lastTimestampS, audio?.lastTimestampS].filter(
		(value): value is number => typeof value === 'number' && Number.isFinite(value)
	);
	const durationS =
		ends.length > 0 ? Math.max(0, Math.max(...ends) - normalizedStartS) : fallbackDuration;

	return {
		normalizedStartS,
		durationS,
		video,
		audio,
		avOffsetS: video && audio ? audio.firstTimestampS - video.firstTimestampS : 0,
		frameRateMode: options.frameRateMode ?? 'unknown'
	};
}

export function defaultNormalizedSourceTiming(
	durationS: number,
	trackKind: SourceTimestampTrackKind = 'video'
): NormalizedSourceTiming {
	const duration = Math.max(0, finiteOr(durationS, 0));
	const track: NormalizedTrackTiming = {
		trackId: `${trackKind}-1`,
		firstTimestampS: 0,
		lastTimestampS: duration,
		durationS: duration
	};
	return {
		normalizedStartS: 0,
		durationS: duration,
		...(trackKind === 'audio' ? { audio: track } : { video: track }),
		avOffsetS: 0,
		frameRateMode: 'unknown'
	};
}

export function resolveNormalizedSourceTimestamp(
	timing: NormalizedSourceTiming,
	trackKind: SourceTimestampTrackKind,
	normalizedSourceS: number
): SourceTimestampResolution {
	const safeSource = finiteOr(normalizedSourceS, 0);
	const adapterTimestampS = timing.normalizedStartS + safeSource;
	const track = trackKind === 'audio' ? timing.audio : timing.video;

	if (safeSource < -TIMING_EPSILON || safeSource > timing.durationS + TIMING_EPSILON) {
		return {
			normalizedSourceS: safeSource,
			adapterTimestampS,
			available: false,
			fill: 'outside-source'
		};
	}

	if (!track) {
		return {
			normalizedSourceS: safeSource,
			adapterTimestampS,
			available: false,
			fill: 'outside-source'
		};
	}

	if (adapterTimestampS + TIMING_EPSILON < track.firstTimestampS) {
		return {
			normalizedSourceS: safeSource,
			adapterTimestampS,
			available: false,
			fill: 'before-track-start'
		};
	}

	if (track.lastTimestampS !== null && adapterTimestampS > track.lastTimestampS + TIMING_EPSILON) {
		return {
			normalizedSourceS: safeSource,
			adapterTimestampS,
			available: false,
			fill: 'after-track-end'
		};
	}

	return {
		normalizedSourceS: safeSource,
		adapterTimestampS,
		available: true,
		fill: 'none'
	};
}

export function resolveSourceTimestamp(
	options: ResolveSourceTimestampOptions
): SourceTimestampResolution {
	const normalizedSourceS = options.clip.inPoint + (options.timelineTime - options.clip.start);
	return resolveNormalizedSourceTimestamp(options.timing, options.trackKind, normalizedSourceS);
}

export function unavailableAudioSilenceFrames(
	options: UnavailableAudioSilenceFramesOptions
): number {
	const maxFrames = Math.max(0, Math.floor(finiteOr(options.maxFrames, 0)));
	if (options.resolution.available || maxFrames <= 0) return 0;

	if (
		options.resolution.fill === 'before-track-start' &&
		options.timing.audio &&
		Number.isFinite(options.sampleRate) &&
		options.sampleRate > 0
	) {
		const normalizedTrackStartS =
			options.timing.audio.firstTimestampS - options.timing.normalizedStartS;
		const nextTimelineTime = options.clip.start + (normalizedTrackStartS - options.clip.inPoint);
		const framesUntilTrackStart = Math.ceil(
			(nextTimelineTime - options.timelineTime) * options.sampleRate
		);
		if (framesUntilTrackStart > 0) return Math.min(maxFrames, framesUntilTrackStart);
	}

	return maxFrames;
}

export function audioAvailabilityWindowFrames(
	options: AudioAvailabilityWindowFramesOptions
): number {
	const maxFrames = Math.max(0, Math.floor(finiteOr(options.maxFrames, 0)));
	if (maxFrames <= 0) return 0;
	if (!options.resolution.available) return unavailableAudioSilenceFrames(options);

	const track = options.timing.audio;
	if (
		!track ||
		track.lastTimestampS === null ||
		!Number.isFinite(options.sampleRate) ||
		options.sampleRate <= 0
	) {
		return maxFrames;
	}

	const framesUntilTrackEnd = Math.ceil(
		(track.lastTimestampS - options.resolution.adapterTimestampS) * options.sampleRate
	);
	if (framesUntilTrackEnd > 0) return Math.min(maxFrames, framesUntilTrackEnd);
	// Keep export/audio pumps moving if floating-point drift leaves an available
	// timestamp exactly at or just past the track end.
	return 1;
}
