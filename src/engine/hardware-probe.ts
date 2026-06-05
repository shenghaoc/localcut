/** Startup encode-throughput probe — Phase 2 (T4.1/T4.2). */

import type { ThroughputProbe } from '../protocol';

/** Codecs tried in order; first supported wins. */
const CANDIDATE_CODECS = ['avc1.42001f', 'vp09.00.10.08', 'vp8'];

/** ~2 seconds of test frames at 30fps. */
const PROBE_FRAMES = 60;
const PROBE_FPS = 30;
/** Comparable, hardware-friendly probe size, capped to the source. */
const PROBE_MAX_WIDTH = 1280;
const PROBE_MAX_HEIGHT = 720;

function probeDimensions(srcWidth: number, srcHeight: number): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  if (srcWidth <= 0 || srcHeight <= 0) {
    return { width: PROBE_MAX_WIDTH, height: PROBE_MAX_HEIGHT };
  }
  const scale = Math.min(1, PROBE_MAX_WIDTH / srcWidth, PROBE_MAX_HEIGHT / srcHeight);
  return { width: even(srcWidth * scale), height: even(srcHeight * scale) };
}

/** A static RGBA test pattern (no Canvas2D — keeps the engine readback-free). */
function buildTestFrameBuffer(width: number, height: number): Uint8Array {
  const buffer = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      buffer[i] = (x * 255) / width;
      buffer[i + 1] = (y * 255) / height;
      buffer[i + 2] = ((x ^ y) & 0xff) as number;
      buffer[i + 3] = 255;
    }
  }
  return buffer;
}

/**
 * Silently encodes a short burst of synthetic frames to estimate this session's
 * encode throughput (fps). The estimate feeds the Phase 6 export ETA. Returns null
 * when WebCodecs encoding is unavailable or no candidate codec is supported.
 *
 * Runs once per session (the worker guards the single call); it is fire-and-forget
 * and never blocks import.
 */
export async function probeEncodeThroughput(
  srcWidth: number,
  srcHeight: number,
): Promise<ThroughputProbe | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return null;
  }

  const { width, height } = probeDimensions(srcWidth, srcHeight);

  let chosen: { codec: string; config: VideoEncoderConfig } | null = null;
  for (const codec of CANDIDATE_CODECS) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate: 5_000_000,
      framerate: PROBE_FPS,
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported && support.config) {
        chosen = { codec, config: support.config };
        break;
      }
    } catch {
      // Unsupported codec string; try the next candidate.
    }
  }
  if (!chosen) return null;

  let encoded = 0;
  let failed = false;
  const encoder = new VideoEncoder({
    output: () => {
      encoded += 1;
    },
    error: () => {
      failed = true;
    },
  });

  const buffer = buildTestFrameBuffer(width, height);
  const microPerFrame = 1_000_000 / PROBE_FPS;
  const start = performance.now();
  try {
    encoder.configure(chosen.config);
    for (let i = 0; i < PROBE_FRAMES && !failed; i++) {
      const frame = new VideoFrame(buffer, {
        format: 'RGBA',
        codedWidth: width,
        codedHeight: height,
        timestamp: Math.round(i * microPerFrame),
      });
      try {
        encoder.encode(frame, { keyFrame: i === 0 });
      } finally {
        frame.close();
      }
      // Bounded queue: don't outrun the encoder while measuring it.
      if (encoder.encodeQueueSize > 4) {
        await new Promise((resolve) => setTimeout(resolve));
      }
    }
    await encoder.flush();
  } catch {
    return null;
  } finally {
    encoder.close();
  }

  const elapsedSeconds = (performance.now() - start) / 1000;
  if (failed || encoded === 0 || elapsedSeconds <= 0) return null;

  return {
    encodeFps: encoded / elapsedSeconds,
    codec: chosen.codec,
    width,
    height,
  };
}
