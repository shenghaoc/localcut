import type {
	CaptionTrackSnapshot,
	ExportPresetDoc,
	ExportSettings,
	LiveAudioChainConfig,
	NormalizedSourceTimingSnapshot,
	PersistedQueueJob,
	RingBufferConfig,
	SourceColorHintsSnapshot,
	SourceDescriptorSnapshot,
	SourceFrameRateModeSnapshot,
	SourceHealthReportSnapshot,
	SourceHealthWarningSnapshot,
	SourceTrackTimingSnapshot,
	TimeRemapSnapshot,
	VoiceCleanupSettings
} from '../protocol';
import { DEFAULT_VOICE_CLEANUP_SETTINGS } from '../protocol';
import {
	DEFAULT_CAPTION_STYLE,
	cloneCaptionTrack,
	createCaptionTrack,
	normalizeCaptionStyle,
	sortCaptionSegments,
	type CaptionSegment,
	type CaptionStyle,
	type CaptionTrack
} from './captions/types';
import type { CaptionAnimStylePreset } from './captions/anim-style';
import { validateCaptionAnimPreset } from './captions/anim-style';
import {
	DEFAULT_CLIP_AUDIO_FADES,
	DEFAULT_MASTER_GAIN,
	DEFAULT_TRACK_MIX,
	normalizeTitleContent,
	normalizeTransitionKind,
	normalizeTransitionParams,
	normalizeClipEffects,
	normalizeTransform,
	sortMarkers,
	type Timeline,
	type TimelineClip,
	type TimelineMarker,
	type TimelineTrack,
	type TimelineTransition,
	type TitleContent
} from './timeline';
import { cloneClipKeyframes, parseClipKeyframes } from './keyframes';
import { cloneClipLut, parsePersistedClipLut } from './lut';
import { normalizeSkinMask } from './skin-smooth';
import { parseExportPresetDoc } from './export-presets';

export const PROJECT_SCHEMA_VERSION = 16;
const DURATION_MATCH_TOLERANCE_S = 0.25;
const TIMING_MATCH_TOLERANCE_S = 0.05;

export type SourceDescriptor = SourceDescriptorSnapshot;

export interface ProjectDoc {
	schemaVersion: typeof PROJECT_SCHEMA_VERSION;
	projectId: string;
	savedAt: string;
	timeline: Timeline;
	captionTracks: CaptionTrack[];
	/** Phase 30: user-imported caption animation style presets. */
	customAnimCaptionPresets?: CaptionAnimStylePreset[];
	transitions: TimelineTransition[];
	markers: TimelineMarker[];
	sources: SourceDescriptor[];
	masterGain: number;
	exportSettings?: ExportSettings;
	exportPresets?: ExportPresetDoc[];
	renderQueueHistory?: PersistedQueueJob[];
	replayBufferConfig?: RingBufferConfig;
	liveAudioChainConfig?: LiveAudioChainConfig;
	voiceCleanup?: VoiceCleanupSettings;
	/** Phase 34: Beat analysis display settings. */
	beatSettings?: {
		enabledSourceIds: string[];
		globalOffsetMs: number;
	};
}

export interface SerializeProjectOptions {
	projectId: string;
	timeline: Timeline;
	captionTracks?: readonly CaptionTrack[];
	customAnimCaptionPresets?: readonly CaptionAnimStylePreset[];
	transitions?: readonly TimelineTransition[];
	markers?: readonly TimelineMarker[];
	sources: readonly SourceDescriptor[];
	masterGain?: number;
	savedAt?: Date;
	exportSettings?: ExportSettings;
	exportPresets?: readonly ExportPresetDoc[];
	renderQueueHistory?: readonly PersistedQueueJob[];
	replayBufferConfig?: RingBufferConfig;
	liveAudioChainConfig?: LiveAudioChainConfig;
	voiceCleanup?: VoiceCleanupSettings;
	beatSettings?: { enabledSourceIds: string[]; globalOffsetMs: number };
}

export type DeserializeProjectResult =
	| { ok: true; doc: ProjectDoc }
	| { ok: false; reason: string };

export interface SourceMatchCandidate {
	fileName: string;
	byteSize: number;
	durationS: number;
	video?: SourceDescriptor['video'];
	audio?: SourceDescriptor['audio'];
	timing?: SourceDescriptor['timing'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function requiredString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function optionalString(value: unknown): string | null | undefined {
	return value === undefined || value === null || typeof value === 'string' ? value : undefined;
}

function parseExportSettings(value: unknown): ExportSettings | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isRecord(value)) return undefined;
	const preset = value.preset === 'quality' || value.preset === 'fast' ? value.preset : null;
	const codec =
		value.codec === 'h264' || value.codec === 'vp9' || value.codec === 'av1' ? value.codec : null;
	const container =
		value.container === 'mp4' || value.container === 'webm' ? value.container : null;
	const width = finiteNumber(value.width);
	const height = finiteNumber(value.height);
	const fps = finiteNumber(value.fps);
	const videoBitrate = finiteNumber(value.videoBitrate);
	if (
		!preset ||
		!codec ||
		!container ||
		width === null ||
		height === null ||
		fps === null ||
		videoBitrate === null
	) {
		return undefined;
	}
	if (width <= 0 || height <= 0 || fps <= 0 || videoBitrate <= 0) return undefined;

	let range: ExportSettings['range'];
	if (value.range !== undefined) {
		if (isRecord(value.range)) {
			const startS = finiteNumber(value.range.startS);
			const endS = finiteNumber(value.range.endS);
			if (startS !== null && endS !== null && endS > startS) {
				range = { startS, endS };
			}
		}
	}

	const parsed: ExportSettings = {
		preset,
		codec,
		container,
		width,
		height,
		fps,
		videoBitrate,
		range
	};
	const sourceMode = value.sourceMode;
	if (sourceMode === 'proxy' || sourceMode === 'original') {
		parsed.sourceMode = sourceMode;
	}
	return parsed;
}

function cloneExportSettings(settings: ExportSettings): ExportSettings {
	const cloned: ExportSettings = {
		preset: settings.preset,
		codec: settings.codec,
		container: settings.container,
		width: settings.width,
		height: settings.height,
		fps: settings.fps,
		videoBitrate: settings.videoBitrate,
		range: settings.range ? { ...settings.range } : undefined
	};
	if (settings.sourceMode) cloned.sourceMode = settings.sourceMode;
	return cloned;
}

function cloneClip(clip: TimelineClip): TimelineClip {
	const cloned: TimelineClip = {
		id: clip.id,
		sourceId: clip.sourceId,
		start: clip.start,
		duration: clip.duration,
		inPoint: clip.inPoint,
		effects: normalizeClipEffects(clip.effects),
		transform: normalizeTransform(clip.transform),
		audioFadeIn: clip.audioFadeIn,
		audioFadeOut: clip.audioFadeOut
	};
	if (clip.kind === 'title') {
		cloned.kind = 'title';
		cloned.title = normalizeTitleContent(clip.title);
	}
	if (clip.linkedGroupId) cloned.linkedGroupId = clip.linkedGroupId;
	if (clip.cleanedAudio) cloned.cleanedAudio = { ...clip.cleanedAudio };
	if (clip.skinMask) cloned.skinMask = { ...clip.skinMask };
	if (clip.matte) cloned.matte = { ...clip.matte };
	if (clip.timeRemap) cloned.timeRemap = cloneTimeRemap(clip.timeRemap);
	const keyframes = cloneClipKeyframes(clip.keyframes);
	if (keyframes) cloned.keyframes = keyframes;
	const lut = cloneClipLut(clip.lut);
	if (lut) cloned.lut = lut;
	return cloned;
}

