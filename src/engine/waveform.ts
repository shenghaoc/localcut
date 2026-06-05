import type { WaveformPeaks } from '../protocol';

/** Downsamples interleaved PCM into min/max peak buckets for canvas rendering. */
export function computeWaveformPeaks(interleaved: Float32Array, bucketCount: number): WaveformPeaks {
  const frames = interleaved.length / 2;
  const buckets = Math.max(8, Math.min(bucketCount, frames));
  const peaks = new Float32Array(buckets * 2);
  if (frames <= 0) return peaks;

  const framesPerBucket = frames / buckets;
  for (let b = 0; b < buckets; b += 1) {
    const start = Math.floor(b * framesPerBucket);
    const end = Math.min(frames, Math.floor((b + 1) * framesPerBucket));
    let min = 0;
    let max = 0;
    for (let i = start; i < end; i += 1) {
      const l = interleaved[i * 2] ?? 0;
      const r = interleaved[i * 2 + 1] ?? l;
      const sample = (l + r) * 0.5;
      min = Math.min(min, sample);
      max = Math.max(max, sample);
    }
    peaks[b * 2] = min;
    peaks[b * 2 + 1] = max;
  }
  return peaks;
}
