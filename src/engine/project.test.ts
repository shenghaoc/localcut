import { describe, expect, it } from 'vite-plus/test';
import {
	DEFAULT_CLIP_AUDIO_FADES,
	DEFAULT_TRACK_MIX,
	defaultClipEffects,
	defaultClipTransform,
	defaultTitleClip,
	type Timeline
} from './timeline';
import {
	PROJECT_SCHEMA_VERSION,
	deserializeProject,
	serializeProject,
	sourceDescriptorMatchesCandidate,
	sourceDescriptorMismatchReasons,
	type SourceDescriptor
} from './project';
import { deserializeQueueHistory } from './render-queue';

function timelineFixture(): Timeline {
	return [
		{
			id: 'track-video-source-1',
			type: 'video',
			...DEFAULT_TRACK_MIX,
			clips: [
				{
					id: 'clip-source-1',
					sourceId: 'source-1',
					start: 0,
					duration: 12,
					inPoint: 1.5,
					effects: { ...defaultClipEffects(), saturation: 1.2 },
					transform: { ...defaultClipTransform(), scale: 0.5, x: 0.1, fit: 'fit' },
					keyframes: {
						saturation: [
							{ t: 0, value: 1, easing: 'linear' },
							{ t: 4, value: 1.5, easing: 'ease' }
						]
					},
					lut: {
						key: 'grade.cube:128:1',
						fileName: 'grade.cube',
						title: 'Grade',
						size: 2,
						domainMin: [0, 0, 0],
						domainMax: [1, 1, 1],
						values: new Float32Array(24)
					},
					...DEFAULT_CLIP_AUDIO_FADES
				}
			]
		}
	];
}

function sourceFixture(): SourceDescriptor {
	return {
		sourceId: 'source-1',
		fileName: 'cutaway.mp4',
		kind: 'video',
		byteSize: 42_000,
		durationS: 12.04,
		mimeType: 'video/mp4',
		video: {
			width: 1920,
			height: 1080,
			frameRate: 29.97,
			codec: 'avc1.640028',
			canDecode: true
		},
		audio: {
			channels: 2,
			sampleRate: 48_000,
			codec: 'mp4a.40.2',
			canDecode: true
		}
	};
}

function conformedSourceFixture(): SourceDescriptor {
	const source = sourceFixture();
	return {
		...source,
		adapterId: 'mediabunny',
		timing: {
			normalizedStartS: 0,
			durationS: 12.04,
			video: { trackId: 'video-1', firstTimestampS: 0.42, lastTimestampS: 12.46, durationS: 12.04 },
			audio: { trackId: 'audio-1', firstTimestampS: 0, lastTimestampS: 12.04, durationS: 12.04 },
			avOffsetS: -0.42,
			frameRateMode: 'constant'
		},
		video: {
			...source.video!,
			codedWidth: 1920,
			codedHeight: 1080,
			frameRateMode: 'constant',
			rotationDeg: 90,
			color: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
			trackStartS: 0.42,
			trackDurationS: 12.04
		},
		audio: {
			...source.audio!,
			trackStartS: 0,
			trackDurationS: 12.04
		}
	};
}