/** Deep-clone a TimeRemapSnapshot (Phase 35). */
function cloneTimeRemap(remap: TimeRemapSnapshot): TimeRemapSnapshot {
	return {
		keyframes: remap.keyframes.map((kf) => ({ ...kf })),
		pitchPreserve: remap.pitchPreserve
	};
}

/**
 * Phase 35: Parse an optional persisted time-remap sidecar. Invalid entries
 * degrade to "no remap" (identity speed) rather than rejecting the whole clip.
 */
function parseClipTimeRemap(value: unknown): TimeRemapSnapshot | undefined {
	if (!isRecord(value)) return undefined;
	const rawKeyframes = Array.isArray(value.keyframes) ? value.keyframes : undefined;
	if (!rawKeyframes) return undefined;

	const keyframes: TimeRemapSnapshot['keyframes'] = [];
	for (const kf of rawKeyframes) {
		if (!isRecord(kf)) return undefined;
		const outTimeS = finiteNumber(kf.outTimeS);
		const speed = finiteNumber(kf.speed);
		const easing = kf.easing;
		if (outTimeS === null || speed === null) return undefined;
		if (speed < 0.25 || speed > 4.0) return undefined;
		if (easing !== 'linear' && easing !== 'ease' && easing !== 'hold') return undefined;
		keyframes.push({ outTimeS, speed, easing });
	}

	const pitchPreserve = typeof value.pitchPreserve === 'boolean' ? value.pitchPreserve : undefined;
	if (pitchPreserve === undefined) return undefined;

	return { keyframes, pitchPreserve };
}

/** Parses an optional persisted cleaned-audio reference (Phase 27). Invalid
 *  entries degrade to "no cleanup" rather than rejecting the whole clip. */
function parseCleanedAudio(value: unknown): TimelineClip['cleanedAudio'] | undefined {
	if (!isRecord(value)) return undefined;
	try {
		const assetId = requiredString(value.assetId);
		const clipInPointS = finiteNumber(value.clipInPointS);
		const durationS = finiteNumber(value.durationS);
		const modelId = requiredString(value.modelId);
		const modelVersion = requiredString(value.modelVersion);
		if (!assetId || !modelId || !modelVersion) return undefined;
		if (clipInPointS === null || clipInPointS < 0) return undefined;
		if (durationS === null || durationS <= 0) return undefined;
		return { assetId, clipInPointS, durationS, modelId, modelVersion };
	} catch {
		return undefined;
	}
}

export function cloneTimelineSnapshot(timeline: Timeline): Timeline {
	return timeline.map((track) => ({
		id: track.id,
		type: track.type,
		gain: track.gain,
		pan: track.pan,
		muted: track.muted,
		solo: track.solo,
		locked: track.locked,
		visible: track.visible,
		syncLocked: track.syncLocked,
		editTarget: track.editTarget,
		clips: track.clips.map(cloneClip)
	}));
}

export function cloneCaptionTracksSnapshot(captionTracks: readonly CaptionTrack[]): CaptionTrack[] {
	return captionTracks.map(cloneCaptionTrack);
}

export function cloneTransitionsSnapshot(
	transitions: readonly TimelineTransition[]
): TimelineTransition[] {
	return transitions.map((transition) => ({
		id: transition.id,
		trackId: transition.trackId,
		fromClipId: transition.fromClipId,
		toClipId: transition.toClipId,
		durationS: transition.durationS,
		kind: normalizeTransitionKind(transition.kind),
		params: normalizeTransitionParams(transition.params)
	}));
}

export function cloneMarkersSnapshot(markers: readonly TimelineMarker[]): TimelineMarker[] {
	return sortMarkers(
		markers.map((marker) => ({
			id: marker.id,
			time: marker.time,
			label: marker.label
		}))
	);
}

function cloneSourceDescriptor(source: SourceDescriptor): SourceDescriptor {
	return {
		sourceId: source.sourceId,
		fileName: source.fileName,
		kind: source.kind,
		byteSize: source.byteSize,
		durationS: source.durationS,
		mimeType: source.mimeType,
		fingerprint: source.fingerprint ? { ...source.fingerprint } : undefined,
		adapterId: source.adapterId,
		timing: source.timing ? cloneTiming(source.timing) : undefined,
		health: source.health ? cloneHealthReport(source.health) : undefined,
		video: source.video
			? {
					width: source.video.width,
					height: source.video.height,
					codedWidth: source.video.codedWidth,
					codedHeight: source.video.codedHeight,
					frameRate: source.video.frameRate,
					frameRateMode: source.video.frameRateMode,
					rotationDeg: source.video.rotationDeg,
					color: source.video.color ? cloneColor(source.video.color) : undefined,
					trackStartS: source.video.trackStartS,
					trackDurationS: source.video.trackDurationS,
					codec: source.video.codec,
					canDecode: source.video.canDecode
				}
			: undefined,
		audio: source.audio
			? {
					channels: source.audio.channels,
					sampleRate: source.audio.sampleRate,
					trackStartS: source.audio.trackStartS,
					trackDurationS: source.audio.trackDurationS,
					codec: source.audio.codec,
					canDecode: source.audio.canDecode
				}
			: undefined
	};
}

function cloneColor(color: SourceColorHintsSnapshot): SourceColorHintsSnapshot {
	return {
		primaries: color.primaries,
		transfer: color.transfer,
		matrix: color.matrix,
		fullRange: color.fullRange
	};
}

function cloneTrackTiming(timing: SourceTrackTimingSnapshot): SourceTrackTimingSnapshot {
	return {
		trackId: timing.trackId,
		firstTimestampS: timing.firstTimestampS,
		lastTimestampS: timing.lastTimestampS,
		durationS: timing.durationS
	};
}

function cloneTiming(timing: NormalizedSourceTimingSnapshot): NormalizedSourceTimingSnapshot {
	return {
		normalizedStartS: timing.normalizedStartS,
		durationS: timing.durationS,
		video: timing.video ? cloneTrackTiming(timing.video) : undefined,
		audio: timing.audio ? cloneTrackTiming(timing.audio) : undefined,
		avOffsetS: timing.avOffsetS,
		frameRateMode: timing.frameRateMode
	};
}

function cloneHealthWarning(warning: SourceHealthWarningSnapshot): SourceHealthWarningSnapshot {
	return {
		code: warning.code,
		severity: warning.severity,
		blocking: warning.blocking,
		sourceId: warning.sourceId,
		trackId: warning.trackId,
		message: warning.message,
		details: { ...warning.details }
	};
}

function cloneHealthReport(report: SourceHealthReportSnapshot): SourceHealthReportSnapshot {
	return {
		sourceId: report.sourceId,
		fileName: report.fileName,
		status: report.status,
		warnings: report.warnings.map(cloneHealthWarning)
	};
}

