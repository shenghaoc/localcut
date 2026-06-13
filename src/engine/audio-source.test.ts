import { describe, expect, it, vi } from 'vite-plus/test';
import { SequentialAudioSource, type AudioSampleLike } from './audio-source';

class MockAudioSample implements AudioSampleLike {
	readonly duration: number;
	readonly close = vi.fn();

	constructor(
		readonly timestamp: number,
		readonly sampleRate: number,
		private readonly data: Float32Array,
		private readonly channels = 1
	) {
		this.duration = this.numberOfFrames / sampleRate;
	}

	get numberOfFrames(): number {
		return this.data.length / this.channels;
	}

	allocationSize(): number {
		return this.data.byteLength;
	}

	copyTo(destination: Float32Array): void {
		destination.set(this.data);
	}
}

describe('SequentialAudioSource', () => {
	it('returns exact PCM windows across decoded sample boundaries', async () => {
		const samples = [
			new MockAudioSample(0, 4, new Float32Array([0, 1, 2, 3])),
			new MockAudioSample(1, 4, new Float32Array([4, 5, 6, 7]))
		];
		const source = new SequentialAudioSource(
			{
				async *samples() {
					for (const sample of samples) yield sample;
				}
			},
			4
		);

		const window = await source.pcmWindowAt(0.5, 4, 1);

		expect([...window]).toEqual([2, 3, 4, 5]);
		expect(samples[0]!.close).toHaveBeenCalled();
	});

	it('fills gaps with silence before the next decoded sample', async () => {
		const source = new SequentialAudioSource(
			{
				async *samples() {
					yield new MockAudioSample(1, 4, new Float32Array([4, 5, 6, 7]));
				}
			},
			4
		);

		const window = await source.pcmWindowAt(0.5, 4, 1);

		expect([...window]).toEqual([0, 0, 4, 5]);
	});

	it('resamples mismatched sample rates instead of throwing', async () => {
		const source = new SequentialAudioSource(
			{
				async *samples() {
					yield new MockAudioSample(0, 8, new Float32Array([0, 1, 2, 3]));
				}
			},
			4
		);

		const result = await source.pcmWindowAt(0, 2, 1);
		expect(result.length).toBe(2);
	});

	it('resamples to the caller target rate, not the construction rate', async () => {
		// The Mediabunny adapter constructs SequentialAudioSource with the source's
		// OWN native rate, so resampling must key off the per-call target rate the
		// export/playback pipeline passes — not the constructor rate.
		const frames = 64;
		const data = new Float32Array(frames);
		for (let i = 0; i < frames; i += 1) data[i] = Math.sin((2 * Math.PI * i) / 16);
		const makeSource = () =>
			new SequentialAudioSource(
				{
					async *samples() {
						yield new MockAudioSample(0, 8, data);
					}
				},
				8 // constructed with the source's native rate, like the adapter
			);

		// Target == source rate → passthrough, exact source frames.
		const same = await makeSource().pcmWindowAt(0, 8, 1, 8);
		expect(same.slice(0, 4)).toEqual(data.slice(0, 4));

		// Target != source rate → must resample even though it matches the ctor rate.
		const down = await makeSource().pcmWindowAt(0, 16, 1, 4);
		expect(down.length).toBe(16);
		expect(down.every((v) => Number.isFinite(v))).toBe(true);
		// A passthrough (the bug) would return data[0..15] verbatim; resampling differs.
		expect([...down]).not.toEqual(data.slice(0, 16));
	});
});
