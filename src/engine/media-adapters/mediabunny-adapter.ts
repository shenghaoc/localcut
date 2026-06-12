import {
	AudioSampleSink,
	BlobSource,
	EncodedPacketSink,
	Input,
	MP3,
	MP4,
	OGG,
	QTFF,
	VideoSampleSink,
	WAVE,
	WEBM,
	type InputAudioTrack,
	type InputTrack,
	type InputVideoTrack
} from 'mediabunny';
import type { MediaKind, MediaMetadata } from '../../protocol';
import { SequentialAudioSource } from '../audio-source';
import { SequentialFrameSource } from '../frame-source';
import { StillFrameSource } from '../still-source';
import {
	WebCodecsVideoDecoder,
	WebCodecsAudioDecoder,
	normalizeH264CodecString
} from '../webcodecs-decoder';
import { buildNormalizedSourceTiming, resolveNormalizedSourceTimestamp } from './source-timing';
import { generateSourceHealthWarnings, reportFromWarnings } from './source-health';
import type {
	MediaAdapter,
	MediaAdapterInspectionResult,
	MediaAdapterOpenInput,
	MediaInputHandle,
	NormalizedSourceTiming,
	PrimaryMediaAdapterOpenResult,
	SourceAudioTrackInspection,
	SourceColorHints,
	SourceConformance,
	SourceContainerKind,
	SourceFrameRateMode,
	SourceHealthReport,
	SourceInspection,
	SourceTrackInspection,
	SourceVideoTrackInspection
} from './types';

const IMPORT_FORMATS = [MP4, QTFF, WEBM, MP3, OGG, WAVE];
const DEFAULT_FRAME_RATE = 30;
export const STILL_DEFAULT_DURATION_S = 5;
export const STILL_MAX_DURATION_S = 3600;
const STILL_FRAME_RATE = 30;
const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
const SAMPLE_PACKET_LIMIT = 40;

function isImageFile(file: File): boolean {
	return file.type.startsWith('image/') || IMAGE_EXTENSION.test(file.name);
}

function containerFromFile(file: File, mimeType: string | null): SourceContainerKind {
	const name = file.name.toLowerCase();
	const mime = (mimeType || file.type || '').toLowerCase();
	if (isImageFile(file)) return 'image';
	if (name.endsWith('.mov') || mime.includes('quicktime')) return 'mov';
	if (name.endsWith('.mp4') || name.endsWith('.m4a') || mime.includes('mp4')) return 'mp4';
	if (name.endsWith('.webm') || mime.includes('webm')) return 'webm';
	if (name.endsWith('.mp3') || mime.includes('mpeg')) return 'mp3';
	if (name.endsWith('.ogg') || mime.includes('ogg')) return 'ogg';
	if (name.endsWith('.wav') || mime.includes('wav')) return 'wav';
	return 'unknown';
}

async function trackStartAndDuration(
	track: InputTrack
): Promise<{ startS: number; durationS: number | null }> {
	const startS = await track.getFirstTimestamp().catch(() => 0);
	const metadataEnd = await track.getDurationFromMetadata({ skipLiveWait: true }).catch(() => null);
	const endS =
		metadataEnd ?? (await track.computeDuration({ skipLiveWait: true }).catch(() => null));
	return {
		startS,
		durationS: endS === null ? null : Math.max(0, endS - startS)
	};
}

async function detectFrameRateMode(
	track: InputVideoTrack,
	statsRate: number | null
): Promise<SourceFrameRateMode> {
	if (!statsRate || statsRate <= 0) return 'unknown';
	const sink = new EncodedPacketSink(track);
	const packets = sink.packets(undefined, undefined, { metadataOnly: true, skipLiveWait: true });
	const durations: number[] = [];
	let previousTimestamp: number | null = null;
	try {
		while (durations.length < SAMPLE_PACKET_LIMIT) {
			const next = await packets.next();
			if (next.done) break;
			const packet = next.value;
			if (previousTimestamp !== null) {
				const delta = packet.timestamp - previousTimestamp;
				if (delta > 0) durations.push(delta);
			}
			previousTimestamp = packet.timestamp;
		}
	} finally {
		await packets.return(undefined);
	}
	if (durations.length < 4) return 'unknown';
	const average = durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
	const maxDeviation = Math.max(...durations.map((duration) => Math.abs(duration - average)));
	return maxDeviation > Math.max(0.002, average * 0.08) ? 'variable' : 'constant';
}

