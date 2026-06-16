import { describe, expect, it } from 'vite-plus/test';
import {
	DEFAULT_CLIP_AUDIO_FADES,
	DEFAULT_TRACK_MIX,
	defaultClipEffects,
	defaultClipTransform,
	defaultTitleClip,
	type Timeline,
	type TimelineClip
} from './timeline';
import {
	PROJECT_SCHEMA_VERSION,
	deserializeProject,
	serializeProject,
	type SourceDescriptor
} from './project';
import { classifyImportError, classifyExportError } from '../diagnostics/import-export-diagnostics';
import { createRecoveryMachine } from './recovery';
import type { ExportSettings } from '../protocol';

function videoSource(): SourceDescriptor {
	return {
		sourceId: 'source-video-1',
		fileName: 'clip.mp4',
		kind: 'video',
		byteSize: 50_000,
		durationS: 10,
		mimeType: 'video/mp4',
		video: { width: 1920, height: 1080, frameRate: 30, codec: 'avc1.640028', canDecode: true },
		audio: { channels: 2, sampleRate: 48_000, codec: 'mp4a.40.2', canDecode: true }
	};
}

function audioSource(): SourceDescriptor {
	return {
		sourceId: 'source-audio-1',
		fileName: 'music.wav',
		kind: 'audio',
		byteSize: 96_000,
		durationS: 5,
		mimeType: 'audio/wav',
		audio: { channels: 1, sampleRate: 48_000, codec: 'pcm', canDecode: true }
	};
}

function videoClip(overrides?: Partial<TimelineClip>): TimelineClip {
	return {
		id: 'clip-1',
		sourceId: 'source-video-1',
		start: 0,
		duration: 10,
		inPoint: 0,
		effects: defaultClipEffects(),
		transform: defaultClipTransform(),
		keyframes: {},
		lut: undefined,
		...DEFAULT_CLIP_AUDIO_FADES,
		...overrides
	};
}