export function serializeProject(options: SerializeProjectOptions): ProjectDoc {
	const masterGain =
		options.masterGain !== undefined && Number.isFinite(options.masterGain)
			? Math.max(0, options.masterGain)
			: DEFAULT_MASTER_GAIN;
	const doc: ProjectDoc = {
		schemaVersion: PROJECT_SCHEMA_VERSION,
		projectId: options.projectId,
		savedAt: (options.savedAt ?? new Date()).toISOString(),
		timeline: cloneTimelineSnapshot(options.timeline),
		captionTracks: cloneCaptionTracksSnapshot(options.captionTracks ?? []),
		transitions: cloneTransitionsSnapshot(options.transitions ?? []),
		markers: cloneMarkersSnapshot(options.markers ?? []),
		sources: options.sources.map(cloneSourceDescriptor),
		masterGain
	};
	if (options.exportSettings) {
		doc.exportSettings = cloneExportSettings(options.exportSettings);
	}
	if (options.exportPresets && options.exportPresets.length > 0) {
		doc.exportPresets = options.exportPresets.map((p) => ({ ...p }));
	}
	if (options.renderQueueHistory && options.renderQueueHistory.length > 0) {
		doc.renderQueueHistory = options.renderQueueHistory.map((j) => ({
			...j,
			settings: cloneExportSettings(j.settings),
			jobRange: { ...j.jobRange } as PersistedQueueJob['jobRange']
		}));
	}
	if (options.replayBufferConfig) {
		doc.replayBufferConfig = { ...options.replayBufferConfig };
	}
	if (options.liveAudioChainConfig) {
		doc.liveAudioChainConfig = cloneLiveAudioChainConfig(options.liveAudioChainConfig);
	}
	if (options.customAnimCaptionPresets && options.customAnimCaptionPresets.length > 0) {
		doc.customAnimCaptionPresets = options.customAnimCaptionPresets.map((p) => ({ ...p }));
	}
	if (options.voiceCleanup) {
		doc.voiceCleanup = cloneVoiceCleanupSettings(options.voiceCleanup);
	}
	if (options.beatSettings) {
		doc.beatSettings = {
			enabledSourceIds: [...options.beatSettings.enabledSourceIds],
			globalOffsetMs: options.beatSettings.globalOffsetMs
		};
	}
	return doc;
}

function cloneLiveAudioChainConfig(config: LiveAudioChainConfig): LiveAudioChainConfig {
	return {
		gate: { ...config.gate },
		compressor: { ...config.compressor },
		limiter: { ...config.limiter },
		denoiserBypass: config.denoiserBypass,
		printToRecording: config.printToRecording
	};
}

export function cloneVoiceCleanupSettings(settings: VoiceCleanupSettings): VoiceCleanupSettings {
	return {
		denoiserEnabledTracks: [...settings.denoiserEnabledTracks],
		normalisationTargetLufs: settings.normalisationTargetLufs,
		normaliseGainDb: settings.normaliseGainDb,
		limiterCeilingDbtp: settings.limiterCeilingDbtp,
		gateParams: { ...settings.gateParams },
		limiterParams: { ...settings.limiterParams }
	};
}

function parseClip(value: unknown): TimelineClip | null {
	if (!isRecord(value)) return null;
	const id = requiredString(value.id);
	const start = finiteNumber(value.start);
	const duration = finiteNumber(value.duration);
	// Title clips are source-less, carry no in-point, and decode no media (Phase
	// 14); regular clips still require a sourceId and a non-negative in-point.
	const isTitle = value.kind === 'title';
	const sourceId = isTitle ? '' : requiredString(value.sourceId);
	const inPoint = isTitle ? 0 : finiteNumber(value.inPoint);
	if (!id || start === null || duration === null || inPoint === null) {
		return null;
	}
	if (!isTitle && sourceId === null) return null;
	if (duration <= 0 || start < 0 || inPoint < 0) return null;
	if (isTitle && !isRecord(value.title)) return null;

	const rawEffects = isRecord(value.effects) ? value.effects : {};
	const rawTransform = isRecord(value.transform) ? value.transform : {};
	const keyframes = parseClipKeyframes(value.keyframes, duration);
	if (keyframes === null) return null;
	const lut = parsePersistedClipLut(value.lut);
	if (lut === null) return null;
	const fit =
		rawTransform.fit === 'fit' || rawTransform.fit === 'letterbox' || rawTransform.fit === 'fill'
			? rawTransform.fit
			: undefined;
	const audioFadeIn = finiteNumber(value.audioFadeIn) ?? DEFAULT_CLIP_AUDIO_FADES.audioFadeIn;
	const audioFadeOut = finiteNumber(value.audioFadeOut) ?? DEFAULT_CLIP_AUDIO_FADES.audioFadeOut;

	const linkedGroupId =
		typeof value.linkedGroupId === 'string' && value.linkedGroupId.length > 0
			? value.linkedGroupId
			: undefined;
	const clip: TimelineClip = {
		id,
		...(isTitle
			? {
					kind: 'title' as const,
					title: normalizeTitleContent(value.title as Partial<TitleContent>)
				}
			: {}),
		sourceId: sourceId ?? '',
		start,
		duration,
		inPoint,
		effects: normalizeClipEffects({
			brightness: finiteNumber(rawEffects.brightness) ?? undefined,
			contrast: finiteNumber(rawEffects.contrast) ?? undefined,
			saturation: finiteNumber(rawEffects.saturation) ?? undefined,
			temperature: finiteNumber(rawEffects.temperature) ?? undefined,
			temperatureStrength: finiteNumber(rawEffects.temperatureStrength) ?? undefined,
			lutStrength: finiteNumber(rawEffects.lutStrength) ?? undefined,
			skinSmoothStrength: finiteNumber(rawEffects.skinSmoothStrength) ?? undefined
		}),
		// Older docs (schema ≤ 3) carry no transform; normalizeTransform fills identity.
		transform: normalizeTransform({
			x: finiteNumber(rawTransform.x) ?? undefined,
			y: finiteNumber(rawTransform.y) ?? undefined,
			scale: finiteNumber(rawTransform.scale) ?? undefined,
			rotation: finiteNumber(rawTransform.rotation) ?? undefined,
			opacity: finiteNumber(rawTransform.opacity) ?? undefined,
			anchorX: finiteNumber(rawTransform.anchorX) ?? undefined,
			anchorY: finiteNumber(rawTransform.anchorY) ?? undefined,
			fit
		}),
		audioFadeIn: Math.max(0, audioFadeIn),
		audioFadeOut: Math.max(0, audioFadeOut)
	};
	if (linkedGroupId) clip.linkedGroupId = linkedGroupId;
	if (keyframes) clip.keyframes = keyframes;
	if (lut) clip.lut = lut;
	if (isRecord(value.matte)) {
		const enabled = typeof value.matte.enabled === 'boolean' ? value.matte.enabled : true;
		const mode =
			value.matte.mode === 'replace' || value.matte.mode === 'blur' ? value.matte.mode : 'remove';
		// Model pin survives round-trip verbatim (P23); mismatches against the
		// deployed model surface a warning at load, never a silent switch.
		const modelKey =
			typeof value.matte.modelKey === 'string' ? value.matte.modelKey : 'mediapipe-selfie-general';
		const strength = finiteNumber(value.matte.strength);
		const blurRadius = finiteNumber(value.matte.blurRadius);
		clip.matte = {
			enabled,
			mode,
			modelKey,
			strength: strength !== null && strength >= 0 && strength <= 1 ? strength : 1.0,
			...(blurRadius !== null && blurRadius >= 0 ? { blurRadius: Math.min(64, blurRadius) } : {})
		};
	}
	const cleanedAudio = isTitle ? undefined : parseCleanedAudio(value.cleanedAudio);
	if (cleanedAudio) clip.cleanedAudio = cleanedAudio;
	// Phase 32a: parse optional skin-mask sidecar (normalize invalid values, don't reject).
	if (isRecord(value.skinMask)) {
		clip.skinMask = normalizeSkinMask({
			cbMin: finiteNumber(value.skinMask.cbMin) ?? undefined,
			cbMax: finiteNumber(value.skinMask.cbMax) ?? undefined,
			crMin: finiteNumber(value.skinMask.crMin) ?? undefined,
			crMax: finiteNumber(value.skinMask.crMax) ?? undefined,
			softness: finiteNumber(value.skinMask.softness) ?? undefined
		});
	}
	// Phase 35: parse optional time-remap sidecar (normalize invalid values, don't reject).
	const timeRemap = parseClipTimeRemap(value.timeRemap);
	if (timeRemap) clip.timeRemap = timeRemap;
	return clip;
}

