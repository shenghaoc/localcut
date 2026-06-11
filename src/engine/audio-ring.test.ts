import { describe, expect, it } from 'vite-plus/test';
import {
	DEFAULT_RING_CAPACITY_SAMPLES,
	initAudioRing,
	mapAudioRing,
	ringAvailableSamples,
	ringFreeSamples,
	writeRingPcm,
	AUDIO_RING_BYTES
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