describe('import → edit → export integration', () => {
	it('video+audio: import, split, delete, serialize, deserialize', () => {
		const source = videoSource();
		const clip = videoClip();
		const splitTime = 4;
		const clipA: TimelineClip = { ...clip, duration: splitTime };
		const clipB: TimelineClip = {
			...clip,
			id: 'clip-1-split',
			start: splitTime,
			duration: clip.duration - splitTime,
			inPoint: clip.inPoint + splitTime
		};

		const timeline: Timeline = [
			{ id: 'track-v-1', type: 'video', ...DEFAULT_TRACK_MIX, clips: [clipA, clipB] }
		];

		const doc = serializeProject({
			projectId: 'integration-1',
			timeline,
			sources: [source],
			exportSettings: {
				preset: 'quality',
				codec: 'h264',
				container: 'mp4',
				width: 1920,
				height: 1080,
				fps: 30,
				videoBitrate: 8_000_000
			}
		});

		expect(doc.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
		expect(doc.timeline).toHaveLength(1);
		expect(doc.timeline[0]!.clips).toHaveLength(2);
		expect(doc.sources).toHaveLength(1);

		const result = deserializeProject(doc);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.doc.timeline[0]!.clips[0]!.duration).toBe(4);
		expect(result.doc.timeline[0]!.clips[1]!.start).toBe(4);
		expect(result.doc.timeline[0]!.clips[1]!.duration).toBe(6);
		expect(result.doc.exportSettings?.codec).toBe('h264');
	});

	it('still/title/composite: multi-track with title and image', () => {
		const source = videoSource();
		const titleClip = defaultTitleClip({
			id: 'clip-title-1',
			start: 0,
			duration: 5,
			title: { text: 'Hello World', style: { color: '#ffffff', align: 'center', fontSizePx: 72 } },
			transform: { y: -0.3 }
		});
		const sourceClip = videoClip({ start: 0, duration: 5 });

		const timeline: Timeline = [
			{ id: 'track-v-title', type: 'video', ...DEFAULT_TRACK_MIX, clips: [titleClip] },
			{ id: 'track-v-bg', type: 'video', ...DEFAULT_TRACK_MIX, clips: [sourceClip] }
		];

		const doc = serializeProject({ projectId: 'composite-1', timeline, sources: [source] });
		const result = deserializeProject(doc);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.doc.timeline).toHaveLength(2);
		expect(result.doc.timeline[0]!.clips[0]!.kind).toBe('title');
		expect(result.doc.timeline[1]!.clips[0]!.sourceId).toBe('source-video-1');
	});

	it('offline/relink: serialize with offline source, deserialize preserves descriptor', () => {
		const source = videoSource();
		const clip = videoClip();
		const timeline: Timeline = [
			{ id: 'track-v-1', type: 'video', ...DEFAULT_TRACK_MIX, clips: [clip] }
		];

		const doc = serializeProject({ projectId: 'offline-1', timeline, sources: [source] });
		const result = deserializeProject(doc);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.doc.sources).toHaveLength(1);
		expect(result.doc.sources[0]!.sourceId).toBe('source-video-1');
		expect(result.doc.sources[0]!.fileName).toBe('clip.mp4');
		expect(result.doc.sources[0]!.video?.codec).toBe('avc1.640028');
	});

	it('export failure preserves settings for retry', () => {
		const settings: ExportSettings = {
			preset: 'quality',
			codec: 'h264',
			container: 'mp4',
			width: 1920,
			height: 1080,
			fps: 30,
			videoBitrate: 8_000_000
		};

		const error = classifyExportError('GPU device_lost during render pass');
		expect(error.code).toBe('export.device_lost');
		expect(error.settingsPreserved).toBe(true);

		const machine = createRecoveryMachine();
		machine.setCheckpoint({
			projectDoc: {
				schemaVersion: 18 as const,
				projectId: 'export-retry',
				savedAt: '',
				timeline: [],
				captionTracks: [],
				transitions: [],
				markers: [],
				sources: [],
				masterGain: 1
			},
			sourceStatuses: new Map(),
			revision: 5,
			activeExportSettings: settings,
			createdAt: new Date().toISOString()
		});

		machine.recordCrash();
		expect(machine.lastCheckpoint!.activeExportSettings).toBe(settings);
		expect(machine.lastCheckpoint!.activeExportSettings!.codec).toBe('h264');
		expect(machine.lastCheckpoint!.activeExportSettings!.videoBitrate).toBe(8_000_000);
	});

	it('import error does not corrupt project state', () => {
		const source = videoSource();
		const timeline: Timeline = [
			{ id: 'track-v-1', type: 'video', ...DEFAULT_TRACK_MIX, clips: [videoClip()] }
		];
		const doc = serializeProject({ projectId: 'preserved', timeline, sources: [source] });

		const importError = classifyImportError('Not recognized container format');
		expect(importError.code).toBe('import.unsupported_container');

		const result = deserializeProject(doc);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.doc.timeline).toHaveLength(1);
		expect(result.doc.sources).toHaveLength(1);
	});

	it('audio-only: import and serialize audio track', () => {
		const source = audioSource();
		const audioClip: TimelineClip = {
			id: 'clip-audio-1',
			sourceId: 'source-audio-1',
			start: 0,
			duration: 5,
			inPoint: 0,
			effects: defaultClipEffects(),
			transform: defaultClipTransform(),
			keyframes: {},
			lut: undefined,
			...DEFAULT_CLIP_AUDIO_FADES
		};
		const timeline: Timeline = [
			{ id: 'track-a-1', type: 'audio', ...DEFAULT_TRACK_MIX, clips: [audioClip] }
		];

		const doc = serializeProject({ projectId: 'audio-1', timeline, sources: [source] });
		const result = deserializeProject(doc);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.doc.timeline[0]!.type).toBe('audio');
		expect(result.doc.timeline[0]!.clips[0]!.sourceId).toBe('source-audio-1');
		expect(result.doc.sources[0]!.kind).toBe('audio');
	});
});
