import { BlobSource, Input, MP4, QTFF, VideoSampleSink, WEBM } from 'mediabunny';
import type { MediaMetadata } from '../protocol';

/** Formats included in the bundle (tree-shaken). */
const IMPORT_FORMATS = [MP4, QTFF, WEBM];

/** Fallback frame rate when packet stats can't establish one. */
const DEFAULT_FRAME_RATE = 30;

export interface MediaInputHandle {
  metadata: MediaMetadata;
  /** Decoded-frame source for the primary video track; null if none/undecodable. */
  videoSink: VideoSampleSink | null;
  /** Source display dimensions (after rotation/aspect), or 0 when no video. */
  displayWidth: number;
  displayHeight: number;
  /** Effective frame rate used for frame-step and the playback cadence. */
  frameRate: number;
  duration: number;
  dispose: () => void;
}

/**
 * Opens a user file via BlobSource (lazy disk reads — never buffers the whole file).
 * Keeps the `Input` alive so the worker can decode frames on demand; `dispose()`
 * releases it. The returned {@link VideoSampleSink} decodes from the nearest
 * preceding keyframe internally, so seeks are keyframe-accurate.
 */
export async function openMediaFile(file: File): Promise<MediaInputHandle> {
  const source = new BlobSource(file);
  const input = new Input({
    formats: IMPORT_FORMATS,
    source,
  });

  try {
    const canRead = await input.canRead();
    if (!canRead) {
      throw new Error('File format is not supported or is corrupted.');
    }

    const mimeType = await input.getMimeType();
    const duration =
      (await input.getDurationFromMetadata()) ??
      (await input.computeDuration());

    const tracks = await input.getTracks();
    const videoTrack = await input.getPrimaryVideoTrack();
    const audioTrack = await input.getPrimaryAudioTrack();

    let video: MediaMetadata['video'] = null;
    let videoSink: VideoSampleSink | null = null;
    let displayWidth = 0;
    let displayHeight = 0;
    let frameRate = DEFAULT_FRAME_RATE;

    if (videoTrack) {
      const stats = await videoTrack.computePacketStats(100);
      const canDecode = await videoTrack.canDecode();
      displayWidth = await videoTrack.getDisplayWidth();
      displayHeight = await videoTrack.getDisplayHeight();
      if (stats.averagePacketRate && stats.averagePacketRate > 0) {
        frameRate = stats.averagePacketRate;
      }
      video = {
        codec: await videoTrack.getCodecParameterString(),
        width: displayWidth,
        height: displayHeight,
        frameRate: stats.averagePacketRate,
        canDecode,
      };
      if (canDecode) {
        videoSink = new VideoSampleSink(videoTrack);
      }
    }

    let audio: MediaMetadata['audio'] = null;
    if (audioTrack) {
      audio = {
        codec: await audioTrack.getCodecParameterString(),
        channels: await audioTrack.getNumberOfChannels(),
        sampleRate: await audioTrack.getSampleRate(),
        canDecode: await audioTrack.canDecode(),
      };
    }

    const metadata: MediaMetadata = {
      fileName: file.name,
      duration,
      mimeType,
      video,
      audio,
      trackCount: tracks.length,
    };

    return {
      metadata,
      videoSink,
      displayWidth,
      displayHeight,
      frameRate,
      duration,
      dispose: () => input.dispose(),
    };
  } catch (e) {
    input.dispose();
    throw e;
  }
}
