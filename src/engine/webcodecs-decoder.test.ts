import { describe, expect, it, vi } from 'vite-plus/test';
import {
	probeWebCodecsDecodeSupport,
	probeWebCodecsAudioDecodeSupport,
	normalizeH264CodecString
} from './webcodecs-decoder';

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

describe('normalizeH264CodecString', () => {
	it('passes through non-H.264 codecs unchanged', () => {
		expect(normalizeH264CodecString('vp09.00.10.08')).toBe('vp09.00.10.08');
		expect(normalizeH264CodecString('av01.0.05M.08')).toBe('av01.0.05M.08');
		expect(normalizeH264CodecString('vp8')).toBe('vp8');
	});

	it('passes through avc1. with invalid hex (not 6 chars)', () => {
		expect(normalizeH264CodecString('avc1.42E01')).toBe('avc1.42E01');
		expect(normalizeH264CodecString('avc1.42E01E00')).toBe('avc1.42E01E00');
	});

	it('passes through unrecognized profile', () => {
		expect(normalizeH264CodecString('avc1.7A0028')).toBe('avc1.7A0028');
	});

	it('passes through known level unchanged', () => {
		expect(normalizeH264CodecString('avc1.42E01E')).toBe('avc1.42E01E');
		expect(normalizeH264CodecString('avc1.640028')).toBe('avc1.640028');
		expect(normalizeH264CodecString('avc1.4D0028')).toBe('avc1.4D0028');
	});

	it('normalizes unknown level to L4.0 (0x28)', () => {
		expect(normalizeH264CodecString('avc1.64000d')).toBe('avc1.640028');
		expect(normalizeH264CodecString('avc1.42c00c')).toBe('avc1.420028');
	});

	it('normalizes Baseline profile (42) with unknown level', () => {
		expect(normalizeH264CodecString('avc1.42000d')).toBe('avc1.420028');
	});

	it('normalizes Main profile (4D) with unknown level', () => {
		expect(normalizeH264CodecString('avc1.4D000d')).toBe('avc1.4D0028');
	});

	it('normalizes case-insensitively', () => {
		expect(normalizeH264CodecString('avc1.64000D')).toBe('avc1.640028');
	});
});