function colorHintsFromInit(color: VideoColorSpaceInit): SourceColorHints {
	return {
		primaries: color.primaries ?? null,
		transfer: color.transfer ?? null,
		matrix: color.matrix ?? null,
		fullRange: color.fullRange ?? null
	};
}

async function inspectVideoTrack(track: InputVideoTrack): Promise<SourceVideoTrackInspection> {
	const stats = await track.computePacketStats(100, { skipLiveWait: true }).catch(() => ({
		packetCount: 0,
		averagePacketRate: 0,
		averageBitrate: 0
	}));
	const frameRate =
		stats.averagePacketRate && stats.averagePacketRate > 0 ? stats.averagePacketRate : null;
	const [
		timing,
		codec,
		canDecode,
		codedWidth,
		codedHeight,
		displayWidth,
		displayHeight,
		rotationDeg,
		color
	] = await Promise.all([
		trackStartAndDuration(track),
		track.getCodecParameterString(),
		track.canDecode(),
		track.getCodedWidth(),
		track.getCodedHeight(),
		track.getDisplayWidth(),
		track.getDisplayHeight(),
		track.getRotation(),
		track
			.getColorSpace()
			.then(colorHintsFromInit)
			.catch(() => ({
				primaries: null,
				transfer: null,
				matrix: null,
				fullRange: null
			}))
	]);
	const frameRateMode = await detectFrameRateMode(track, frameRate).catch(() => 'unknown' as const);
	return {
		kind: 'video',
		trackId: `video-${track.number}`,
		codec,
		canDecode,
		startS: timing.startS,
		durationS: timing.durationS,
		codedWidth,
		codedHeight,
		displayWidth,
		displayHeight,
		frameRate,
		frameRateMode,
		rotationDeg,
		color
	};
}

async function inspectAudioTrack(track: InputAudioTrack): Promise<SourceAudioTrackInspection> {
	const [timing, codec, canDecode, channels, sampleRate] = await Promise.all([
		trackStartAndDuration(track),
		track.getCodecParameterString(),
		track.canDecode(),
		track.getNumberOfChannels(),
		track.getSampleRate()
	]);
	return {
		kind: 'audio',
		trackId: `audio-${track.number}`,
		codec,
		canDecode,
		startS: timing.startS,
		durationS: timing.durationS,
		sampleRate,
		channels
	};
}

function createMetadata(
	file: File,
	duration: number,
	mimeType: string | null,
	tracks: readonly SourceTrackInspection[],
	primaryVideo?: SourceVideoTrackInspection | null,
	primaryAudio?: SourceAudioTrackInspection | null
): MediaMetadata {
	const videoTrack =
		primaryVideo ??
		tracks.find((track): track is SourceVideoTrackInspection => track.kind === 'video') ??
		null;
	const audioTrack =
		primaryAudio ??
		tracks.find((track): track is SourceAudioTrackInspection => track.kind === 'audio') ??
		null;
	return {
		fileName: file.name,
		duration,
		mimeType,
		video: videoTrack
			? {
					codec: videoTrack.codec,
					width: videoTrack.displayWidth,
					height: videoTrack.displayHeight,
					frameRate: videoTrack.frameRate,
					canDecode: videoTrack.canDecode
				}
			: null,
		audio: audioTrack
			? {
					codec: audioTrack.codec,
					channels: audioTrack.channels,
					sampleRate: audioTrack.sampleRate,
					canDecode: audioTrack.canDecode
				}
			: null,
		trackCount: tracks.length
	};
}

type SourceHealthWarningSnapshot = import('../../protocol').SourceHealthWarningSnapshot;

