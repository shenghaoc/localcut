/**
 * Codec support matrix — maps container/codec combinations to decode strategy.
 *
 * Mediabunny handles demuxing (container parsing) for MP4/MOV/WebM/MP3/OGG/WAV.
 * Decode support depends on the browser's WebCodecs implementation. This module
 * provides a unified view of what can be decoded and through which path.
 */

export type DecodeStrategy =
	| 'webcodecs-native'
	| 'webcodecs-software'
	| 'unsupported';

export interface CodecCapability {
	readonly codec: string;
	readonly strategy: DecodeStrategy;
	readonly hardwarePreferred: boolean;
	readonly notes: string | null;
}

export interface FormatSupport {
	readonly container: string;
	readonly demuxSupported: boolean;
	readonly videoCodecs: readonly CodecCapability[];
	readonly audioCodecs: readonly CodecCapability[];
}

const MEDIABUNNY_CONTAINERS = new Set([
	'mp4', 'mov', 'webm', 'mp3', 'ogg', 'wav', 'm4a', 'm4v'
]);

const VIDEO_CODEC_PROBES: ReadonlyArray<{
	name: string;
	codecString: string;
	width: number;
	height: number;
}> = [
	{ name: 'H.264 Baseline', codecString: 'avc1.42E01E', width: 640, height: 480 },
	{ name: 'H.264 High', codecString: 'avc1.640028', width: 1920, height: 1080 },
	{ name: 'VP9 Profile 0', codecString: 'vp09.00.10.08', width: 1920, height: 1080 },
	{ name: 'VP8', codecString: 'vp8', width: 640, height: 480 },
	{ name: 'AV1 Main', codecString: 'av01.0.05M.08', width: 1920, height: 1080 },
	{ name: 'HEVC Main', codecString: 'hev1.1.6.L93.B0', width: 1920, height: 1080 },
	{ name: 'HEVC Main 10', codecString: 'hev1.2.4.L120.B0', width: 1920, height: 1080 }
];

const AUDIO_CODEC_PROBES: ReadonlyArray<{
	name: string;
	codecString: string;
	sampleRate: number;
	channels: number;
}> = [
	{ name: 'AAC-LC', codecString: 'mp4a.40.2', sampleRate: 48000, channels: 2 },
	{ name: 'Opus', codecString: 'opus', sampleRate: 48000, channels: 2 },
	{ name: 'FLAC', codecString: 'flac', sampleRate: 48000, channels: 2 },
	{ name: 'Vorbis', codecString: 'vorbis', sampleRate: 48000, channels: 2 },
	{ name: 'MP3', codecString: 'mp3', sampleRate: 44100, channels: 2 }
];

async function probeVideoCodec(
	codecString: string,
	width: number,
	height: number
): Promise<{ supported: boolean; hardwarePreferred: boolean }> {
	if (typeof VideoDecoder === 'undefined') {
		return { supported: false, hardwarePreferred: false };
	}
	try {
		const hwResult = await VideoDecoder.isConfigSupported({
			codec: codecString,
			codedWidth: width,
			codedHeight: height,
			hardwareAcceleration: 'prefer-hardware'
		});
		if (hwResult.supported) {
			return { supported: true, hardwarePreferred: true };
		}
		const swResult = await VideoDecoder.isConfigSupported({
			codec: codecString,
			codedWidth: width,
			codedHeight: height,
			hardwareAcceleration: 'prefer-software'
		});
		return { supported: swResult.supported === true, hardwarePreferred: false };
	} catch {
		return { supported: false, hardwarePreferred: false };
	}
}

async function probeAudioCodec(
	codecString: string,
	sampleRate: number,
	channels: number
): Promise<boolean> {
	if (typeof AudioDecoder === 'undefined') return false;
	try {
		const result = await AudioDecoder.isConfigSupported({
			codec: codecString,
			sampleRate,
			numberOfChannels: channels
		});
		return result.supported === true;
	} catch {
		return false;
	}
}

export async function probeAllCodecs(): Promise<{
	video: readonly CodecCapability[];
	audio: readonly CodecCapability[];
}> {
	const videoResults = await Promise.all(
		VIDEO_CODEC_PROBES.map(async (probe) => {
			const result = await probeVideoCodec(probe.codecString, probe.width, probe.height);
			const capability: CodecCapability = {
				codec: `${probe.name} (${probe.codecString})`,
				strategy: result.supported
					? result.hardwarePreferred
						? 'webcodecs-native'
						: 'webcodecs-software'
					: 'unsupported',
				hardwarePreferred: result.hardwarePreferred,
				notes: result.supported ? null : 'Browser does not support this codec via WebCodecs.'
			};
			return capability;
		})
	);

	const audioResults = await Promise.all(
		AUDIO_CODEC_PROBES.map(async (probe) => {
			const supported = await probeAudioCodec(
				probe.codecString,
				probe.sampleRate,
				probe.channels
			);
			const capability: CodecCapability = {
				codec: `${probe.name} (${probe.codecString})`,
				strategy: supported ? 'webcodecs-native' : 'unsupported',
				hardwarePreferred: false,
				notes: supported ? null : 'Browser does not support this audio codec.'
			};
			return capability;
		})
	);

	return { video: videoResults, audio: audioResults };
}

export function canDemuxContainer(extension: string): boolean {
	return MEDIABUNNY_CONTAINERS.has(extension.toLowerCase().replace(/^\./, ''));
}

export interface FormatCompatibilitySummary {
	readonly totalVideoCodecs: number;
	readonly supportedVideoCodecs: number;
	readonly hwPreferredVideoCodecs: number;
	readonly totalAudioCodecs: number;
	readonly supportedAudioCodecs: number;
	readonly demuxableContainers: readonly string[];
}

export async function getFormatCompatibility(): Promise<FormatCompatibilitySummary> {
	const { video, audio } = await probeAllCodecs();
	return {
		totalVideoCodecs: video.length,
		supportedVideoCodecs: video.filter((c) => c.strategy !== 'unsupported').length,
		hwPreferredVideoCodecs: video.filter((c) => c.hardwarePreferred).length,
		totalAudioCodecs: audio.length,
		supportedAudioCodecs: audio.filter((c) => c.strategy !== 'unsupported').length,
		demuxableContainers: [...MEDIABUNNY_CONTAINERS]
	};
}
