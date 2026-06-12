/** Shared PCM ring buffer between the pipeline worker (writer) and AudioWorklet (reader). */

export const RING_HEADER_INTS = 8;
/** Header int indices. */
export const RingHeader = {
	WRITE_SAMPLES: 0,
	READ_SAMPLES: 1,
	SAMPLE_RATE: 2,
	CHANNELS: 3,
	CAPACITY_SAMPLES: 4,
	GENERATION: 5,
	/** 0 idle, 1 playing, 2 paused */
	STATE: 6,
	RESERVED: 7
} as const;

export const RingState = {
	IDLE: 0,
	PLAYING: 1,
	PAUSED: 2
} as const;

/** Default ring capacity: ~1s of stereo PCM at 48 kHz. */
export const DEFAULT_RING_CAPACITY_SAMPLES = 48_000;
export const MAX_AUDIO_RING_TRACKS = 32;

export const AUDIO_RING_BYTES =
	RING_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT +
	DEFAULT_RING_CAPACITY_SAMPLES * 2 * Float32Array.BYTES_PER_ELEMENT +
	DEFAULT_RING_CAPACITY_SAMPLES * Int32Array.BYTES_PER_ELEMENT +
	DEFAULT_RING_CAPACITY_SAMPLES * 2 * MAX_AUDIO_RING_TRACKS * Float32Array.BYTES_PER_ELEMENT;

export interface AudioRingViews {
	header: Int32Array;
	pcm: Float32Array;
	trackIds: Int32Array;
	trackPcm: Float32Array;
	capacitySamples: number;
}

export function mapAudioRing(sab: SharedArrayBuffer): AudioRingViews {
	const header = new Int32Array(sab, 0, RING_HEADER_INTS);
	const capacitySamples = header[RingHeader.CAPACITY_SAMPLES] || DEFAULT_RING_CAPACITY_SAMPLES;
	const channels = Math.max(1, header[RingHeader.CHANNELS] || 2);
	const pcmFloats = capacitySamples * channels;
	const pcmOffset = RING_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT;
	const pcm = new Float32Array(sab, pcmOffset, pcmFloats);
	const trackIdOffset = pcmOffset + pcmFloats * Float32Array.BYTES_PER_ELEMENT;
	const trackIds = new Int32Array(sab, trackIdOffset, capacitySamples);
	const trackPcm = new Float32Array(
		sab,
		trackIdOffset + capacitySamples * Int32Array.BYTES_PER_ELEMENT,
		capacitySamples * channels * MAX_AUDIO_RING_TRACKS
	);
	return { header, pcm, trackIds, trackPcm, capacitySamples };
}

export function initAudioRing(
	sab: SharedArrayBuffer,
	sampleRate: number,
	channels: number,
	capacitySamples = DEFAULT_RING_CAPACITY_SAMPLES
): AudioRingViews {
	const header = new Int32Array(sab, 0, RING_HEADER_INTS);
	Atomics.store(header, RingHeader.WRITE_SAMPLES, 0);
	Atomics.store(header, RingHeader.READ_SAMPLES, 0);
	Atomics.store(header, RingHeader.SAMPLE_RATE, sampleRate);
	Atomics.store(header, RingHeader.CHANNELS, channels);
	Atomics.store(header, RingHeader.CAPACITY_SAMPLES, capacitySamples);
	Atomics.store(header, RingHeader.GENERATION, 0);
	Atomics.store(header, RingHeader.STATE, RingState.IDLE);
	return mapAudioRing(sab);
}

function capacityFrames(views: AudioRingViews): number {
	return Atomics.load(views.header, RingHeader.CAPACITY_SAMPLES) || views.capacitySamples;
}

export function ringAvailableSamples(views: AudioRingViews): number {
	const write = Atomics.load(views.header, RingHeader.WRITE_SAMPLES);
	const read = Atomics.load(views.header, RingHeader.READ_SAMPLES);
	return Math.max(0, write - read);
}

export function ringFreeSamples(views: AudioRingViews): number {
	return capacityFrames(views) - ringAvailableSamples(views);
}

/** Timeline seconds consumed by the worklet (derived from read position). */
export function ringPlaybackSeconds(views: AudioRingViews): number {
	const read = Atomics.load(views.header, RingHeader.READ_SAMPLES);
	const rate = Atomics.load(views.header, RingHeader.SAMPLE_RATE) || 48_000;
	return read / rate;
}

export function bumpRingGeneration(views: AudioRingViews): number {
	return Atomics.add(views.header, RingHeader.GENERATION, 1) + 1;
}

export function resetRingPointers(views: AudioRingViews): void {
	Atomics.store(views.header, RingHeader.WRITE_SAMPLES, 0);
	Atomics.store(views.header, RingHeader.READ_SAMPLES, 0);
	views.trackIds.fill(-1);
	views.trackPcm.fill(0);
}

/**
 * Writes interleaved PCM into the ring. Returns samples written (may be partial
 * when the ring is full).
 */
export function writeRingPcm(
	views: AudioRingViews,
	interleaved: Float32Array,
	trackIndex = -1,
	trackStems?: ReadonlyMap<number, Float32Array>
): number {
	const channels = Math.max(1, Atomics.load(views.header, RingHeader.CHANNELS));
	const frameCount = Math.floor(interleaved.length / channels);
	if (frameCount <= 0) return 0;

	const freeFrames = ringFreeSamples(views);
	if (freeFrames <= 0) return 0;

	const toWrite = Math.min(frameCount, freeFrames);
	const writePos = Atomics.load(views.header, RingHeader.WRITE_SAMPLES);
	const capFrames = capacityFrames(views);

	for (let frame = 0; frame < toWrite; frame += 1) {
		const ringFrame = (writePos + frame) % capFrames;
		const dst = ringFrame * channels;
		const src = frame * channels;
		for (let ch = 0; ch < channels; ch += 1) {
			views.pcm[dst + ch] = interleaved[src + ch]!;
		}
		views.trackIds[ringFrame] = trackIndex;
		const stemFrameBase = ringFrame * MAX_AUDIO_RING_TRACKS * channels;
		for (let slot = 0; slot < MAX_AUDIO_RING_TRACKS * channels; slot += 1) {
			views.trackPcm[stemFrameBase + slot] = 0;
		}
		if (trackStems) {
			for (const [stemTrackIndex, stem] of trackStems) {
				if (stemTrackIndex < 0 || stemTrackIndex >= MAX_AUDIO_RING_TRACKS) continue;
				const stemSrc = frame * channels;
				const stemDst = stemFrameBase + stemTrackIndex * channels;
				for (let ch = 0; ch < channels; ch += 1) {
					views.trackPcm[stemDst + ch] = stem[stemSrc + ch] ?? 0;
				}
			}
		}
	}

	Atomics.store(views.header, RingHeader.WRITE_SAMPLES, writePos + toWrite);
	return toWrite;
}