function healthFromWarnings(
	warnings: readonly SourceHealthWarningSnapshot[]
): SourceConformance['health'] {
	return warnings.some((item) => item.blocking)
		? 'blocked'
		: warnings.length > 0
			? 'warnings'
			: 'ok';
}

function deriveConformance(
	inspection: SourceInspection,
	primaryVideo: SourceVideoTrackInspection | null,
	primaryAudio: SourceAudioTrackInspection | null
): { conformance: SourceConformance; warnings: readonly SourceHealthWarningSnapshot[] } {
	const hasDecodableVideo = Boolean(primaryVideo?.canDecode);
	const hasDecodableAudio = Boolean(primaryAudio?.canDecode);
	const firstVideo =
		inspection.tracks.find(
			(track): track is SourceVideoTrackInspection => track.kind === 'video'
		) ?? null;
	const firstAudio =
		inspection.tracks.find(
			(track): track is SourceAudioTrackInspection => track.kind === 'audio'
		) ?? null;
	const kind: MediaKind = hasDecodableVideo
		? 'video'
		: hasDecodableAudio
			? 'audio'
			: firstVideo
				? 'video'
				: 'audio';
	const timing = buildNormalizedSourceTiming({
		durationS: inspection.durationS ?? 0,
		video: primaryVideo ?? firstVideo ?? undefined,
		audio: primaryAudio ?? firstAudio ?? undefined,
		frameRateMode: primaryVideo?.frameRateMode ?? firstVideo?.frameRateMode ?? 'unknown'
	});
	const initial: SourceConformance = {
		sourceId: inspection.sourceId,
		adapterId: 'mediabunny',
		kind,
		...(primaryVideo ? { primaryVideoTrackId: primaryVideo.trackId } : {}),
		...(primaryAudio ? { primaryAudioTrackId: primaryAudio.trackId } : {}),
		durationS: timing.durationS,
		timing,
		health: hasDecodableVideo || hasDecodableAudio ? 'ok' : 'blocked'
	};
	const warnings = generateSourceHealthWarnings(inspection, initial);
	return {
		conformance: {
			...initial,
			health: healthFromWarnings(warnings)
		},
		warnings
	};
}

function imageInspection(
	sourceId: string,
	file: File,
	width: number,
	height: number
): SourceInspection {
	return {
		sourceId,
		adapterId: 'mediabunny',
		fileName: file.name,
		byteSize: file.size,
		mimeType: file.type || 'image/*',
		container: 'image',
		durationS: STILL_MAX_DURATION_S,
		tracks: [
			{
				kind: 'video',
				trackId: 'video-1',
				codec: file.type || null,
				canDecode: true,
				startS: 0,
				durationS: STILL_MAX_DURATION_S,
				codedWidth: width,
				codedHeight: height,
				displayWidth: width,
				displayHeight: height,
				frameRate: null,
				frameRateMode: 'constant',
				rotationDeg: 0,
				color: { primaries: null, transfer: null, matrix: null, fullRange: null }
			}
		]
	};
}

async function openImageFile(file: File, sourceId: string): Promise<PrimaryMediaAdapterOpenResult> {
	const bitmap = await createImageBitmap(file);
	const displayWidth = bitmap.width;
	const displayHeight = bitmap.height;
	let base: VideoFrame | null;
	try {
		base = new VideoFrame(bitmap, { timestamp: 0, duration: STILL_MAX_DURATION_S * 1e6 });
	} finally {
		bitmap.close();
	}
	const baseFrame = base;
	let disposed = false;

	const still = new StillFrameSource({
		clone: () => baseFrame.clone(),
		close: () => baseFrame.close()
	});

	const inspection = imageInspection(sourceId, file, displayWidth, displayHeight);
	const primaryVideo = inspection.tracks[0] as SourceVideoTrackInspection;
	const { conformance, warnings } = deriveConformance(inspection, primaryVideo, null);
	const metadata = createMetadata(
		file,
		conformance.durationS,
		inspection.mimeType,
		inspection.tracks,
		primaryVideo,
		null
	);
	const handle: MediaInputHandle = {
		sourceId,
		kind: 'image',
		adapterId: 'mediabunny',
		metadata,
		inspection,
		conformance,
		timing: conformance.timing,
		warnings,
		frameSource: still,
		audioSource: null,
		audioChannels: 0,
		audioSampleRate: 0,
		displayWidth,
		displayHeight,
		frameRate: STILL_FRAME_RATE,
		duration: STILL_MAX_DURATION_S,
		thumbnailAt: () => Promise.resolve(disposed ? null : baseFrame.clone()),
		dispose: () => {
			disposed = true;
			still.dispose();
		}
	};
	return { handle, inspection, conformance, warnings };
}