function parseCaptionStyle(value: unknown): CaptionStyle | null {
	if (value === undefined || value === null) return normalizeCaptionStyle({});
	if (!isRecord(value)) return null;
	return normalizeCaptionStyle({
		// Accept any non-empty string as presetId — built-in IDs and custom
		// preset UUIDs are both valid. normalizeCaptionStyle handles unknown
		// IDs by falling back to the subtitle layout while preserving the ID.
		presetId:
			typeof value.presetId === 'string' && value.presetId.length > 0
				? (value.presetId as CaptionStyle['presetId'])
				: undefined,
		overrides: isRecord(value.overrides)
			? (value.overrides as Partial<CaptionTrackSnapshot['defaultStyle']['overrides']>)
			: undefined,
		anchor:
			value.anchor === 'bottom-center' ||
			value.anchor === 'bottom-left' ||
			value.anchor === 'bottom-right' ||
			value.anchor === 'top-center' ||
			value.anchor === 'custom'
				? value.anchor
				: undefined,
		insetPx: isRecord(value.insetPx)
			? {
					x: finiteNumber(value.insetPx.x) ?? DEFAULT_CAPTION_STYLE.insetPx!.x,
					y: finiteNumber(value.insetPx.y) ?? DEFAULT_CAPTION_STYLE.insetPx!.y
				}
			: undefined,
		maxWidthPercent: finiteNumber(value.maxWidthPercent) ?? undefined,
		lineWrap:
			value.lineWrap === 'balanced' || value.lineWrap === 'greedy' ? value.lineWrap : undefined
	});
}

function parseCaptionSegment(value: unknown): CaptionSegment | null {
	if (!isRecord(value)) return null;
	const id = requiredString(value.id);
	const start = finiteNumber(value.start);
	const duration = finiteNumber(value.duration);
	const text = typeof value.text === 'string' ? value.text : null;
	if (!id || start === null || duration === null || duration <= 0 || start < 0 || text === null)
		return null;
	const style = parseCaptionStyle(value.style);
	if (style === null) return null;
	// Phase 30: karaoke word timings. Optional; round-tripped verbatim. Each
	// entry is normalised on the next normalizeCaptionSegment pass, so we only
	// need to reject malformed array entries here — anything non-array or
	// undefined collapses to `undefined`, which the segment validator already
	// tolerates.
	let words: CaptionSegment['words'];
	if (Array.isArray(value.words)) {
		const parsed: { text: string; startS: number; endS: number }[] = [];
		let allValid = true;
		for (const item of value.words) {
			if (!isRecord(item)) {
				allValid = false;
				break;
			}
			const wText = typeof item.text === 'string' ? item.text : null;
			const startS = finiteNumber(item.startS);
			const endS = finiteNumber(item.endS);
			if (wText === null || startS === null || endS === null) {
				allValid = false;
				break;
			}
			parsed.push({ text: wText, startS, endS });
		}
		if (allValid && parsed.length > 0) words = parsed;
	}
	return {
		id,
		start,
		duration,
		text,
		style: value.style === undefined || value.style === null ? undefined : style,
		...(words ? { words } : {})
	};
}

function parseCaptionTrack(value: unknown): CaptionTrack | null {
	if (!isRecord(value)) return null;
	const id = requiredString(value.id);
	const kind = value.kind === 'caption' ? value.kind : null;
	const name = typeof value.name === 'string' ? value.name : null;
	const language = optionalString(value.language);
	if (
		!id ||
		!kind ||
		name === null ||
		language === undefined ||
		typeof value.burnedIn !== 'boolean' ||
		typeof value.visible !== 'boolean' ||
		!Array.isArray(value.segments)
	) {
		return null;
	}
	const segments: CaptionSegment[] = [];
	for (const segment of value.segments) {
		const parsed = parseCaptionSegment(segment);
		if (!parsed) return null;
		segments.push(parsed);
	}
	const defaultStyle = parseCaptionStyle(value.defaultStyle);
	if (defaultStyle === null) return null;
	return createCaptionTrack({
		id,
		name,
		language: language ?? null,
		segments: sortCaptionSegments(segments),
		defaultStyle,
		burnedIn: value.burnedIn,
		visible: value.visible,
		generatedBy: optionalString(value.generatedBy) ?? null
	});
}

function parseCaptionTracks(value: unknown): CaptionTrack[] | null {
	if (value === undefined) return [];
	if (!Array.isArray(value)) return null;
	const tracks: CaptionTrack[] = [];
	for (const item of value) {
		const parsed = parseCaptionTrack(item);
		if (!parsed) return null;
		tracks.push(parsed);
	}
	return cloneCaptionTracksSnapshot(tracks);
}

function parseTrack(value: unknown): TimelineTrack | null {
	if (!isRecord(value)) return null;
	const id = requiredString(value.id);
	const type = value.type === 'video' || value.type === 'audio' ? value.type : null;
	const gain = finiteNumber(value.gain);
	const pan = finiteNumber(value.pan) ?? DEFAULT_TRACK_MIX.pan;
	if (
		!id ||
		!type ||
		gain === null ||
		gain < 0 ||
		pan < -1 ||
		pan > 1 ||
		typeof value.muted !== 'boolean' ||
		typeof value.solo !== 'boolean'
	) {
		return null;
	}
	if (!Array.isArray(value.clips)) return null;

	const clips: TimelineClip[] = [];
	for (const clip of value.clips) {
		const parsed = parseClip(clip);
		if (!parsed) return null;
		clips.push(parsed);
	}

	return {
		id,
		type,
		clips,
		gain,
		pan,
		muted: value.muted,
		solo: value.solo,
		locked: typeof value.locked === 'boolean' ? value.locked : DEFAULT_TRACK_MIX.locked,
		visible: typeof value.visible === 'boolean' ? value.visible : DEFAULT_TRACK_MIX.visible,
		syncLocked:
			typeof value.syncLocked === 'boolean' ? value.syncLocked : DEFAULT_TRACK_MIX.syncLocked,
		editTarget:
			typeof value.editTarget === 'boolean' ? value.editTarget : DEFAULT_TRACK_MIX.editTarget
	};
}

function parseTransitionKind(value: unknown): TimelineTransition['kind'] | null {
	return value === 'cross-dissolve' ||
		value === 'dip-to-black' ||
		value === 'wipe' ||
		value === 'slide'
		? value
		: null;
}

function parseTransitionParams(value: unknown): TimelineTransition['params'] | null {
	if (value === undefined || value === null) return {};
	if (!isRecord(value)) return null;
	if (value.direction === undefined || value.direction === null) return {};
	if (
		value.direction === 'left' ||
		value.direction === 'right' ||
		value.direction === 'up' ||
		value.direction === 'down'
	) {
		return { direction: value.direction };
	}
	return null;
}

