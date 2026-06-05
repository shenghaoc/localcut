import { BlobSource, Input, MP4, QTFF, WEBM } from 'mediabunny';
import type { MediaMetadata } from '../protocol';

/** Formats included in the Phase 1 bundle (tree-shaken). */
const IMPORT_FORMATS = [MP4, QTFF, WEBM];

export interface MediaInputHandle {
  metadata: MediaMetadata;
  dispose: () => void;
}

/**
 * Opens a user file via BlobSource (lazy disk reads — never buffers the whole file).
 * Returns metadata and a dispose hook; keeps the Input alive for Phase 2 decode.
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
    if (videoTrack) {
      const stats = await videoTrack.computePacketStats(100);
      video = {
        codec: await videoTrack.getCodecParameterString(),
        width: await videoTrack.getDisplayWidth(),
        height: await videoTrack.getDisplayHeight(),
        frameRate: stats.averagePacketRate,
        canDecode: await videoTrack.canDecode(),
      };
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
      dispose: () => input.dispose(),
    };
  } catch (e) {
    input.dispose();
    throw e;
  }
}