describe('project serialization', () => {
	it('drops a malformed export range but keeps the other settings', () => {
		const result = deserializeProject({
			schemaVersion: PROJECT_SCHEMA_VERSION,
			projectId: 'project-1',
			savedAt: '2026-06-06T00:00:00.000Z',
			timeline: timelineFixture(),
			sources: [sourceFixture()],
			exportSettings: {
				preset: 'quality',
				codec: 'h264',
				container: 'mp4',
				width: 1920,
				height: 1080,
				fps: 30,
				videoBitrate: 8_000_000,
				range: { startS: 4, endS: 4 }
			}
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.doc.exportSettings).toEqual({
			preset: 'quality',
			codec: 'h264',
			container: 'mp4',
			width: 1920,
			height: 1080,
			fps: 30,
			videoBitrate: 8_000_000
		});
	});

	it('round-trips export settings when present', () => {
		const doc = serializeProject({
			projectId: 'project-1',
			timeline: timelineFixture(),
			sources: [sourceFixture()],
			exportSettings: {
				preset: 'fast',
				codec: 'vp9',
				container: 'webm',
				width: 1280,
				height: 720,
				fps: 24,
				videoBitrate: 4_000_000,
				range: { startS: 1, endS: 8 }
			}
		});

		const result = deserializeProject(doc);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.doc.exportSettings).toEqual(doc.exportSettings);
	});

	it('round-trips source-less title clips with text and style', () => {
		const title = defaultTitleClip({
			id: 'clip-title-1',
			start: 3,
			duration: 5,
			title: { text: 'Lower third', style: { color: '#ff0000', align: 'left', fontSizePx: 120 } },
			transform: { x: 0.1, y: -0.2 }
		});
		const timeline: Timeline = [
			{ id: 'track-video-1', type: 'video', ...DEFAULT_TRACK_MIX, clips: [title] }
		];

		const doc = serializeProject({ projectId: 'project-1', timeline, sources: [] });
		expect(doc.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);

		const result = deserializeProject(doc);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const restored = result.doc.timeline[0]!.clips[0]!;
		expect(restored.kind).toBe('title');
		expect(restored.sourceId).toBe('');
		expect(restored.title?.text).toBe('Lower third');
		expect(restored.title?.style.color).toBe('#ff0000');
		expect(restored.title?.style.align).toBe('left');
		expect(restored.title?.style.fontSizePx).toBe(120);
		expect(restored.transform.x).toBeCloseTo(0.1);
	});

	it('rejects a title clip whose title payload is missing', () => {
		const result = deserializeProject({
			schemaVersion: PROJECT_SCHEMA_VERSION,
			projectId: 'project-1',
			savedAt: new Date().toISOString(),
			timeline: [
				{
					id: 'track-video-1',
					type: 'video',
					...DEFAULT_TRACK_MIX,
					clips: [
						{ id: 'clip-title-1', kind: 'title', sourceId: '', start: 0, duration: 4, inPoint: 0 }
					]
				}
			],
			sources: []
		});
		expect(result.ok).toBe(false);
	});

	it('round-trips transition lists and rejects malformed entries', () => {
		const doc = serializeProject({
			projectId: 'project-1',
			timeline: timelineFixture(),
			transitions: [
				{
					id: 'transition-1',
					trackId: 'track-video-source-1',
					fromClipId: 'clip-a',
					toClipId: 'clip-b',
					durationS: 1.25,
					kind: 'slide',
					params: { direction: 'left' }
				}
			],
			sources: [sourceFixture()]
		});

		const result = deserializeProject(doc);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.doc.transitions).toEqual(doc.transitions);

		const invalidDuration = deserializeProject({
			...doc,
			transitions: [{ ...doc.transitions[0], durationS: 0 }]
		});
		expect(invalidDuration.ok).toBe(false);

		const invalidKind = deserializeProject({
			...doc,
			transitions: [{ ...doc.transitions[0], kind: 'zoom-blur' }]
		});
		expect(invalidKind.ok).toBe(false);

		const invalidParams = deserializeProject({
			...doc,
			transitions: [{ ...doc.transitions[0], params: { direction: 'diagonal' } }]
		});
		expect(invalidParams.ok).toBe(false);
	});

	it('round-trips a versioned project document', () => {
		const doc = serializeProject({
			projectId: 'project-1',
			timeline: timelineFixture(),
			markers: [{ id: 'marker-1', time: 4.5, label: 'Pull quote' }],
			sources: [sourceFixture()],
			masterGain: 0.85,
			savedAt: new Date('2026-06-06T00:00:00.000Z')
		});

		expect(doc.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
		const result = deserializeProject(doc);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.doc).toEqual(doc);
	});

	it('round-trips clip keyframes and LUT payloads', () => {
		const doc = serializeProject({
			projectId: 'project-1',
			timeline: timelineFixture(),
			sources: [sourceFixture()]
		});

		const result = deserializeProject(doc);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const clip = result.doc.timeline[0]!.clips[0]!;
		expect(clip.keyframes?.saturation).toEqual([
			{ t: 0, value: 1, easing: 'linear' },
			{ t: 4, value: 1.5, easing: 'ease' }
		]);
		expect(clip.lut?.fileName).toBe('grade.cube');
		expect(clip.lut?.values).toBeInstanceOf(Float32Array);
		expect(clip.lut?.values).toHaveLength(24);
	});

	it('round-trips per-clip transforms and fills identity for older docs', () => {
		const doc = serializeProject({
			projectId: 'project-1',
			timeline: timelineFixture(),
			sources: [sourceFixture()]
		});
		expect(doc.timeline[0]!.clips[0]!.transform).toMatchObject({ scale: 0.5, x: 0.1, fit: 'fit' });

		// A schema-3 clip carries no transform; deserialization must fill identity.
		const legacyClip = { ...doc.timeline[0]!.clips[0] } as Record<string, unknown>;
		delete legacyClip.transform;
		const result = deserializeProject({
			...doc,
			schemaVersion: 3,
			timeline: [{ ...doc.timeline[0], clips: [legacyClip] }]
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.doc.timeline[0]!.clips[0]!.transform).toMatchObject({
			x: 0,
			scale: 1,
			opacity: 1,
			fit: 'fill'
		});
	});

	it('upgrades v1 documents with absolute clip starts and empty markers', () => {
		const timeline = timelineFixture();
		timeline[0]!.clips[0]!.start = 7;
		const result = deserializeProject({
			schemaVersion: 1,
			projectId: 'project-legacy',
			savedAt: '2026-06-06T00:00:00.000Z',
			timeline,
			sources: [sourceFixture()],
			masterGain: 0.75
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.doc.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
		expect(result.doc.markers).toEqual([]);
		expect(result.doc.timeline[0]!.clips[0]!.start).toBe(7);
	});

	it('rejects malformed marker records', () => {
		const doc = serializeProject({
			projectId: 'project-1',
			timeline: timelineFixture(),
			sources: [sourceFixture()]
		});
		const result = deserializeProject({
			...doc,
			markers: [{ id: 'marker-1', time: -1, label: 'Bad' }]
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toContain('markers');
	});

	it('rejects unknown schema versions without throwing', () => {
		const result = deserializeProject({
			...serializeProject({
				projectId: 'project-1',
				timeline: timelineFixture(),
				sources: [sourceFixture()]
			}),
			schemaVersion: 99
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toContain('Unsupported project schemaVersion');
	});

	it('preserves active render queue statuses so restore can mark them failed', () => {
		const doc = serializeProject({
			projectId: 'project-queue',
			timeline: timelineFixture(),
			sources: [sourceFixture()],
			renderQueueHistory: [
				{
					id: 'job-running',
					presetId: null,
					settings: {
						preset: 'quality',
						codec: 'h264',
						container: 'mp4',
						width: 1920,
						height: 1080,
						fps: 30,
						videoBitrate: 10_000_000
					},
					jobRange: { mode: 'full' },
					outputTemplate: null,
					outputFileName: null,
					status: 'running',
					error: null,
					enqueuedAt: '2026-06-07T00:00:00.000Z',
					startedAt: '2026-06-07T00:00:01.000Z',
					completedAt: null,
					elapsedSeconds: null,
					outputBytes: null
				}
			]
		});

		const result = deserializeProject(doc);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.doc.renderQueueHistory?.[0]?.status).toBe('running');
		expect(deserializeQueueHistory(result.doc.renderQueueHistory ?? [])[0]?.status).toBe('failed');
	});

	it('rejects tracks with negative gain on load', () => {
		const doc = serializeProject({
			projectId: 'project-1',
			timeline: timelineFixture(),
			sources: [sourceFixture()]
		});
		const raw = {
			...doc,
			timeline: [{ ...doc.timeline[0]!, gain: -0.5 }]
		};
		const result = deserializeProject(raw);
		expect(result.ok).toBe(false);
	});

	it('defaults master gain when older project documents omit it', () => {
		const doc = serializeProject({
			projectId: 'project-1',
			timeline: timelineFixture(),
			sources: [sourceFixture()]
		});
		const { masterGain: _ignored, ...legacy } = doc;
		const result = deserializeProject(legacy);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.doc.masterGain).toBe(1);
	});

	it('normalizes missing effect fields when reading older-compatible v1 clips', () => {
		const doc = serializeProject({
			projectId: 'project-1',
			timeline: timelineFixture(),
			sources: [sourceFixture()]
		});
		const raw = {
			...doc,
			timeline: [
				{
					...doc.timeline[0],
					clips: [{ ...doc.timeline[0]!.clips[0], effects: { brightness: 0.4 } }]
				}
			]
		};

		const result = deserializeProject(raw);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.doc.timeline[0]!.clips[0]!.effects).toMatchObject({
			brightness: 0.4,
			contrast: 1,
			saturation: 1,
			temperature: 6500,
			temperatureStrength: 1,
			lutStrength: 0
		});
	});
});

describe('source descriptor matching', () => {
	it('matches by name, size, and duration tolerance', () => {
		const source = sourceFixture();
		expect(
			sourceDescriptorMatchesCandidate(source, {
				fileName: 'cutaway.mp4',
				byteSize: 42_000,
				durationS: 12.2
			})
		).toBe(true);
	});

	it('rejects relink candidates with mismatched identity metadata', () => {
		const source = sourceFixture();
		expect(
			sourceDescriptorMatchesCandidate(source, {
				fileName: 'cutaway-copy.mp4',
				byteSize: 42_000,
				durationS: 12.04
			})
		).toBe(false);
		expect(
			sourceDescriptorMatchesCandidate(source, {
				fileName: 'cutaway.mp4',
				byteSize: 41_999,
				durationS: 12.04
			})
		).toBe(false);
		expect(
			sourceDescriptorMatchesCandidate(source, {
				fileName: 'cutaway.mp4',
				byteSize: 42_000,
				durationS: 13
			})
		).toBe(false);
	});

	it('matches relink candidates with conformance metadata inside timing tolerance', () => {
		const source = conformedSourceFixture();
		expect(
			sourceDescriptorMatchesCandidate(source, {
				fileName: source.fileName,
				byteSize: source.byteSize,
				durationS: source.durationS + 0.1,
				video: source.video,
				audio: source.audio,
				timing: {
					...source.timing!,
					video: {
						...source.timing!.video!,
						firstTimestampS: source.timing!.video!.firstTimestampS + 0.04
					}
				}
			})
		).toBe(true);
	});

	it('does not fabricate timing for legacy descriptors without conformance metadata', () => {
		const legacy = sourceFixture();
		const doc = serializeProject({
			projectId: 'project-legacy',
			timeline: timelineFixture(),
			sources: [legacy],
			savedAt: new Date('2026-06-06T00:00:00.000Z')
		});
		const result = deserializeProject({ ...doc, schemaVersion: 6, sources: [legacy] });
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const restored = result.doc.sources[0]!;
		const candidate = conformedSourceFixture();
		expect(restored.timing).toBeUndefined();
		expect(
			sourceDescriptorMismatchReasons(restored, {
				fileName: legacy.fileName,
				byteSize: legacy.byteSize,
				durationS: legacy.durationS,
				video: candidate.video,
				audio: candidate.audio,
				timing: candidate.timing
			})
		).not.toContain('track timing');
	});

	it('rejects relink candidates with mismatched timing, rotation, or audio conformance', () => {
		const source = conformedSourceFixture();
		const candidate = {
			fileName: source.fileName,
			byteSize: source.byteSize,
			durationS: source.durationS,
			video: source.video,
			audio: source.audio,
			timing: source.timing
		};

		expect(
			sourceDescriptorMismatchReasons(source, {
				...candidate,
				timing: {
					...source.timing!,
					video: {
						...source.timing!.video!,
						firstTimestampS: source.timing!.video!.firstTimestampS + 0.2
					}
				}
			})
		).toContain('track timing');
		expect(
			sourceDescriptorMismatchReasons(source, {
				...candidate,
				video: { ...source.video!, rotationDeg: 0 }
			})
		).toContain('rotation');
		expect(
			sourceDescriptorMismatchReasons(source, {
				...candidate,
				audio: { ...source.audio!, sampleRate: 44_100 }
			})
		).toContain('audio sample rate');
		expect(
			sourceDescriptorMismatchReasons(source, {
				...candidate,
				audio: { ...source.audio!, channels: 1 }
			})
		).toContain('audio channel count');
	});
});

describe('Phase 46 config persistence (schema v11)', () => {
	const ringConfig = { maxDurationS: 60, maxMemoryBytes: 128 * 1024 * 1024, saveDurationS: 20 };
	const chainConfig = {
		gate: {
			bypass: false,
			thresholdDb: -42,
			rangeDb: -70,
			attackMs: 0.5,
			holdMs: 25,
			releaseMs: 80
		},
		compressor: {
			bypass: true,
			thresholdDb: -18,
			ratio: 3,
			attackMs: 4,
			releaseMs: 120,
			kneeDb: 9,
			makeupGainDb: 1.5
		},
		limiter: { bypass: false, ceilingDb: -0.5, attackUs: 80, releaseMs: 60 },
		denoiserBypass: true,
		printToRecording: true
	};

	it('round-trips replayBufferConfig and liveAudioChainConfig', () => {
		const doc = serializeProject({
			projectId: 'project-1',
			timeline: timelineFixture(),
			sources: [sourceFixture()],
			replayBufferConfig: ringConfig,
			liveAudioChainConfig: chainConfig
		});
		expect(doc.replayBufferConfig).toEqual(ringConfig);
		expect(doc.liveAudioChainConfig).toEqual(chainConfig);

		// Pass the doc object directly (matching the persistence path, which
		// structured-clones): the timeline fixture's LUT holds a Float32Array
		// that JSON.stringify would mangle.
		const result = deserializeProject(doc);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.doc.replayBufferConfig).toEqual(ringConfig);
		expect(result.doc.liveAudioChainConfig).toEqual(chainConfig);
	});

	it('omits the configs when not provided and parses v10 docs without them', () => {
		const doc = serializeProject({
			projectId: 'project-1',
			timeline: timelineFixture(),
			sources: [sourceFixture()]
		});
		expect(doc.replayBufferConfig).toBeUndefined();
		expect(doc.liveAudioChainConfig).toBeUndefined();

		const result = deserializeProject({ ...doc, schemaVersion: 10 });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.doc.replayBufferConfig).toBeUndefined();
		expect(result.doc.liveAudioChainConfig).toBeUndefined();
	});

	it('rejects malformed configs back to factory defaults (undefined)', () => {
		const doc = serializeProject({
			projectId: 'project-1',
			timeline: timelineFixture(),
			sources: [sourceFixture()],
			replayBufferConfig: ringConfig,
			liveAudioChainConfig: chainConfig
		});
		const result = deserializeProject({
			...doc,
			replayBufferConfig: { maxDurationS: -5, maxMemoryBytes: 1, saveDurationS: 1 },
			liveAudioChainConfig: { gate: { bypass: 'yes' } }
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.doc.replayBufferConfig).toBeUndefined();
		expect(result.doc.liveAudioChainConfig).toBeUndefined();
	});
});

describe('Phase 30 (v12) — customAnimCaptionPresets', () => {
	const baseDoc = () => ({
		schemaVersion: PROJECT_SCHEMA_VERSION,
		projectId: 'p1',
		savedAt: '2026-06-13T00:00:00.000Z',
		timeline: timelineFixture(),
		sources: [sourceFixture()],
		captionTracks: []
	});

	it('v12 document without customAnimCaptionPresets deserializes with undefined field', () => {
		const result = deserializeProject(baseDoc());
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.doc.customAnimCaptionPresets).toBeUndefined();
	});

	it('v12 document with a valid customAnimCaptionPresets array round-trips intact', () => {
		const preset = {
			captionStyleSchemaVersion: 1,
			id: 'custom-abc',
			label: 'My Preset',
			builtIn: false,
			anchor: 'bottom-center',
			maxWidthPercent: 80,
			lineWrap: 'balanced',
			titleStyle: {}
		};
		const result = deserializeProject({ ...baseDoc(), customAnimCaptionPresets: [preset] });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.doc.customAnimCaptionPresets).toHaveLength(1);
		// `id` is preserved from the persisted doc (segment.style.presetId references it).
		expect(result.doc.customAnimCaptionPresets![0]!.id).toBe('custom-abc');
		expect(result.doc.customAnimCaptionPresets![0]!.label).toBe('My Preset');
	});

	it('v12 document with invalid presets skips them gracefully', () => {
		const result = deserializeProject({
			...baseDoc(),
			customAnimCaptionPresets: [
				{ notAPreset: true },
				{
					captionStyleSchemaVersion: 1,
					id: 'valid',
					label: 'Valid',
					builtIn: false,
					anchor: 'bottom-center',
					maxWidthPercent: 80,
					lineWrap: 'balanced',
					titleStyle: {}
				}
			]
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		// Only the valid preset is kept.
		expect(result.doc.customAnimCaptionPresets).toHaveLength(1);
	});

	it('existing caption tracks and segments survive v12 deserialization', () => {
		const doc = {
			...baseDoc(),
			captionTracks: [
				{
					id: 'trk1',
					kind: 'caption',
					name: 'Track 1',
					language: null,
					visible: true,
					burnedIn: false,
					defaultStyle: {},
					segments: [{ id: 'seg1', start: 0, duration: 3, text: 'Hello world' }]
				}
			]
		};
		const result = deserializeProject(doc);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.doc.captionTracks).toHaveLength(1);
		expect(result.doc.captionTracks[0]!.segments[0]!.text).toBe('Hello world');
	});

	it('round-trips CaptionSegment.words through deserialize (karaoke timings survive reload)', () => {
		const doc = {
			...baseDoc(),
			captionTracks: [
				{
					id: 'trk1',
					kind: 'caption',
					name: 'Track 1',
					language: null,
					visible: true,
					burnedIn: false,
					defaultStyle: {},
					segments: [
						{
							id: 'seg1',
							start: 0,
							duration: 3,
							text: 'Hello world',
							words: [
								{ text: 'Hello', startS: 0.5, endS: 1.5 },
								{ text: 'world', startS: 1.5, endS: 2.5 }
							]
						}
					]
				}
			]
		};
		const result = deserializeProject(doc);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const segment = result.doc.captionTracks[0]!.segments[0]!;
		expect(segment.words).toBeDefined();
		expect(segment.words).toHaveLength(2);
		expect(segment.words![0]!.text).toBe('Hello');
		expect(segment.words![1]!.startS).toBe(1.5);
	});

	it('drops malformed words and keeps the segment otherwise valid', () => {
		const doc = {
			...baseDoc(),
			captionTracks: [
				{
					id: 'trk1',
					kind: 'caption',
					name: 'Track 1',
					language: null,
					visible: true,
					burnedIn: false,
					defaultStyle: {},
					segments: [
						{
							id: 'seg1',
							start: 0,
							duration: 3,
							text: 'Hello',
							words: [{ text: 'Hello', startS: 'nope', endS: 1 }]
						}
					]
				}
			]
		};
		const result = deserializeProject(doc);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.doc.captionTracks[0]!.segments[0]!.text).toBe('Hello');
		expect(result.doc.captionTracks[0]!.segments[0]!.words).toBeUndefined();
	});
});
