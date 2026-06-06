import {
  AudioSampleSink,
  BlobSource,
  Input,
  MP3,
  MP4,
  OGG,
  QTFF,
  VideoSampleSink,
  WAVE,
  WEBM,
} from 'mediabunny';
import type { MediaKind, MediaMetadata } from '../protocol';
import { SequentialAudioSource } from './audio-source';
import { SequentialFrameSource, type VideoFrameProvider } from './frame-source';
import { StillFrameSource } from './still-source';

/** Formats included in the bundle (tree-shaken). Audio-only containers join the
 *  video formats so MP3/OGG/WAV files import as audio assets. */
const IMPORT_FORMATS = [MP4, QTFF, WEBM, MP3, OGG, WAVE];

/** Fallback frame rate when packet stats can't establish one. */
const DEFAULT_FRAME_RATE = 30;

/** Default on-timeline duration when a still is first placed. */
export const STILL_DEFAULT_DURATION_S = 5;
/** Upper bound a still clip can be extended to (acts as its "source duration"). */
export const STILL_MAX_DURATION_S = 3600;
/** Synthetic cadence stills report so the playback step/loop has a frame period. */
const STILL_FRAME_RATE = 30;

const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXTENSION.test(file.name);
}

export interface MediaInputHandle {
  sourceId: string;
  kind: MediaKind;
  metadata: MediaMetadata;
  /** Decoded-frame provider for the primary video track / still; null if none. */
  frameSource: VideoFrameProvider | null;
  /** Sequential decoded-audio source; null if none/undecodable. */
  audioSource: SequentialAudioSource | null;
  audioChannels: number;
  audioSampleRate: number;
  /** Source display dimensions (after rotation/aspect), or 0 when no video. */
  displayWidth: number;
  displayHeight: number;
  /** Effective frame rate used for frame-step and the playback cadence. */
  frameRate: number;
  /** Decodable media duration; stills report {@link STILL_MAX_DURATION_S}. */
  duration: number;
  /**
   * Decodes a single frame at `timestamp` for thumbnail generation through a
   * dedicated sink — never the playback iterator. The caller owns and must close
   * the returned `VideoFrame`. Null when the source carries no decodable video.
   */
  thumbnailAt: (timestamp: number) => Promise<VideoFrame | null>;
  dispose: () => void;
}

/**
 * Opens a still image: decodes it once via `createImageBitmap` and serves clones
 * of that frame for any timestamp. No Mediabunny `Input` is involved.
 */
async function openImageFile(file: File, sourceId: string): Promise<MediaInputHandle> {
  const bitmap = await createImageBitmap(file);
  const displayWidth = bitmap.width;
  const displayHeight = bitmap.height;
  let base: VideoFrame | null;
  try {
    base = new VideoFrame(bitmap, { timestamp: 0, duration: STILL_MAX_DURATION_S * 1e6 });
  } finally {
    bitmap.close();
  }
  const baseFrame = base;
  let disposed = false;

  const still = new StillFrameSource({
    clone: () => baseFrame.clone(),
    close: () => baseFrame.close(),
  });

  const metadata: MediaMetadata = {
    fileName: file.name,
    duration: STILL_MAX_DURATION_S,
    mimeType: file.type || 'image/*',
    video: {
      codec: null,
      width: displayWidth,
      height: displayHeight,
      frameRate: null,
      canDecode: true,
    },
    audio: null,
    trackCount: 1,
  };

  return {
    sourceId,
    kind: 'image',
    metadata,
    frameSource: still,
    audioSource: null,
    audioChannels: 0,
    audioSampleRate: 0,
    displayWidth,
    displayHeight,
    frameRate: STILL_FRAME_RATE,
    duration: STILL_MAX_DURATION_S,
    // Guard against an in-flight thumbnail request racing dispose(): cloning a
    // closed VideoFrame throws, so serve null once the base frame is released.
    thumbnailAt: () => Promise.resolve(disposed ? null : baseFrame.clone()),
    dispose: () => {
      disposed = true;
      still.dispose();
    },
  };
}

/**
 * Opens a user file via BlobSource (lazy disk reads — never buffers the whole file).
 * Keeps the `Input` alive so the worker can decode frames on demand; `dispose()`
 * releases it. The returned {@link VideoSampleSink} decodes from the nearest
 * preceding keyframe internally, so seeks are keyframe-accurate.
 */
export async function openMediaFile(file: File, sourceId: string): Promise<MediaInputHandle> {
  if (isImageFile(file)) {
    return openImageFile(file, sourceId);
  }
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
    let thumbnailSink: VideoSampleSink | null = null;

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
        // A second, dedicated sink for thumbnails so generation never contends
        // with the playback iterator (which forbids overlapping frameAt calls).
        thumbnailSink = new VideoSampleSink(videoTrack);
      }
    }

    let audio: MediaMetadata['audio'] = null;
    let audioSource: SequentialAudioSource | null = null;
    let audioChannels = 2;
    let audioSampleRate = 48_000;
    if (audioTrack) {
      const canDecodeAudio = await audioTrack.canDecode();
      audioChannels = await audioTrack.getNumberOfChannels();
      audioSampleRate = await audioTrack.getSampleRate();
      audio = {
        codec: await audioTrack.getCodecParameterString(),
        channels: audioChannels,
        sampleRate: audioSampleRate,
        canDecode: canDecodeAudio,
      };
      if (canDecodeAudio) {
        const sink = new AudioSampleSink(audioTrack);
        audioSource = new SequentialAudioSource(sink, audioSampleRate);
      }
    }

    const kind: MediaKind = video ? 'video' : 'audio';

    const metadata: MediaMetadata = {
      fileName: file.name,
      duration,
      mimeType,
      video,
      audio,
      trackCount: tracks.length,
    };

    const thumbnailAt = async (timestamp: number): Promise<VideoFrame | null> => {
      if (!thumbnailSink) return null;
      const sample = await thumbnailSink.getSample(Math.max(0, timestamp));
      if (!sample) return null;
      // toVideoFrame() returns a distinct frame that must be closed separately
      // from the sample; the caller owns that frame, we close the sample here.
      try {
        return sample.toVideoFrame();
      } finally {
        sample.close();
      }
    };

    return {
      sourceId,
      kind,
      metadata,
      frameSource,
      audioSource,
      audioChannels,
      audioSampleRate,
      displayWidth,
      displayHeight,
      frameRate,
      duration,
      thumbnailAt,
      dispose: () => {
        frameSource?.reset();
        audioSource?.dispose();
        input.dispose();
      },
    };
  } catch (e) {
    input.dispose();
    throw e;
  }
}