function parseTransition(value: unknown): TimelineTransition | null {
	if (!isRecord(value)) return null;
	const id = requiredString(value.id);
	const trackId = requiredString(value.trackId);
	const fromClipId = requiredString(value.fromClipId);
	const toClipId = requiredString(value.toClipId);
	const durationS = finiteNumber(value.durationS);
	const kind = parseTransitionKind(value.kind);
	const params = parseTransitionParams(value.params);
	if (
		!id ||
		!trackId ||
		!fromClipId ||
		!toClipId ||
		durationS === null ||
		durationS <= 0 ||
		!kind ||
		!params
	) {
		return null;
	}
	return {
		id,
		trackId,
		fromClipId,
		toClipId,
		durationS,
		kind,
		params
	};
}

function parseTransitions(value: unknown): TimelineTransition[] | null {
	if (value === undefined) return [];
	if (!Array.isArray(value)) return null;
	const transitions: TimelineTransition[] = [];
	for (const transition of value) {
		const parsed = parseTransition(transition);
		if (!parsed) return null;
		transitions.push(parsed);
	}
	return cloneTransitionsSnapshot(transitions);
}

function parseMarker(value: unknown): TimelineMarker | null {
	if (!isRecord(value)) return null;
	const id = requiredString(value.id);
	const time = finiteNumber(value.time);
	const label = typeof value.label === 'string' ? value.label : null;
	if (!id || time === null || time < 0 || label === null) return null;
	return { id, time, label };
}

function parseFingerprint(value: unknown): SourceDescriptor['fingerprint'] | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isRecord(value)) return undefined;
	if (value.algorithm !== 'sha-256') return undefined;
	const digest = requiredString(value.digest);
	if (!digest || !/^[a-f0-9]{64}$/.test(digest)) return undefined;
	return { algorithm: 'sha-256', digest };
}

function parseFrameRateMode(value: unknown): SourceFrameRateModeSnapshot | undefined {
	return value === 'constant' || value === 'variable' || value === 'unknown' ? value : undefined;
}

function parseColor(value: unknown): SourceColorHintsSnapshot | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) return undefined;
	const primaries = optionalString(value.primaries);
	const transfer = optionalString(value.transfer);
	const matrix = optionalString(value.matrix);
	const fullRange =
		value.fullRange === null || typeof value.fullRange === 'boolean' ? value.fullRange : undefined;
	if (
		primaries === undefined ||
		transfer === undefined ||
		matrix === undefined ||
		fullRange === undefined
	) {
		return undefined;
	}
	return {
		primaries: primaries ?? null,
		transfer: transfer ?? null,
		matrix: matrix ?? null,
		fullRange
	};
}

function parseTrackTiming(value: unknown): SourceTrackTimingSnapshot | undefined {
	if (!isRecord(value)) return undefined;
	const trackId = requiredString(value.trackId);
	const firstTimestampS = finiteNumber(value.firstTimestampS);
	const lastTimestampS = value.lastTimestampS === null ? null : finiteNumber(value.lastTimestampS);
	const durationS = value.durationS === null ? null : finiteNumber(value.durationS);
	if (
		!trackId ||
		firstTimestampS === null ||
		lastTimestampS === undefined ||
		durationS === undefined
	) {
		return undefined;
	}
	return {
		trackId,
		firstTimestampS,
		lastTimestampS,
		durationS
	};
}

function parseTiming(value: unknown): NormalizedSourceTimingSnapshot | undefined {
	if (isRecord(value)) {
		const normalizedStartS = finiteNumber(value.normalizedStartS);
		const duration = finiteNumber(value.durationS);
		const avOffsetS = finiteNumber(value.avOffsetS);
		const frameRateMode = parseFrameRateMode(value.frameRateMode);
		if (normalizedStartS !== null && duration !== null && avOffsetS !== null && frameRateMode) {
			return {
				normalizedStartS,
				durationS: duration,
				video: value.video === undefined ? undefined : parseTrackTiming(value.video),
				audio: value.audio === undefined ? undefined : parseTrackTiming(value.audio),
				avOffsetS,
				frameRateMode
			};
		}
	}
	return undefined;
}

function parseWarningCode(value: unknown): SourceHealthWarningSnapshot['code'] | null {
	return value === 'variable-frame-rate' ||
		value === 'non-zero-track-start' ||
		value === 'audio-video-offset' ||
		value === 'rotation-metadata' ||
		value === 'mixed-audio-sample-rates' ||
		value === 'unsupported-video-codec' ||
		value === 'unsupported-audio-codec' ||
		value === 'corrupt-or-truncated-file' ||
		value === 'missing-duration' ||
		value === 'undecodable-track'
		? value
		: null;
}

function parseWarningDetails(value: unknown): SourceHealthWarningSnapshot['details'] {
	if (!isRecord(value)) return {};
	const details: SourceHealthWarningSnapshot['details'] = {};
	for (const [key, entry] of Object.entries(value)) {
		if (
			typeof entry === 'string' ||
			typeof entry === 'number' ||
			typeof entry === 'boolean' ||
			entry === null
		) {
			details[key] = entry;
		}
	}
	return details;
}

function parseHealthWarning(value: unknown): SourceHealthWarningSnapshot | null {
	if (!isRecord(value)) return null;
	const code = parseWarningCode(value.code);
	const severity =
		value.severity === 'info' || value.severity === 'warning' || value.severity === 'error'
			? value.severity
			: null;
	const sourceId = requiredString(value.sourceId);
	const trackId = optionalString(value.trackId);
	const message = requiredString(value.message);
	if (
		!code ||
		!severity ||
		!sourceId ||
		trackId === undefined ||
		!message ||
		typeof value.blocking !== 'boolean'
	) {
		return null;
	}
	return {
		code,
		severity,
		blocking: value.blocking,
		sourceId,
		trackId: trackId ?? undefined,
		message,
		details: parseWarningDetails(value.details)
	};
}

function parseHealthReport(
	value: unknown,
	sourceId: string,
	fileName: string
): SourceHealthReportSnapshot | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) return undefined;
	const status =
		value.status === 'ok' || value.status === 'warnings' || value.status === 'blocked'
			? value.status
			: null;
	if (!status || !Array.isArray(value.warnings)) return undefined;
	const warnings: SourceHealthWarningSnapshot[] = [];
	for (const warning of value.warnings) {
		const parsed = parseHealthWarning(warning);
		if (parsed) warnings.push(parsed);
	}
	return {
		sourceId,
		fileName,
		status,
		warnings
	};
}

function parseMarkers(value: unknown): TimelineMarker[] | null {
	if (value === undefined) return [];
	if (!Array.isArray(value)) return null;
	const markers: TimelineMarker[] = [];
	for (const marker of value) {
		const parsed = parseMarker(marker);
		if (!parsed) return null;
		markers.push(parsed);
	}
	return cloneMarkersSnapshot(markers);
}