const WEBCODECS_PREFERRED_WHEN_SUPPORTED = true;

async function tryCreateWebCodecsVideoSource(
	primaryVideo: InputVideoTrack,
	minFrameDuration: number
): Promise<SequentialFrameSource | null> {
	if (typeof VideoDecoder === 'undefined') return null;
	try {
		const config = await primaryVideo.getDecoderConfig();
		if (!config) return null;
		const normalized = { ...config, codec: normalizeH264CodecString(config.codec) };
		let support = await VideoDecoder.isConfigSupported(normalized);
		if (!support.supported && normalized.hardwareAcceleration) {
			delete normalized.hardwareAcceleration;
			support = await VideoDecoder.isConfigSupported(normalized);
		}
		if (!support.supported) return null;
		const decoder = new WebCodecsVideoDecoder(primaryVideo);
		return new SequentialFrameSource(decoder, minFrameDuration);
	} catch {
		return null;
	}
}

async function tryCreateWebCodecsAudioSource(
	primaryAudio: InputAudioTrack,
	sampleRate: number
): Promise<SequentialAudioSource | null> {
	if (typeof AudioDecoder === 'undefined') return null;
	try {
		const config = await primaryAudio.getDecoderConfig();
		if (!config) return null;
		const support = await AudioDecoder.isConfigSupported(config);
		if (!support.supported) return null;
		const decoder = new WebCodecsAudioDecoder(primaryAudio);
		return new SequentialAudioSource(decoder, sampleRate);
	} catch {
		return null;
	}
}

async function inspectMediabunnyInput(
	input: Input,
	file: File,
	sourceId: string
): Promise<{
	inspection: SourceInspection;
	primaryVideo: InputVideoTrack | null;
	primaryAudio: InputAudioTrack | null;
	primaryVideoInspection: SourceVideoTrackInspection | null;
	primaryAudioInspection: SourceAudioTrackInspection | null;
}> {
	const mimeType = await input.getMimeType();
	const tracks = await input.getTracks();
	const [videoTracks, audioTracks, primaryVideo, primaryAudio] = await Promise.all([
		input.getVideoTracks(),
		input.getAudioTracks(),
		input.getPrimaryVideoTrack(),
		input.getPrimaryAudioTrack()
	]);
	const videoInspections = await Promise.all(videoTracks.map(inspectVideoTrack));
	const audioInspections = await Promise.all(audioTracks.map(inspectAudioTrack));
	const inspectedTracks: SourceTrackInspection[] = [...videoInspections, ...audioInspections];
	const duration =
		(await input.getDurationFromMetadata(tracks, { skipLiveWait: true }).catch(() => null)) ??
		(await input.computeDuration(tracks, { skipLiveWait: true }).catch(() => null));

	const inspection: SourceInspection = {
		sourceId,
		adapterId: 'mediabunny',
		fileName: file.name,
		byteSize: file.size,
		mimeType,
		container: containerFromFile(file, mimeType),
		durationS: duration,
		tracks: inspectedTracks
	};

	return {
		inspection,
		primaryVideo,
		primaryAudio,
		primaryVideoInspection: primaryVideo
			? (videoInspections.find((track) => track.trackId === `video-${primaryVideo.number}`) ?? null)
			: null,
		primaryAudioInspection: primaryAudio
			? (audioInspections.find((track) => track.trackId === `audio-${primaryAudio.number}`) ?? null)
			: null
	};
}

