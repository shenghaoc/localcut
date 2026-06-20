/**
 * Mediabunny mapping for the media converter: turns a `ConvertFormatId` into a
 * concrete `OutputFormat`, maps the quality preset onto a Mediabunny `Quality`,
 * and probes input files. The actual conversion loop lives in
 * `convert-worker.ts`; codec selection (and the copy-vs-transcode decision) is
 * left to Mediabunny's `Conversion` rather than resolved here.
 */

import {
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
	QUALITY_HIGH,
	QUALITY_MEDIUM,
	QUALITY_LOW
} from 'mediabunny';
import type { ConvertFormatId, ConvertInputInfo, ConvertQuality } from '../../protocol';

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
