/**
 * Mediabunny mapping for the media converter: turns a `ConvertFormatId` into a
 * concrete `OutputFormat`, resolves browser-encodable codecs constrained to
 * what the chosen container supports, and probes input files. The actual
 * conversion loop lives in `convert-worker.ts`; this module is the pure-ish
 * boundary between our format registry and Mediabunny.
 */

import {
	type AudioCodec,
	type VideoCodec,
	type OutputFormat,
	type Quality,
	type Input,
	Mp4OutputFormat,
	MovOutputFormat,
	WebMOutputFormat,
	MkvOutputFormat,
	Mp3OutputFormat,
	WavOutputFormat,
	OggOutputFormat,
	getFirstEncodableVideoCodec,
	getFirstEncodableAudioCodec,
	QUALITY_HIGH,
	QUALITY_MEDIUM,
	QUALITY_LOW
} from 'mediabunny';
import type { ConvertFormatId, ConvertInputInfo, ConvertQuality } from '../../protocol';
import {
	PREFERRED_AUDIO_CODECS,
	PREFERRED_VIDEO_CODECS
} from '../../features/convert/convert-formats';

export function createOutputFormat(id: ConvertFormatId): OutputFormat {
	switch (id) {
		case 'mp4':
			return new Mp4OutputFormat();
		case 'mov':
			return new MovOutputFormat();
		case 'webm':
			return new WebMOutputFormat();
		case 'mkv':
			return new MkvOutputFormat();
		case 'mp3':
			return new Mp3OutputFormat();
		case 'wav':
			return new WavOutputFormat();
		case 'ogg':
			return new OggOutputFormat();
	}
}

export function qualityFor(quality: ConvertQuality): Quality {
	switch (quality) {
		case 'high':
			return QUALITY_HIGH;
		case 'medium':
			return QUALITY_MEDIUM;
		case 'low':
			return QUALITY_LOW;
	}
}

/**
 * Picks an encodable video codec for the container: the first of the preferred
 * list that both the browser can encode and the container supports. Returns
 * null when none qualify (the worker then reports an honest failure).
 */
export async function resolveVideoCodec(
	id: ConvertFormatId,
	format: OutputFormat
): Promise<VideoCodec | null> {
	const supported = new Set(format.getSupportedVideoCodecs());
	const candidates = PREFERRED_VIDEO_CODECS[id].filter((codec) => supported.has(codec));
	if (candidates.length === 0) return null;
	return getFirstEncodableVideoCodec(candidates);
}

export async function resolveAudioCodec(
	id: ConvertFormatId,
	format: OutputFormat
): Promise<AudioCodec | null> {
	const supported = new Set(format.getSupportedAudioCodecs());
	const candidates = PREFERRED_AUDIO_CODECS[id].filter((codec) => supported.has(codec));
	if (candidates.length === 0) return null;
	return getFirstEncodableAudioCodec(candidates);
}

/** Maps a Mediabunny `InputFormat` constructor name to a friendly label. */
function containerLabel(formatName: string): string {
	const map: Record<string, string> = {
		Mp4InputFormat: 'MP4',
		QuickTimeInputFormat: 'QuickTime',
		WebMInputFormat: 'WebM',
		MatroskaInputFormat: 'Matroska',
		Mp3InputFormat: 'MP3',
		WaveInputFormat: 'WAV',
		OggInputFormat: 'OGG',
		FlacInputFormat: 'FLAC',
		AdtsInputFormat: 'AAC',
		MpegTsInputFormat: 'MPEG-TS'
	};
	return map[formatName] ?? formatName.replace(/InputFormat$/, '');
}

/** Reads container/track metadata for the Convert UI. */
export async function probeInput(fileName: string, input: Input): Promise<ConvertInputInfo> {
	try {
		const format = await input.getFormat();
		const [videoTracks, audioTracks, duration] = await Promise.all([
			input.getVideoTracks(),
			input.getAudioTracks(),
			input.computeDuration()
		]);
		const video = videoTracks[0] ?? null;
		const audio = audioTracks[0] ?? null;
		return {
			fileName,
			containerLabel: containerLabel(format.constructor.name),
			durationSeconds: duration,
			hasVideo: video !== null,
			hasAudio: audio !== null,
			width: video ? video.displayWidth : null,
			height: video ? video.displayHeight : null,
			videoCodec: video ? video.codec : null,
			audioCodec: audio ? audio.codec : null
		};
	} finally {
		// The probe owns this Input outright; free its reads/decoders whether or
		// not metadata extraction succeeded.
		input.dispose();
	}
}