export const mediabunnyAdapter: MediaAdapter = {
	id: 'mediabunny',
	role: 'primary',
	canInspect: () => true,
	async inspect(input: MediaAdapterOpenInput): Promise<MediaAdapterInspectionResult> {
		if (isImageFile(input.file)) {
			const bitmap = await createImageBitmap(input.file);
			try {
				const inspection = imageInspection(input.sourceId, input.file, bitmap.width, bitmap.height);
				const { warnings } = deriveConformance(
					inspection,
					inspection.tracks[0] as SourceVideoTrackInspection,
					null
				);
				return {
					inspection,
					warnings
				};
			} finally {
				bitmap.close();
			}
		}

		const source = new BlobSource(input.file);
		const mediaInput = new Input({ formats: IMPORT_FORMATS, source });
		try {
			if (!(await mediaInput.canRead())) {
				throw new Error('File format is not supported or is corrupted.');
			}
			const { inspection, primaryVideoInspection, primaryAudioInspection } =
				await inspectMediabunnyInput(mediaInput, input.file, input.sourceId);
			const { warnings } = deriveConformance(
				inspection,
				primaryVideoInspection,
				primaryAudioInspection
			);
			return { inspection, warnings };
		} finally {
			mediaInput.dispose();
		}
	},
	async open(input: MediaAdapterOpenInput): Promise<PrimaryMediaAdapterOpenResult> {
		if (isImageFile(input.file)) {
			return openImageFile(input.file, input.sourceId);
		}

		const source = new BlobSource(input.file);
		const mediaInput = new Input({ formats: IMPORT_FORMATS, source });
		try {
			if (!(await mediaInput.canRead())) {
				throw new Error('File format is not supported or is corrupted.');
			}

			const {
				inspection,
				primaryVideo,
				primaryAudio,
				primaryVideoInspection,
				primaryAudioInspection
			} = await inspectMediabunnyInput(mediaInput, input.file, input.sourceId);
			const { conformance: initialConformance, warnings: initialWarnings } = deriveConformance(
				inspection,
				primaryVideoInspection,
				primaryAudioInspection
			);
			const metadata = createMetadata(
				input.file,
				initialConformance.durationS,
				inspection.mimeType,
				inspection.tracks,
				primaryVideoInspection,
				primaryAudioInspection
			);

			let frameSource: SequentialFrameSource | null = null;
			let thumbnailSink: VideoSampleSink | null = null;
			const displayWidth = primaryVideoInspection?.displayWidth ?? 0;
			const displayHeight = primaryVideoInspection?.displayHeight ?? 0;
			const frameRate =
				primaryVideoInspection?.frameRate && primaryVideoInspection.frameRate > 0
					? primaryVideoInspection.frameRate
					: DEFAULT_FRAME_RATE;

			if (primaryVideo) {
				// VFR: use a tiny floor (guards zero-duration frames only) so each frame
				// advances at its actual Mediabunny-reported duration rather than being
				// held for a full nominal-rate interval.
				const minFrameDuration =
					primaryVideoInspection?.frameRateMode === 'variable'
						? 1e-4
						: frameRate > 0
							? 1 / frameRate
							: 0;

				// Monkey-patch canDecode for H.264 tracks with unsupported level
				// suffixes. VideoDecoder.isConfigSupported() does exact string matching;
				// browsers support H.264 High but reject specific level strings like
				// avc1.64000d (High@L1.3). Since we normalize the codec string before
				// passing to WebCodecs, tell Mediabunny the track is decodable.
				//
				// CONTRACT: This relies on Mediabunny's VideoSampleSink calling
				// track.canDecode() and track.getDecoderConfig() via instance-property
				// lookup (not cached references). If Mediabunny ever caches these
				// methods during construction, this patch will silently stop working.
				// Verify after Mediabunny upgrades.
				if (
					primaryVideoInspection?.codec?.startsWith('avc1.') &&
					!primaryVideoInspection?.canDecode
				) {
					const origCanDecode = primaryVideo.canDecode.bind(primaryVideo);
					const origGetDecoderConfig = primaryVideo.getDecoderConfig.bind(primaryVideo);
					(primaryVideo as { canDecode: () => Promise<boolean> }).canDecode = async () => {
						if (await origCanDecode()) return true;
						const config = await origGetDecoderConfig();
						if (!config) return false;
						const normalized = { ...config, codec: normalizeH264CodecString(config.codec) };
						if (typeof VideoDecoder === 'undefined') return false;
						let support = await VideoDecoder.isConfigSupported(normalized);
						if (!support.supported && normalized.hardwareAcceleration) {
							delete normalized.hardwareAcceleration;
							support = await VideoDecoder.isConfigSupported(normalized);
						}
						return support.supported === true;
					};
					(
						primaryVideo as { getDecoderConfig: () => Promise<VideoDecoderConfig | null> }
					).getDecoderConfig = async () => {
						const config = await origGetDecoderConfig();
						if (!config) return null;
						return { ...config, codec: normalizeH264CodecString(config.codec) };
					};
				}

				// Always create a Mediabunny sink for thumbnails (sparse access).
				thumbnailSink = new VideoSampleSink(primaryVideo);

				if (WEBCODECS_PREFERRED_WHEN_SUPPORTED) {
					frameSource = await tryCreateWebCodecsVideoSource(primaryVideo, minFrameDuration);
				}
				if (!frameSource) {
					const sink = new VideoSampleSink(primaryVideo);
					frameSource = new SequentialFrameSource(sink, minFrameDuration);
				}
			}

			// Since we always attempt Mediabunny fallback for video, the
			// unsupported-video-codec warning is informational when a frame source
			// was successfully created.
			const warnings = frameSource
				? initialWarnings.map((w) =>
						w.code === 'unsupported-video-codec' ? { ...w, blocking: false } : w
					)
				: initialWarnings;
			const conformance: SourceConformance = frameSource
				? {
						...initialConformance,
						health: warnings.some((w) => w.blocking)
							? 'blocked'
							: warnings.length > 0
								? 'warnings'
								: 'ok'
					}
				: initialConformance;

			let audioSource: SequentialAudioSource | null = null;
			const audioChannels = primaryAudioInspection?.channels ?? 2;
			const audioSampleRate = primaryAudioInspection?.sampleRate ?? 48_000;
			if (primaryAudio && primaryAudioInspection?.canDecode) {
				if (WEBCODECS_PREFERRED_WHEN_SUPPORTED) {
					audioSource = await tryCreateWebCodecsAudioSource(primaryAudio, audioSampleRate);
				}
				if (!audioSource) {
					audioSource = new SequentialAudioSource(
						new AudioSampleSink(primaryAudio),
						audioSampleRate
					);
				}
			}

			const kind: MediaKind = frameSource
				? 'video'
				: audioSource
					? 'audio'
					: primaryVideo
						? 'video'
						: 'audio';
			const timing: NormalizedSourceTiming = conformance.timing;
			const thumbnailAt = async (timestamp: number): Promise<VideoFrame | null> => {
				if (!thumbnailSink) return null;
				const resolved = resolveNormalizedSourceTimestamp(timing, 'video', timestamp);
				const sample = await thumbnailSink.getSample(Math.max(0, resolved.adapterTimestampS));
				if (!sample) return null;
				try {
					return sample.toVideoFrame();
				} finally {
					sample.close();
				}
			};

			const handle: MediaInputHandle = {
				sourceId: input.sourceId,
				kind,
				adapterId: 'mediabunny',
				metadata,
				inspection,
				conformance: { ...conformance, kind },
				timing,
				warnings,
				frameSource,
				audioSource,
				audioChannels,
				audioSampleRate,
				displayWidth,
				displayHeight,
				frameRate,
				duration: conformance.durationS,
				thumbnailAt,
				dispose: () => {
					frameSource?.reset();
					audioSource?.dispose();
					mediaInput.dispose();
				}
			};

			return {
				handle,
				inspection,
				conformance: handle.conformance,
				warnings
			};
		} catch (error) {
			mediaInput.dispose();
			throw error;
		}
	}
};

export function healthReportForHandle(handle: MediaInputHandle): SourceHealthReport {
	return reportFromWarnings(handle.sourceId, handle.metadata.fileName, handle.warnings);
}
