import type { WaveformPeaks } from '../protocol';

/** Downsamples interleaved PCM into min/max peak buckets for canvas rendering. */
export function computeWaveformPeaks(
  interleaved: Float32Array,
  bucketCount: number,
  channels = 2,
): WaveformPeaks {
  const frames = channels > 0 ? interleaved.length / channels : 0;
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
      let sum = 0;
      for (let ch = 0; ch < channels; ch += 1) sum += interleaved[i * channels + ch] ?? 0;
      const sample = sum / channels;
      min = Math.min(min, sample);
      max = Math.max(max, sample);
    }
    peaks[b * 2] = min;
    peaks[b * 2 + 1] = max;
  }
  return peaks;
}
