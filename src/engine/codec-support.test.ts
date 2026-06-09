import { describe, expect, it, vi } from 'vitest';
import { canDemuxContainer, probeAllCodecs, getFormatCompatibility } from './codec-support';

describe('canDemuxContainer', () => {
	it.each(['mp4', 'mov', 'webm', 'mp3', 'ogg', 'wav', 'm4a', 'm4v'])(
		'returns true for %s',
		(ext) => {
			expect(canDemuxContainer(ext)).toBe(true);
		}
	);

	it.each(['mkv', 'avi', 'flv', 'ts', 'mxf'])(
		'returns false for %s',
		(ext) => {
			expect(canDemuxContainer(ext)).toBe(false);
		}
	);

	it('strips leading dot', () => {
		expect(canDemuxContainer('.mp4')).toBe(true);
		expect(canDemuxContainer('.mkv')).toBe(false);
	});

	it('is case-insensitive', () => {
		expect(canDemuxContainer('MP4')).toBe(true);
		expect(canDemuxContainer('WEBM')).toBe(true);
	});
});

describe('probeAllCodecs', () => {
	it('returns empty support when WebCodecs APIs are unavailable', async () => {
		const origVideo = globalThis.VideoDecoder;
		const origAudio = globalThis.AudioDecoder;
		try {
			(globalThis as Record<string, unknown>).VideoDecoder = undefined;
			(globalThis as Record<string, unknown>).AudioDecoder = undefined;
			const result = await probeAllCodecs();
			expect(result.video.length).toBeGreaterThan(0);
			expect(result.audio.length).toBeGreaterThan(0);
			expect(result.video.every((c) => c.strategy === 'unsupported')).toBe(true);
			expect(result.audio.every((c) => c.strategy === 'unsupported')).toBe(true);
		} finally {
			(globalThis as Record<string, unknown>).VideoDecoder = origVideo;
			(globalThis as Record<string, unknown>).AudioDecoder = origAudio;
		}
	});

	it('reports supported codecs when WebCodecs is available', async () => {
		const origVideo = globalThis.VideoDecoder;
		const origAudio = globalThis.AudioDecoder;
		try {
			(globalThis as Record<string, unknown>).VideoDecoder = {
				isConfigSupported: vi.fn().mockResolvedValue({ supported: true })
			};
			(globalThis as Record<string, unknown>).AudioDecoder = {
				isConfigSupported: vi.fn().mockResolvedValue({ supported: true })
			};
			const result = await probeAllCodecs();
			expect(result.video.some((c) => c.strategy !== 'unsupported')).toBe(true);
			expect(result.audio.some((c) => c.strategy !== 'unsupported')).toBe(true);
		} finally {
			(globalThis as Record<string, unknown>).VideoDecoder = origVideo;
			(globalThis as Record<string, unknown>).AudioDecoder = origAudio;
		}
	});
});

describe('getFormatCompatibility', () => {
	it('returns a valid summary shape', async () => {
		const origVideo = globalThis.VideoDecoder;
		const origAudio = globalThis.AudioDecoder;
		try {
			(globalThis as Record<string, unknown>).VideoDecoder = undefined;
			(globalThis as Record<string, unknown>).AudioDecoder = undefined;
			const summary = await getFormatCompatibility();
			expect(summary.totalVideoCodecs).toBeGreaterThan(0);
			expect(summary.totalAudioCodecs).toBeGreaterThan(0);
			expect(summary.demuxableContainers).toContain('mp4');
			expect(summary.demuxableContainers).toContain('webm');
			expect(summary.supportedVideoCodecs).toBe(0);
			expect(summary.supportedAudioCodecs).toBe(0);
		} finally {
			(globalThis as Record<string, unknown>).VideoDecoder = origVideo;
			(globalThis as Record<string, unknown>).AudioDecoder = origAudio;
		}
	});
});
