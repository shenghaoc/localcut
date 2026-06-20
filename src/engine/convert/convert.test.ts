import { describe, it, expect } from 'vite-plus/test';
import type { ConvertInputInfo } from '../../protocol';
import {
	CONVERT_FORMATS,
	PREFERRED_AUDIO_CODECS,
	PREFERRED_VIDEO_CODECS,
	convertFormatById,
	defaultFormatForInput,
	outputFileName,
	parseConvertPath
} from '../../features/convert/convert-formats';

function info(overrides: Partial<ConvertInputInfo> = {}): ConvertInputInfo {
	return {
		fileName: 'clip.mov',
		containerLabel: 'QuickTime',
		durationSeconds: 12,
		hasVideo: true,
		hasAudio: true,
		width: 1920,
		height: 1080,
		videoCodec: 'avc',
		audioCodec: 'aac',
		...overrides
	};
}

describe('convert format registry', () => {
	it('has unique ids and extensions', () => {
		const ids = CONVERT_FORMATS.map((f) => f.id);
		const extensions = CONVERT_FORMATS.map((f) => f.extension);
		expect(new Set(ids).size).toBe(ids.length);
		expect(new Set(extensions).size).toBe(extensions.length);
	});

	it('resolves every id back to its descriptor', () => {
		for (const format of CONVERT_FORMATS) {
			expect(convertFormatById(format.id)).toBe(format);
		}
	});

	it('classifies containers as video or audio consistently with codecs', () => {
		for (const format of CONVERT_FORMATS) {
			const videoCodecs = PREFERRED_VIDEO_CODECS[format.id];
			const audioCodecs = PREFERRED_AUDIO_CODECS[format.id];
			// Every container can carry audio.
			expect(audioCodecs.length).toBeGreaterThan(0);
			if (format.kind === 'video') {
				// Video containers must offer at least one encodable video codec.
				expect(videoCodecs.length).toBeGreaterThan(0);
			} else {
				// Audio-only containers carry no video codecs.
				expect(videoCodecs.length).toBe(0);
			}
		}
	});

	it('throws on an unknown format id', () => {
		// @ts-expect-error — exercising the runtime guard for an out-of-union id.
		expect(() => convertFormatById('flv')).toThrow();
	});
});

describe('defaultFormatForInput', () => {
	it('defaults video inputs to MP4', () => {
		expect(defaultFormatForInput(info({ hasVideo: true }))).toBe('mp4');
	});

	it('defaults audio-only inputs to MP3', () => {
		expect(defaultFormatForInput(info({ hasVideo: false, hasAudio: true }))).toBe('mp3');
	});
});

describe('outputFileName', () => {
	it('swaps the extension', () => {
		expect(outputFileName('clip.mov', 'mp4')).toBe('clip.mp4');
		expect(outputFileName('a.b.c.webm', 'mp3')).toBe('a.b.c.mp3');
	});

	it('adds an extension when the input has none', () => {
		expect(outputFileName('clip', 'mp4')).toBe('clip.mp4');
	});

	it('treats a leading-dot name as extensionless', () => {
		expect(outputFileName('.env', 'wav')).toBe('.env.wav');
	});

	it('falls back to a stem when the name would be empty', () => {
		expect(outputFileName('', 'mp4')).toBe('converted.mp4');
	});
});

describe('parseConvertPath', () => {
	it('matches the converter route, with or without a trailing slash', () => {
		expect(parseConvertPath('/convert')).toBe(true);
		expect(parseConvertPath('/convert/')).toBe(true);
	});

	it('rejects other routes', () => {
		expect(parseConvertPath('/')).toBe(false);
		expect(parseConvertPath('/docs')).toBe(false);
		expect(parseConvertPath('/convert/extra')).toBe(false);
	});
});