export function parseSourceDescriptor(value: unknown): SourceDescriptor | null {
	if (!isRecord(value)) return null;
	const sourceId = requiredString(value.sourceId);
	const fileName = requiredString(value.fileName);
	const byteSize = finiteNumber(value.byteSize);
	const durationS = finiteNumber(value.durationS);
	const mimeType = optionalString(value.mimeType);
	if (!sourceId || !fileName || byteSize === null || durationS === null || mimeType === undefined) {
		return null;
	}
	if (byteSize < 0 || durationS < 0) return null;

	let video: SourceDescriptor['video'];

	const hasVideoBlock = value.video !== undefined && value.video !== null;
	if (value.video !== undefined) {
		if (!isRecord(value.video)) return null;
		const width = finiteNumber(value.video.width);
		const height = finiteNumber(value.video.height);
		const frameRate = value.video.frameRate === null ? null : finiteNumber(value.video.frameRate);
		const codec = optionalString(value.video.codec);
		const codedWidth = finiteNumber(value.video.codedWidth) ?? undefined;
		const codedHeight = finiteNumber(value.video.codedHeight) ?? undefined;
		const frameRateMode = parseFrameRateMode(value.video.frameRateMode);
		const rotationDeg = finiteNumber(value.video.rotationDeg) ?? undefined;
		const color = parseColor(value.video.color);
		const trackStartS = finiteNumber(value.video.trackStartS) ?? undefined;
		const trackDurationS =
			value.video.trackDurationS === null
				? null
				: (finiteNumber(value.video.trackDurationS) ?? undefined);
		if (
			width === null ||
			height === null ||
			frameRate === undefined ||
			codec === undefined ||
			typeof value.video.canDecode !== 'boolean'
		) {
			return null;
		}
		video = {
			width,
			height,
			codedWidth,
			codedHeight,
			frameRate,
			frameRateMode,
			rotationDeg,
			color,
			trackStartS,
			trackDurationS,
			codec,
			canDecode: value.video.canDecode
		};
	}

	let audio: SourceDescriptor['audio'];
	if (value.audio !== undefined) {
		if (!isRecord(value.audio)) return null;
		const channels = finiteNumber(value.audio.channels);
		const sampleRate = finiteNumber(value.audio.sampleRate);
		const codec = optionalString(value.audio.codec);
		const trackStartS = finiteNumber(value.audio.trackStartS) ?? undefined;
		const trackDurationS =
			value.audio.trackDurationS === null
				? null
				: (finiteNumber(value.audio.trackDurationS) ?? undefined);
		if (
			channels === null ||
			sampleRate === null ||
			codec === undefined ||
			typeof value.audio.canDecode !== 'boolean'
		) {
			return null;
		}
		audio = {
			channels,
			sampleRate,
			trackStartS,
			trackDurationS,
			codec,
			canDecode: value.audio.canDecode
		};
	}

	const kind =
		value.kind === 'video' || value.kind === 'image' || value.kind === 'audio'
			? value.kind
			: hasVideoBlock
				? 'video'
				: 'audio';
	const adapterId =
		value.adapterId === 'mediabunny' || value.adapterId === 'web-demuxer-diagnostics'
			? value.adapterId
			: undefined;
	const timing = parseTiming(value.timing);
	const health = parseHealthReport(value.health, sourceId, fileName);
	const fingerprint = parseFingerprint(value.fingerprint);

	return {
		sourceId,
		fileName,
		kind,
		byteSize,
		durationS,
		mimeType,
		fingerprint,
		adapterId,
		timing,
		health,
		video,
		audio
	};
}

function deserializeV1(value: Record<string, unknown>): DeserializeProjectResult {
	const projectId = requiredString(value.projectId);
	const savedAt = requiredString(value.savedAt);
	if (!projectId || !savedAt) {
		return { ok: false, reason: 'Project is missing projectId or savedAt.' };
	}
	if (!Array.isArray(value.timeline)) {
		return { ok: false, reason: 'Project timeline is not an array.' };
	}
	if (!Array.isArray(value.sources)) {
		return { ok: false, reason: 'Project sources are not an array.' };
	}

	const timeline: Timeline = [];
	for (const track of value.timeline) {
		const parsed = parseTrack(track);
		if (!parsed)
			return { ok: false, reason: 'Project timeline contains an invalid track or clip.' };
		timeline.push(parsed);
	}

	const sources: SourceDescriptor[] = [];
	for (const source of value.sources) {
		const parsed = parseSourceDescriptor(source);
		if (!parsed) return { ok: false, reason: 'Project sources contain an invalid descriptor.' };
		sources.push(parsed);
	}

	const exportSettings = parseExportSettings(value.exportSettings);
	const masterGain = finiteNumber(value.masterGain) ?? DEFAULT_MASTER_GAIN;

	return {
		ok: true,
		doc: {
			schemaVersion: PROJECT_SCHEMA_VERSION,
			projectId,
			savedAt,
			timeline,
			captionTracks: [],
			transitions: [],
			markers: [],
			sources,
			masterGain: Math.max(0, masterGain),
			...(exportSettings ? { exportSettings } : {})
		}
	};
}

function deserializeV2(value: Record<string, unknown>): DeserializeProjectResult {
	const result = deserializeV1(value);
	if (!result.ok) return result;
	const markers = parseMarkers(value.markers);
	if (!markers) return { ok: false, reason: 'Project markers are invalid.' };
	return {
		ok: true,
		doc: {
			...result.doc,
			markers
		}
	};
}

function deserializeV5(value: Record<string, unknown>): DeserializeProjectResult {
	const result = deserializeV2(value);
	if (!result.ok) return result;
	const transitions = parseTransitions(value.transitions);
	if (!transitions) return { ok: false, reason: 'Project transitions are invalid.' };
	return {
		ok: true,
		doc: {
			...result.doc,
			transitions
		}
	};
}

function deserializeV6(value: Record<string, unknown>): DeserializeProjectResult {
	// v6+ additions are parsed by the shared clip/source parsers; no separate
	// migration step is needed beyond the v5 transition path.
	return deserializeV5(value);
}

function deserializeV9(value: Record<string, unknown>): DeserializeProjectResult {
	const result = deserializeV6(value);
	if (!result.ok) return result;
	const captionTracks = parseCaptionTracks(value.captionTracks);
	if (!captionTracks) return { ok: false, reason: 'Project caption tracks are invalid.' };
	return {
		ok: true,
		doc: {
			...result.doc,
			schemaVersion: PROJECT_SCHEMA_VERSION,
			captionTracks
		}
	};
}

function parseExportPresets(value: unknown): ExportPresetDoc[] {
	if (!Array.isArray(value)) return [];
	const result: ExportPresetDoc[] = [];
	for (const item of value) {
		const parsed = parseExportPresetDoc(item);
		if (parsed && !parsed.builtIn) result.push(parsed);
	}
	return result;
}

function parsePersistedQueueHistory(value: unknown): PersistedQueueJob[] {
	if (!Array.isArray(value)) return [];
	const result: PersistedQueueJob[] = [];
	for (const item of value) {
		if (!item || typeof item !== 'object') continue;
		const v = item as Record<string, unknown>;
		const id = typeof v.id === 'string' ? v.id : null;
		if (!id) continue;
		const status = v.status as PersistedQueueJob['status'];
		const validStatuses = [
			'pending',
			'choosing-destination',
			'running',
			'finalizing',
			'completed',
			'failed',
			'canceled'
		];
		if (!validStatuses.includes(status)) continue;
		const settings = parseExportSettingsForQueue(v.settings);
		if (!settings) continue;
		const jobRange = parseJobRange(v.jobRange);
		if (!jobRange) continue;
		result.push({
			id,
			presetId: typeof v.presetId === 'string' ? v.presetId : null,
			settings,
			jobRange,
			outputTemplate: typeof v.outputTemplate === 'string' ? v.outputTemplate : null,
			outputFileName: typeof v.outputFileName === 'string' ? v.outputFileName : null,
			status,
			error: typeof v.error === 'string' ? v.error : null,
			enqueuedAt: typeof v.enqueuedAt === 'string' ? v.enqueuedAt : new Date().toISOString(),
			startedAt: typeof v.startedAt === 'string' ? v.startedAt : null,
			completedAt: typeof v.completedAt === 'string' ? v.completedAt : null,
			elapsedSeconds: typeof v.elapsedSeconds === 'number' ? v.elapsedSeconds : null,
			outputBytes: typeof v.outputBytes === 'number' ? v.outputBytes : null
		});
	}
	return result;
}

