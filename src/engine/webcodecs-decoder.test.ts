import { describe, expect, it, vi } from 'vite-plus/test';
import { probeWebCodecsDecodeSupport, probeWebCodecsAudioDecodeSupport } from './webcodecs-decoder';

describe('probeWebCodecsDecodeSupport', () => {
	it('returns false when VideoDecoder is unavailable', async () => {
		const original = globalThis.VideoDecoder;
		try {
			(globalThis as Record<string, unknown>).VideoDecoder = undefined;
			expect(await probeWebCodecsDecodeSupport('avc1.42E01E')).toBe(false);
		} finally {
			(globalThis as Record<string, unknown>).VideoDecoder = original;
		}
	});

	it('returns true when VideoDecoder reports supported', async () => {
		const original = globalThis.VideoDecoder;
		try {
			(globalThis as Record<string, unknown>).VideoDecoder = {
				isConfigSupported: vi.fn().mockResolvedValue({ supported: true })
			};
			expect(await probeWebCodecsDecodeSupport('avc1.42E01E')).toBe(true);
		} finally {
			(globalThis as Record<string, unknown>).VideoDecoder = original;
		}
	});

	it('returns false when VideoDecoder reports unsupported', async () => {
		const original = globalThis.VideoDecoder;
		try {
			(globalThis as Record<string, unknown>).VideoDecoder = {
				isConfigSupported: vi.fn().mockResolvedValue({ supported: false })
			};
			expect(await probeWebCodecsDecodeSupport('vp09.00.10.08')).toBe(false);
		} finally {
			(globalThis as Record<string, unknown>).VideoDecoder = original;
		}
	});

	it('returns false when isConfigSupported throws', async () => {
		const original = globalThis.VideoDecoder;
		try {
			(globalThis as Record<string, unknown>).VideoDecoder = {
				isConfigSupported: vi.fn().mockRejectedValue(new Error('not supported'))
			};
			expect(await probeWebCodecsDecodeSupport('hevc')).toBe(false);
		} finally {
			(globalThis as Record<string, unknown>).VideoDecoder = original;
		}
	});
});

describe('probeWebCodecsAudioDecodeSupport', () => {
	it('returns false when AudioDecoder is unavailable', async () => {
		const original = globalThis.AudioDecoder;
		try {
			(globalThis as Record<string, unknown>).AudioDecoder = undefined;
			expect(await probeWebCodecsAudioDecodeSupport('mp4a.40.2')).toBe(false);
		} finally {
			(globalThis as Record<string, unknown>).AudioDecoder = original;
		}
	});

	it('returns true when AudioDecoder reports supported', async () => {
		const original = globalThis.AudioDecoder;
		try {
			(globalThis as Record<string, unknown>).AudioDecoder = {
				isConfigSupported: vi.fn().mockResolvedValue({ supported: true })
			};
			expect(await probeWebCodecsAudioDecodeSupport('mp4a.40.2')).toBe(true);
		} finally {
			(globalThis as Record<string, unknown>).AudioDecoder = original;
		}
	});
});
