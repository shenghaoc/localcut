import { describe, expect, it } from 'vite-plus/test';
import { computeWaveformPeaks } from './waveform';

describe('waveform', () => {
	it('computes min/max buckets from stereo PCM', () => {
		const frames = 16;
		const pcm = new Float32Array(frames * 2);
		for (let i = 0; i < frames; i += 1) {
			const v = i === 0 ? -1 : i === frames - 1 ? 1 : 0;
			pcm[i * 2] = v;
			pcm[i * 2 + 1] = v;
		}
		const peaks = computeWaveformPeaks(pcm, 8);
		expect(peaks).toHaveLength(16);

		let globalMin = 0;
		let globalMax = 0;
		for (let b = 0; b < 8; b += 1) {
			globalMin = Math.min(globalMin, peaks[b * 2]!);
			globalMax = Math.max(globalMax, peaks[b * 2 + 1]!);
		}
		expect(globalMin).toBeCloseTo(-1);
		expect(globalMax).toBeCloseTo(1);
	});
});