function parseJobRange(value: unknown): PersistedQueueJob['jobRange'] | null {
	if (!value || typeof value !== 'object') return null;
	const v = value as Record<string, unknown>;
	if (v.mode === 'full') return { mode: 'full' };
	if (v.mode === 'range') {
		const startS = typeof v.startS === 'number' ? v.startS : null;
		const endS = typeof v.endS === 'number' ? v.endS : null;
		if (startS === null || endS === null || endS <= startS) return null;
		return { mode: 'range', startS, endS };
	}
	if (v.mode === 'markers') {
		const startMarkerId = typeof v.startMarkerId === 'string' ? v.startMarkerId : null;
		const endMarkerId = typeof v.endMarkerId === 'string' ? v.endMarkerId : null;
		const resolvedStartS = typeof v.resolvedStartS === 'number' ? v.resolvedStartS : null;
		const resolvedEndS = typeof v.resolvedEndS === 'number' ? v.resolvedEndS : null;
		if (!startMarkerId || !endMarkerId || resolvedStartS === null || resolvedEndS === null)
			return null;
		return { mode: 'markers', startMarkerId, endMarkerId, resolvedStartS, resolvedEndS };
	}
	return null;
}

function parseExportSettingsForQueue(value: unknown): ExportSettings | null {
	if (!value || typeof value !== 'object') return null;
	const v = value as Record<string, unknown>;
	const preset = v.preset;
	if (preset !== 'quality' && preset !== 'fast') return null;
	const codec = v.codec;
	if (codec !== 'h264' && codec !== 'vp9' && codec !== 'av1') return null;
	const container = v.container;
	if (container !== 'mp4' && container !== 'webm') return null;
	const width = typeof v.width === 'number' && Number.isFinite(v.width) ? v.width : null;
	const height = typeof v.height === 'number' && Number.isFinite(v.height) ? v.height : null;
	const fps = typeof v.fps === 'number' && Number.isFinite(v.fps) ? v.fps : null;
	const videoBitrate =
		typeof v.videoBitrate === 'number' && Number.isFinite(v.videoBitrate) ? v.videoBitrate : null;
	if (width === null || height === null || fps === null || videoBitrate === null) return null;
	let range: ExportSettings['range'];
	if (v.range && typeof v.range === 'object') {
		const r = v.range as Record<string, unknown>;
		const startS = typeof r.startS === 'number' ? r.startS : null;
		const endS = typeof r.endS === 'number' ? r.endS : null;
		if (startS !== null && endS !== null) range = { startS, endS };
	}
	return { preset, codec, container, width, height, fps, videoBitrate, range };
}

function parseRingBufferConfig(value: unknown): RingBufferConfig | undefined {
	if (!isRecord(value)) return undefined;
	const maxDurationS = finiteNumber(value.maxDurationS);
	const maxMemoryBytes = finiteNumber(value.maxMemoryBytes);
	const saveDurationS = finiteNumber(value.saveDurationS);
	if (maxDurationS === null || maxMemoryBytes === null || saveDurationS === null) {
		return undefined;
	}
	if (maxDurationS <= 0 || maxMemoryBytes <= 0 || saveDurationS <= 0) return undefined;
	return { maxDurationS, maxMemoryBytes, saveDurationS };
}

function parseInsertNumbers<K extends string>(
	value: unknown,
	keys: readonly K[]
): ({ bypass: boolean } & Record<K, number>) | undefined {
	if (!isRecord(value) || typeof value.bypass !== 'boolean') return undefined;
	const out = { bypass: value.bypass } as { bypass: boolean } & Record<K, number>;
	for (const key of keys) {
		const num = finiteNumber(value[key]);
		if (num === null) return undefined;
		out[key] = num as ({ bypass: boolean } & Record<K, number>)[K];
	}
	return out;
}

function parseLiveAudioChainConfig(value: unknown): LiveAudioChainConfig | undefined {
	if (!isRecord(value)) return undefined;
	const gate = parseInsertNumbers(value.gate, [
		'thresholdDb',
		'rangeDb',
		'attackMs',
		'holdMs',
		'releaseMs'
	]);
	const compressor = parseInsertNumbers(value.compressor, [
		'thresholdDb',
		'ratio',
		'attackMs',
		'releaseMs',
		'kneeDb',
		'makeupGainDb'
	]);
	const limiter = parseInsertNumbers(value.limiter, ['ceilingDb', 'attackUs', 'releaseMs']);
	if (!gate || !compressor || !limiter) return undefined;
	if (typeof value.denoiserBypass !== 'boolean' || typeof value.printToRecording !== 'boolean') {
		return undefined;
	}
	return {
		gate,
		compressor,
		limiter,
		denoiserBypass: value.denoiserBypass,
		printToRecording: value.printToRecording
	};
}

function parseVoiceCleanupSettings(value: unknown): VoiceCleanupSettings | undefined {
	if (!isRecord(value)) return undefined;
	const gateParams = parseInsertNumbers(value.gateParams, [
		'thresholdDb',
		'rangeDb',
		'attackMs',
		'holdMs',
		'releaseMs'
	]);
	const limiterParams = parseInsertNumbers(value.limiterParams, [
		'ceilingDb',
		'attackUs',
		'releaseMs'
	]);
	if (!gateParams || !limiterParams) return undefined;
	const normalisationTargetLufs = finiteNumber(value.normalisationTargetLufs);
	const normaliseGainDb = finiteNumber(value.normaliseGainDb);
	const limiterCeilingDbtp = finiteNumber(value.limiterCeilingDbtp);
	if (normalisationTargetLufs === null || normaliseGainDb === null || limiterCeilingDbtp === null)
		return undefined;
	let denoiserEnabledTracks: string[] = DEFAULT_VOICE_CLEANUP_SETTINGS.denoiserEnabledTracks;
	if (Array.isArray(value.denoiserEnabledTracks)) {
		denoiserEnabledTracks = value.denoiserEnabledTracks.filter(
			(t): t is string => typeof t === 'string'
		);
	}
	return {
		denoiserEnabledTracks,
		normalisationTargetLufs,
		normaliseGainDb,
		limiterCeilingDbtp,
		gateParams,
		limiterParams
	};
}

function deserializeV10(value: Record<string, unknown>): DeserializeProjectResult {
	const result = deserializeV9(value);
	if (!result.ok) return result;
	const exportPresets = parseExportPresets(value.exportPresets);
	const renderQueueHistory = parsePersistedQueueHistory(value.renderQueueHistory);
	return {
		ok: true,
		doc: {
			...result.doc,
			schemaVersion: PROJECT_SCHEMA_VERSION,
			exportPresets: exportPresets.length > 0 ? exportPresets : undefined,
			renderQueueHistory: renderQueueHistory.length > 0 ? renderQueueHistory : undefined,
			// v11 (Phase 46): optional configs; invalid/absent values fall back to
			// factory defaults at the consumer, so v10 docs parse unchanged.
			replayBufferConfig: parseRingBufferConfig(value.replayBufferConfig),
			liveAudioChainConfig: parseLiveAudioChainConfig(value.liveAudioChainConfig)
		}
	};
}

