import { describe, expect, it } from 'vite-plus/test';
import {
	DEFAULT_RING_CAPACITY_SAMPLES,
	initAudioRing,
	mapAudioRing,
	ringAvailableSamples,
	ringFreeSamples,
	writeRingPcm,
	AUDIO_RING_BYTES,
	MAX_AUDIO_RING_TRACKS
} from './audio-ring';

describe('audio-ring', () => {
	it('writes and tracks available samples', () => {
		const sab = new SharedArrayBuffer(AUDIO_RING_BYTES);
		const ring = initAudioRing(sab, 48_000, 2);
		expect(ringFreeSamples(ring)).toBe(DEFAULT_RING_CAPACITY_SAMPLES);

		const pcm = new Float32Array([0.5, -0.5, 0.25, -0.25]);
		const written = writeRingPcm(ring, pcm);
		expect(written).toBe(2);
		expect(ringAvailableSamples(ring)).toBe(2);
		expect(ringFreeSamples(ring)).toBe(DEFAULT_RING_CAPACITY_SAMPLES - 2);
		expect(Array.from(ring.trackIds.slice(0, 2))).toEqual([-1, -1]);
	});

	it('stores per-frame track indices for worklet denoiser routing', () => {
		const sab = new SharedArrayBuffer(AUDIO_RING_BYTES);
		const ring = initAudioRing(sab, 48_000, 2);
		const written = writeRingPcm(ring, new Float32Array([1, 1, 0.5, 0.5]), 7);
		expect(written).toBe(2);
		expect(Array.from(ring.trackIds.slice(0, 2))).toEqual([7, 7]);
	});

	it('stores per-track stems separately from the dry monitor mix', () => {
		const sab = new SharedArrayBuffer(AUDIO_RING_BYTES);
		const ring = initAudioRing(sab, 48_000, 2);
		const stems = new Map([[1, new Float32Array([0.25, 0.1, 0.5, 0.2])]]);
		const written = writeRingPcm(ring, new Float32Array([1, 1, 2, 2]), -1, stems);
		expect(written).toBe(2);
		expect(Array.from(ring.pcm.slice(0, 4))).toEqual([1, 1, 2, 2]);
		expect(ring.trackPcm[2]).toBeCloseTo(0.25);
		expect(ring.trackPcm[3]).toBeCloseTo(0.1);
		const nextFrame = MAX_AUDIO_RING_TRACKS * 2;
		expect(ring.trackPcm[nextFrame + 2]).toBeCloseTo(0.5);
		expect(ring.trackPcm[nextFrame + 3]).toBeCloseTo(0.2);
	});

	it('wraps when capacity is exceeded', () => {
		const sab = new SharedArrayBuffer(AUDIO_RING_BYTES);
		const ring = initAudioRing(sab, 48_000, 1, 4);
		writeRingPcm(ring, new Float32Array([1, 2, 3, 4]));
		expect(ringAvailableSamples(ring)).toBe(4);
		expect(writeRingPcm(ring, new Float32Array([5]))).toBe(0);
	});

	it('remaps views after init', () => {
		const sab = new SharedArrayBuffer(AUDIO_RING_BYTES);
		initAudioRing(sab, 44_100, 2);
		const remapped = mapAudioRing(sab);
		expect(remapped.header[2]).toBe(44_100);
		expect(remapped.header[3]).toBe(2);
	});
});
