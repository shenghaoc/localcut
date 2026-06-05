import { BlobSource, Input, MP4, QTFF, VideoSampleSink, WEBM } from 'mediabunny';
import type { MediaMetadata } from '../protocol';
import { SequentialFrameSource } from './frame-source';

/** Formats included in the bundle (tree-shaken). */
const IMPORT_FORMATS = [MP4, QTFF, WEBM];

/** Fallback frame rate when packet stats can't establish one. */
const DEFAULT_FRAME_RATE = 30;

export interface MediaInputHandle {
  sourceId: string;
  metadata: MediaMetadata;
  /** Sequential decoded-frame source for the primary video track; null if none/undecodable. */
  frameSource: SequentialFrameSource | null;
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
export async function openMediaFile(file: File, sourceId: string): Promise<MediaInputHandle> {
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
    let frameSource: SequentialFrameSource | null = null;
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
        const sink = new VideoSampleSink(videoTrack);
        frameSource = new SequentialFrameSource(sink, frameRate > 0 ? 1 / frameRate : 0);
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
      sourceId,
      metadata,
      frameSource,
      displayWidth,
      displayHeight,
      frameRate,
      duration,
      dispose: () => {
        frameSource?.reset();
        input.dispose();
      },
    };
  } catch (e) {
    input.dispose();
    throw e;
  }
}