/** Parse customAnimCaptionPresets from a raw project document. */
function parseCustomAnimCaptionPresets(value: unknown): CaptionAnimStylePreset[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const presets: CaptionAnimStylePreset[] = [];
	for (const item of value) {
		const result = validateCaptionAnimPreset(item);
		// validateCaptionAnimPreset preserves the raw `id` (a non-empty string)
		// because `segment.style.presetId` references it. Drop entries whose id
		// failed validation — the validator yields `''` for raw records missing
		// the field, and a preset without an id can't be looked up.
		if (!result.ok || result.value.id.length === 0) continue;
		presets.push(result.value);
	}
	return presets.length > 0 ? presets : undefined;
}

function parseBeatSettings(
	value: unknown
): { enabledSourceIds: string[]; globalOffsetMs: number } | undefined {
	if (!isRecord(value)) return undefined;
	const enabledSourceIds = Array.isArray(value.enabledSourceIds)
		? (value.enabledSourceIds as unknown[]).filter((s): s is string => typeof s === 'string')
		: [];
	let globalOffsetMs = finiteNumber(value.globalOffsetMs) ?? 0;
	globalOffsetMs = Math.max(-500, Math.min(500, globalOffsetMs));
	return { enabledSourceIds, globalOffsetMs };
}

function deserializeV13(value: Record<string, unknown>): DeserializeProjectResult {
	const result = deserializeV10(value);
	if (!result.ok) return result;
	// v13 (Phase 30): optional customAnimCaptionPresets; absent/invalid → undefined.
	const customPresets = parseCustomAnimCaptionPresets(value.customAnimCaptionPresets);
	// Phase 34: optional beatSettings; absent/invalid → default.
	const beatSettings = parseBeatSettings(value.beatSettings);
	return {
		ok: true,
		doc: {
			...result.doc,
			schemaVersion: PROJECT_SCHEMA_VERSION,
			customAnimCaptionPresets: customPresets,
			beatSettings
		}
	};
}

function deserializeV14(value: Record<string, unknown>): DeserializeProjectResult {
	const result = deserializeV13(value);
	if (!result.ok) return result;
	// v14 (Phase 36): adds optional voiceCleanup on top of v13. Invalid/absent
	// falls back to DEFAULT_VOICE_CLEANUP_SETTINGS at the consumer, so v10-v13
	// docs parse unchanged.
	return {
		ok: true,
		doc: {
			...result.doc,
			schemaVersion: PROJECT_SCHEMA_VERSION,
			voiceCleanup: parseVoiceCleanupSettings(value.voiceCleanup)
		}
	};
}

export function deserializeProject(value: unknown): DeserializeProjectResult {
	if (!isRecord(value)) return { ok: false, reason: 'Project document is not an object.' };
	const schemaVersion = finiteNumber(value.schemaVersion);
	if (schemaVersion === null)
		return { ok: false, reason: 'Project document is missing schemaVersion.' };

	switch (schemaVersion) {
		case 1:
			return deserializeV1(value);
		case 2:
		case 3:
		case 4:
			// v3 adds `kind` to source descriptors; v4 adds per-clip transforms.
			// parseSourceDescriptor infers `kind` and parseClip fills an identity
			// transform for older docs, so the v2 parse path handles all three.
			return deserializeV2(value);
		case 5:
		case 6:
		case 7:
		case 8:
			// v6 adds title/keyframe/LUT clip sidecars; v7 adds Phase 18 source
			// conformance fields; v8 adds Phase 20 track state + linked clips.
			// Shared parsers handle all while v5 keeps transition parsing.
			return deserializeV6(value);
		case 9:
			return deserializeV9(value);
		case 10:
		case 11:
		case 12:
			// v11 adds replayBufferConfig + liveAudioChainConfig (Phase 46).
			// v12 adds skinSmoothStrength + skinMask (Phase 32a).
			// Both fields are optional with factory defaults; v10/v11 docs deserialize fine.
			return deserializeV10(value);
		case 13:
			// v13 (Phase 30): adds customAnimCaptionPresets (optional; absent in
			// v10/v11/v12). Originally targeted v12, but Phase 32a (Skin Smoothing)
			// claimed v12 first, so Phase 30 ships as v13.
			return deserializeV13(value);
		case 14:
		case 15:
		case 16:
			// v14 (Phase 36): adds optional voiceCleanup on top of v13.
			// v15 (Phase 31): adds the optional per-clip `matte` (mode/strength/
			// blurRadius), handled by the shared clip parser, on top of v14 — so
			// deserializeV14 covers both (matte is parsed if present at any version).
			// v16 (Phase 35): adds optional per-clip `timeRemap`, handled by the
			// shared clip parser (absent = identity speed).
			return deserializeV14(value);
		default:
			return { ok: false, reason: `Unsupported project schemaVersion ${schemaVersion}.` };
	}
}

export function sourceDescriptorMatchesCandidate(
	descriptor: SourceDescriptor,
	candidate: SourceMatchCandidate
): boolean {
	return sourceDescriptorMismatchReasons(descriptor, candidate).length === 0;
}

function closeEnough(
	a: number | null | undefined,
	b: number | null | undefined,
	tolerance: number
): boolean {
	if (a === undefined || b === undefined) return true;
	if (a === null || b === null) return a === b;
	return Math.abs(a - b) <= tolerance;
}

function timingMatches(descriptor: SourceDescriptor, candidate: SourceMatchCandidate): boolean {
	if (!descriptor.timing || !candidate.timing) return true;
	return (
		closeEnough(
			descriptor.timing.normalizedStartS,
			candidate.timing.normalizedStartS,
			TIMING_MATCH_TOLERANCE_S
		) &&
		closeEnough(
			descriptor.timing.video?.firstTimestampS,
			candidate.timing.video?.firstTimestampS,
			TIMING_MATCH_TOLERANCE_S
		) &&
		closeEnough(
			descriptor.timing.audio?.firstTimestampS,
			candidate.timing.audio?.firstTimestampS,
			TIMING_MATCH_TOLERANCE_S
		) &&
		closeEnough(descriptor.timing.avOffsetS, candidate.timing.avOffsetS, TIMING_MATCH_TOLERANCE_S)
	);
}

export function sourceDescriptorMismatchReasons(
	descriptor: SourceDescriptor,
	candidate: SourceMatchCandidate
): string[] {
	const reasons: string[] = [];
	if (descriptor.fileName !== candidate.fileName) reasons.push('name');
	if (descriptor.byteSize !== candidate.byteSize) reasons.push('size');
	if (Math.abs(descriptor.durationS - candidate.durationS) > DURATION_MATCH_TOLERANCE_S)
		reasons.push('duration');
	if (!timingMatches(descriptor, candidate)) reasons.push('track timing');
	if (descriptor.video?.rotationDeg !== undefined && candidate.video?.rotationDeg !== undefined) {
		if (descriptor.video.rotationDeg !== candidate.video.rotationDeg) reasons.push('rotation');
	}
	if (descriptor.audio && candidate.audio) {
		if (descriptor.audio.sampleRate !== candidate.audio.sampleRate)
			reasons.push('audio sample rate');
		if (descriptor.audio.channels !== candidate.audio.channels) reasons.push('audio channel count');
	}
	return reasons;
}
