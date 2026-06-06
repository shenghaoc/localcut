/** Pipelined export — Phase 6 + Phase 17 expansion. */

import {
  AudioSample,
  AudioSampleSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  VideoSample,
  VideoSampleSource,
  WebMOutputFormat,
  type StreamTargetChunk,
} from 'mediabunny';
import type {
  ExportCodecSupport,
  ExportContainer,
  ExportPreset,
  ExportProgress,
  ExportSettings,
  ExportVideoCodec,
  ThroughputProbe,
} from '../protocol';
import type { PreviewRenderer } from './gpu';
import type { MediaInputHandle } from './media-io';
import {
  getTimelineDuration,
  resolveAt,
  type Timeline,
  type TimelineClip,
  type TimelineTrack,
} from './timeline';

const AUDIO_BLOCK_FRAMES = 1024;
const EXPORT_INTERLEAVE_SECONDS = 2;
const MAX_EXPORT_WIDTH = 1920;
const MAX_EXPORT_HEIGHT = 1080;
const MP4_CHUNK_BYTES = 4 * 1024 * 1024;
const DEFAULT_EXPORT_FPS = 30;
const AAC_CODEC = 'mp4a.40.2';
const OPUS_CODEC = 'opus';
const H264_CODEC = 'avc1.640028';
const VP9_CODEC = 'vp09.00.10.08';
const AV1_CODEC = 'av01.0.05M.08';

const CODEC_CANDIDATES: ReadonlyArray<{
  codec: ExportVideoCodec;
  container: ExportContainer;
  webCodec: string;
  mediabunnyCodec: 'avc' | 'vp9' | 'av1';
}> = [
  { codec: 'h264', container: 'mp4', webCodec: H264_CODEC, mediabunnyCodec: 'avc' },
  { codec: 'vp9', container: 'webm', webCodec: VP9_CODEC, mediabunnyCodec: 'vp9' },
  { codec: 'av1', container: 'webm', webCodec: AV1_CODEC, mediabunnyCodec: 'av1' },
];

const CODEC_ETA_FACTORS: Record<ExportVideoCodec, number> = {
  h264: 1,
  vp9: 0.72,
  av1: 0.5,
};

export class ExportCancelledError extends Error {
  constructor() {
    super('Export canceled.');
    this.name = 'ExportCancelledError';
  }
}

export interface ExportPlan {
  settings: ExportSettings;
  preset: ExportPreset;
  codec: ExportVideoCodec;
  container: ExportContainer;
  timelineDuration: number;
  rangeStartS: number;
  exportDuration: number;
  frameRate: number;
  width: number;
  height: number;
  totalFrames: number;
  videoBitrate: number;
  audioBitrate: number;
  audioSampleRate: number;
  audioChannels: number;
  hasAudio: boolean;
  estimatedEncodeFps: number | null;
  subRealtime: boolean;
}

export interface TimelineExportOptions {
  timeline: Timeline;
  sources: ReadonlyMap<string, MediaInputHandle>;
  renderer: PreviewRenderer;
  outputHandle: FileSystemFileHandle;
  settings: ExportSettings;
  throughputProbe: ThroughputProbe | null;
  signal: AbortSignal;
  onProgress: (progress: ExportProgress) => void;
}

export interface TimelineExportResult {
  mimeType: string;
}

export type VideoEncoderSupportProbe = (
  config: VideoEncoderConfig,
) => Promise<VideoEncoderSupport>;

function even(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

export function containerForCodec(codec: ExportVideoCodec): ExportContainer {
  return codec === 'h264' ? 'mp4' : 'webm';
}

export function deriveExportSize(
  sourceWidth: number,
  sourceHeight: number,
  overrides?: { width?: number; height?: number },
): { width: number; height: number } {
  if (overrides?.width && overrides?.height) {
    return { width: even(overrides.width), height: even(overrides.height) };
  }
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: 1280, height: 720 };
  }
  const scale = Math.min(1, MAX_EXPORT_WIDTH / sourceWidth, MAX_EXPORT_HEIGHT / sourceHeight);
  return {
    width: even(sourceWidth * scale),
    height: even(sourceHeight * scale),
  };
}

export function videoBitrateForPreset(
  preset: ExportPreset,
  width: number,
  height: number,
  override?: number,
): number {
  if (override !== undefined && Number.isFinite(override) && override > 0) {
    return Math.round(override);
  }
  const pixels = Math.max(1, width * height);
  const scale = pixels / (1920 * 1080);
  const base = preset === 'quality' ? 10_000_000 : 5_000_000;
  const min = preset === 'quality' ? 3_000_000 : 1_500_000;
  const max = preset === 'quality' ? 16_000_000 : 9_000_000;
  return Math.round(Math.min(max, Math.max(min, base * scale)));
}

export function resolveExportRange(
  timelineDuration: number,
  range: ExportSettings['range'],
): { rangeStartS: number; exportDuration: number } {
  if (!range) {
    return { rangeStartS: 0, exportDuration: timelineDuration };
  }
  const startS = Math.max(0, Math.min(range.startS, timelineDuration));
  const endS = Math.max(startS, Math.min(range.endS, timelineDuration));
  return { rangeStartS: startS, exportDuration: Math.max(0, endS - startS) };
}

export function exportFrameBounds(
  exportDuration: number,
  frameRate: number,
): { totalFrames: number; startFrame: number; endFrame: number } {
  const totalFrames = Math.max(1, Math.ceil(Math.max(0, exportDuration) * frameRate));
  return { totalFrames, startFrame: 0, endFrame: totalFrames };
}

export function rebaseOutputTimestamp(frameIndex: number, frameRate: number): number {
  return frameIndex / frameRate;
}

export function timelineTimeAt(plan: ExportPlan, outputTimestamp: number): number {
  return plan.rangeStartS + outputTimestamp;
}

export function estimatedEncodeFps(
  probe: ThroughputProbe | null,
  preset: ExportPreset,
  codec: ExportVideoCodec,
): number | null {
  if (!probe || !Number.isFinite(probe.encodeFps) || probe.encodeFps <= 0) {
    return null;
  }
  const presetFactor = preset === 'quality' ? 0.8 : 1.25;
  const codecFactor = CODEC_ETA_FACTORS[codec];
  return probe.encodeFps * presetFactor * codecFactor;
}

export function estimateEtaSeconds(
  totalFrames: number,
  doneFrames: number,
  probe: ThroughputProbe | null,
  preset: ExportPreset,
  codec: ExportVideoCodec,
): number | null {
  const fps = estimatedEncodeFps(probe, preset, codec);
  if (!fps) return null;
  return Math.max(0, (Math.max(0, totalFrames - doneFrames)) / fps);
}

function firstVideoHandle(
  timeline: Timeline,
  sources: ReadonlyMap<string, MediaInputHandle>,
): MediaInputHandle | null {
  for (const track of timeline) {
    if (track.type !== 'video') continue;
    for (const clip of track.clips) {
      const handle = sources.get(clip.sourceId);
      if (handle?.frameSource) return handle;
    }
  }
  return null;
}

function firstAudioHandle(
  timeline: Timeline,
  sources: ReadonlyMap<string, MediaInputHandle>,
): MediaInputHandle | null {
  for (const track of timeline) {
    if (track.type !== 'audio') continue;
    if (!trackIsAudible(track, timeline)) continue;
    for (const clip of track.clips) {
      const handle = sources.get(clip.sourceId);
      if (handle?.audioSource) return handle;
    }
  }
  return null;
}

export function defaultExportSettings(
  preset: ExportPreset,
  sourceWidth: number,
  sourceHeight: number,
  sourceFps: number,
  _timelineDuration: number,
  codec: ExportVideoCodec = 'h264',
): ExportSettings {
  const { width, height } = deriveExportSize(sourceWidth, sourceHeight);
  const fps = sourceFps > 0 ? sourceFps : DEFAULT_EXPORT_FPS;
  return {
    preset,
    codec,
    container: containerForCodec(codec),
    width,
    height,
    fps,
    videoBitrate: videoBitrateForPreset(preset, width, height),
  };
}

export function normalizeExportSettings(
  settings: ExportSettings,
  sourceWidth: number,
  sourceHeight: number,
  sourceFps: number,
  timelineDuration: number,
): ExportSettings {
  const { width, height } = deriveExportSize(sourceWidth, sourceHeight, {
    width: settings.width,
    height: settings.height,
  });
  const fps = settings.fps > 0 ? settings.fps : sourceFps > 0 ? sourceFps : DEFAULT_EXPORT_FPS;
  const container = containerForCodec(settings.codec);
  let range = settings.range;
  if (range) {
    const { rangeStartS, exportDuration } = resolveExportRange(timelineDuration, range);
    range = exportDuration > 0 ? { startS: rangeStartS, endS: rangeStartS + exportDuration } : undefined;
  }
  return {
    preset: settings.preset,
    codec: settings.codec,
    container,
    width,
    height,
    fps,
    videoBitrate: videoBitrateForPreset(settings.preset, width, height, settings.videoBitrate),
    range,
  };
}

export function buildExportPlan(
  timeline: Timeline,
  sources: ReadonlyMap<string, MediaInputHandle>,
  settings: ExportSettings,
  probe: ThroughputProbe | null,
): ExportPlan {
  const videoHandle = firstVideoHandle(timeline, sources);
  if (!videoHandle) {
    throw new Error('Export requires at least one decodable video clip.');
  }

  const timelineDuration = getTimelineDuration(timeline);
  if (timelineDuration <= 0) {
    throw new Error('Export requires a non-empty timeline.');
  }

  const normalized = normalizeExportSettings(
    settings,
    videoHandle.displayWidth,
    videoHandle.displayHeight,
    videoHandle.frameRate,
    timelineDuration,
  );
  const { rangeStartS, exportDuration } = resolveExportRange(timelineDuration, normalized.range);
  if (exportDuration <= 0) {
    throw new Error('Export range must have a positive duration.');
  }

  const frameRate = normalized.fps;
  const { totalFrames } = exportFrameBounds(exportDuration, frameRate);
  const audioHandle = firstAudioHandle(timeline, sources);
  const estimatedFps = estimatedEncodeFps(probe, normalized.preset, normalized.codec);
  const audioSampleRate = audioHandle?.audioSampleRate ?? 48_000;

  if (audioHandle) {
    for (const track of timeline) {
      if (track.type !== 'audio' || !trackIsAudible(track, timeline)) continue;
      for (const clip of track.clips) {
        const handle = sources.get(clip.sourceId);
        if (handle?.audioSource && handle.audioSampleRate !== audioSampleRate) {
          throw new Error(
            `Audio source "${clip.sourceId}" has sample rate ${handle.audioSampleRate} Hz ` +
              `but export target is ${audioSampleRate} Hz. Resampling is not supported.`,
          );
        }
      }
    }
  }

  return {
    settings: normalized,
    preset: normalized.preset,
    codec: normalized.codec,
    container: normalized.container,
    timelineDuration,
    rangeStartS,
    exportDuration,
    frameRate,
    width: normalized.width,
    height: normalized.height,
    totalFrames,
    videoBitrate: normalized.videoBitrate,
    audioBitrate: normalized.preset === 'quality' ? 192_000 : 128_000,
    audioSampleRate,
    audioChannels: Math.min(2, Math.max(1, audioHandle?.audioChannels ?? 2)),
    hasAudio: audioHandle !== null,
    estimatedEncodeFps: estimatedFps,
    subRealtime: estimatedFps !== null && estimatedFps < frameRate,
  };
}

export async function probeExportCodecs(
  width: number,
  height: number,
  fps: number,
  bitrate: number,
  isConfigSupported: VideoEncoderSupportProbe = (config) => VideoEncoder.isConfigSupported(config),
): Promise<ExportCodecSupport[]> {
  const supported: ExportCodecSupport[] = [];
  const evenWidth = even(width);
  const evenHeight = even(height);

  for (const candidate of CODEC_CANDIDATES) {
    const config: VideoEncoderConfig = {
      codec: candidate.webCodec,
      width: evenWidth,
      height: evenHeight,
      bitrate,
      framerate: fps,
      hardwareAcceleration: 'prefer-hardware',
      latencyMode: 'quality',
      ...(candidate.codec === 'h264' ? { avc: { format: 'avc' } } : {}),
    };
    try {
      const result = await isConfigSupported(config);
      if (result.supported) {
        supported.push({ codec: candidate.codec, container: candidate.container });
      }
    } catch {
      // Unsupported codec string in this browser.
    }
  }

  return supported;
}

export function filterSupportedCodecs(
  candidates: readonly ExportCodecSupport[],
  probed: ReadonlySet<string>,
): ExportCodecSupport[] {
  return candidates.filter((entry) => probed.has(`${entry.codec}:${entry.container}`));
}

function trackIsAudible(track: TimelineTrack, timeline: Timeline): boolean {
  if (track.muted) return false;
  const anySolo = timeline.some((candidate) => candidate.type === 'audio' && candidate.solo);
  return !anySolo || track.solo;
}

function clipAt(track: TimelineTrack, time: number): TimelineClip | null {
  for (const clip of track.clips) {
    if (time >= clip.start && time < clip.start + clip.duration) return clip;
  }
  return null;
}

function nextClipStart(track: TimelineTrack, time: number): number {
  let next = Number.POSITIVE_INFINITY;
  for (const clip of track.clips) {
    if (clip.start > time && clip.start < next) next = clip.start;
  }
  return next;
}

export async function mixAudioWindow(
  timeline: Timeline,
  sources: ReadonlyMap<string, MediaInputHandle>,
  startTime: number,
  frameCount: number,
  sampleRate: number,
  channels: number,
): Promise<Float32Array> {
  const out = new Float32Array(Math.max(0, frameCount) * channels);
  if (frameCount <= 0 || channels <= 0) return out;

  for (const track of timeline) {
    if (track.type !== 'audio' || !trackIsAudible(track, timeline)) continue;

    let offsetFrames = 0;
    while (offsetFrames < frameCount) {
      const timelineTime = startTime + offsetFrames / sampleRate;
      const clip = clipAt(track, timelineTime);
      if (!clip) {
        const nextStart = nextClipStart(track, timelineTime);
        const skipUntil = Math.min(
          startTime + frameCount / sampleRate,
          Number.isFinite(nextStart) ? nextStart : Number.POSITIVE_INFINITY,
        );
        const skipFrames = Number.isFinite(skipUntil)
          ? Math.max(1, Math.floor((skipUntil - timelineTime) * sampleRate))
          : frameCount - offsetFrames;
        offsetFrames += Math.min(frameCount - offsetFrames, skipFrames);
        continue;
      }

      const handle = sources.get(clip.sourceId);
      const clipEnd = clip.start + clip.duration;
      const runFrames = Math.max(
        1,
        Math.min(frameCount - offsetFrames, Math.ceil((clipEnd - timelineTime) * sampleRate)),
      );
      if (!handle?.audioSource) {
        offsetFrames += runFrames;
        continue;
      }

      const sourceTime = clip.inPoint + (timelineTime - clip.start);
      const pcm = await handle.audioSource.pcmWindowAt(sourceTime, runFrames, channels);
      const gain = track.gain;
      for (let i = 0; i < pcm.length; i += 1) {
        out[offsetFrames * channels + i] += pcm[i]! * gain;
      }
      offsetFrames += runFrames;
    }
  }

  for (let i = 0; i < out.length; i += 1) {
    out[i] = Math.max(-1, Math.min(1, out[i]!));
  }
  return out;
}

function codecConfig(candidateCodec: ExportVideoCodec): (typeof CODEC_CANDIDATES)[number] {
  const found = CODEC_CANDIDATES.find((entry) => entry.codec === candidateCodec);
  if (!found) throw new Error(`Unsupported export codec: ${candidateCodec}`);
  return found;
}

async function assertVideoEncoderSupported(plan: ExportPlan): Promise<void> {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('Export requires WebCodecs VideoEncoder support.');
  }

  const candidate = codecConfig(plan.codec);
  const config: VideoEncoderConfig = {
    codec: candidate.webCodec,
    width: plan.width,
    height: plan.height,
    bitrate: plan.videoBitrate,
    framerate: plan.frameRate,
    hardwareAcceleration: 'prefer-hardware',
    latencyMode: plan.preset === 'fast' ? 'realtime' : 'quality',
    ...(plan.codec === 'h264' ? { avc: { format: 'avc' } } : {}),
  };

  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) {
    throw new Error(
      `${plan.codec.toUpperCase()} ${plan.container.toUpperCase()} export is not supported at ` +
        `${plan.width}x${plan.height} (${Math.round(plan.videoBitrate / 1_000_000)} Mbps). ` +
        'Try a recent Chromium browser with hardware acceleration enabled.',
    );
  }
}

async function assertAudioEncoderSupported(plan: ExportPlan): Promise<void> {
  if (!plan.hasAudio) return;
  if (typeof AudioEncoder === 'undefined') {
    throw new Error('Audio export requires WebCodecs AudioEncoder support.');
  }

  const codec = plan.container === 'webm' ? OPUS_CODEC : AAC_CODEC;
  const support = await AudioEncoder.isConfigSupported({
    codec,
    numberOfChannels: plan.audioChannels,
    sampleRate: plan.audioSampleRate,
    bitrate: plan.audioBitrate,
  });
  if (!support.supported) {
    throw new Error(
      `${plan.container === 'webm' ? 'Opus' : 'AAC'} export is not supported at ` +
        `${plan.audioSampleRate} Hz / ${plan.audioChannels} channel(s) in this browser.`,
    );
  }
}

function throwIfCanceled(signal: AbortSignal): void {
  if (signal.aborted) throw new ExportCancelledError();
}

function makeProgress(
  plan: ExportPlan,
  phase: ExportProgress['phase'],
  doneFrames: number,
  startedAt: number,
  probe: ThroughputProbe | null,
): ExportProgress {
  return {
    preset: plan.preset,
    codec: plan.codec,
    container: plan.container,
    phase,
    doneFrames,
    totalFrames: plan.totalFrames,
    percent: plan.totalFrames > 0 ? Math.min(1, doneFrames / plan.totalFrames) : 1,
    etaSeconds: phase !== 'video'
      ? null
      : estimateEtaSeconds(plan.totalFrames, doneFrames, probe, plan.preset, plan.codec),
    elapsedSeconds: (performance.now() - startedAt) / 1000,
    subRealtime: plan.subRealtime,
  };
}

async function encodeVideoRange(
  options: TimelineExportOptions,
  plan: ExportPlan,
  videoSource: VideoSampleSource,
  startedAt: number,
  startFrame: number,
  endFrame: number,
): Promise<void> {
  const { timeline, sources, renderer, signal, throughputProbe, onProgress } = options;
  renderer.setPreviewSize(plan.width, plan.height);

  const frameDuration = 1 / plan.frameRate;
  let lastReport = 0;
  const keyFrameInterval = Math.max(1, Math.round(plan.frameRate * 2));

  for (let frameIndex = startFrame; frameIndex < endFrame; frameIndex += 1) {
    throwIfCanceled(signal);
    const outputTimestamp = rebaseOutputTimestamp(frameIndex, plan.frameRate);
    const timelineTime = timelineTimeAt(plan, outputTimestamp);
    const duration = Math.max(1e-6, Math.min(frameDuration, plan.exportDuration - outputTimestamp));
    const resolved = resolveAt(
      timeline,
      Math.min(timelineTime, Math.max(plan.rangeStartS, plan.rangeStartS + plan.exportDuration - 1e-6)),
    );

    let exportFrame: VideoFrame;
    if (resolved) {
      const sourceHandle = sources.get(resolved.clip.sourceId);
      const decoded = await sourceHandle?.frameSource?.frameAt(resolved.sourceTime);
      if (decoded) {
        let sourceFrame: VideoFrame | null = null;
        try {
          sourceFrame = decoded.toVideoFrame();
          exportFrame = await renderer.renderForExport(
            sourceFrame,
            outputTimestamp,
            duration,
            resolved.clip.effects,
          );
        } finally {
          sourceFrame?.close();
          decoded.close();
        }
      } else {
        exportFrame = await renderer.renderBlackForExport(outputTimestamp, duration);
      }
    } else {
      exportFrame = await renderer.renderBlackForExport(outputTimestamp, duration);
    }

    let sample: VideoSample;
    try {
      sample = new VideoSample(exportFrame, { timestamp: outputTimestamp, duration });
    } catch (error) {
      exportFrame.close();
      throw error;
    }

    await videoSource
      .add(sample, { keyFrame: frameIndex % keyFrameInterval === 0 })
      .finally(() => sample.close());

    const now = performance.now();
    if (now - lastReport > 250 || frameIndex === plan.totalFrames - 1) {
      lastReport = now;
      onProgress(makeProgress(plan, 'video', frameIndex + 1, startedAt, throughputProbe));
    }
  }
}

async function encodeAudioRange(
  options: TimelineExportOptions,
  plan: ExportPlan,
  audioSource: AudioSampleSource,
  startedAt: number,
  startFrame: number,
  endFrame: number,
): Promise<void> {
  const { timeline, sources, signal, onProgress } = options;
  let lastReport = 0;

  for (let cursor = startFrame; cursor < endFrame; cursor += AUDIO_BLOCK_FRAMES) {
    throwIfCanceled(signal);
    const frames = Math.min(AUDIO_BLOCK_FRAMES, endFrame - cursor);
    const outputTimestamp = cursor / plan.audioSampleRate;
    const timelineTime = timelineTimeAt(plan, outputTimestamp);
    const pcm = await mixAudioWindow(
      timeline,
      sources,
      timelineTime,
      frames,
      plan.audioSampleRate,
      plan.audioChannels,
    );
    const sample = new AudioSample({
      data: pcm,
      format: 'f32',
      numberOfChannels: plan.audioChannels,
      sampleRate: plan.audioSampleRate,
      timestamp: outputTimestamp,
    });

    await audioSource.add(sample).finally(() => sample.close());

    const now = performance.now();
    if (now - lastReport > 500) {
      lastReport = now;
      const doneFrames = Math.min(
        plan.totalFrames,
        Math.ceil(((cursor + frames) / plan.audioSampleRate) * plan.frameRate),
      );
      onProgress(makeProgress(plan, 'audio', doneFrames, startedAt, null));
    }
  }
}

async function encodeInterleaved(
  options: TimelineExportOptions,
  plan: ExportPlan,
  videoSource: VideoSampleSource,
  audioSource: AudioSampleSource | null,
  startedAt: number,
): Promise<void> {
  const videoFramesPerSlice = Math.max(1, Math.round(plan.frameRate * EXPORT_INTERLEAVE_SECONDS));
  const totalAudioFrames = Math.max(1, Math.ceil(plan.exportDuration * plan.audioSampleRate));
  let audioCursor = 0;

  for (let videoStart = 0; videoStart < plan.totalFrames; videoStart += videoFramesPerSlice) {
    const videoEnd = Math.min(plan.totalFrames, videoStart + videoFramesPerSlice);
    await encodeVideoRange(options, plan, videoSource, startedAt, videoStart, videoEnd);

    if (audioSource) {
      const sliceEndTime = Math.min(plan.exportDuration, videoEnd / plan.frameRate);
      const audioEnd = Math.min(totalAudioFrames, Math.ceil(sliceEndTime * plan.audioSampleRate));
      await encodeAudioRange(options, plan, audioSource, startedAt, audioCursor, audioEnd);
      audioCursor = audioEnd;
    }
  }

  if (audioSource && audioCursor < totalAudioFrames) {
    await encodeAudioRange(options, plan, audioSource, startedAt, audioCursor, totalAudioFrames);
  }
}

export async function exportTimeline(
  options: TimelineExportOptions,
): Promise<TimelineExportResult> {
  const plan = buildExportPlan(
    options.timeline,
    options.sources,
    options.settings,
    options.throughputProbe,
  );
  throwIfCanceled(options.signal);
  await assertVideoEncoderSupported(plan);
  await assertAudioEncoderSupported(plan);

  const candidate = codecConfig(plan.codec);
  const chunkBytes = plan.container === 'mp4' ? MP4_CHUNK_BYTES : MP4_CHUNK_BYTES;

  let writable: FileSystemWritableFileStream | null = null;
  let output: Output<Mp4OutputFormat | WebMOutputFormat, StreamTarget> | null = null;
  let videoSource: VideoSampleSource | null = null;
  let audioSource: AudioSampleSource | null = null;

  try {
    writable = await options.outputHandle.createWritable();
    const target = new StreamTarget(
      writable as unknown as WritableStream<StreamTargetChunk>,
      { chunked: true, chunkSize: chunkBytes },
    );
    output = new Output({
      format: plan.container === 'mp4' ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(),
      target,
    });

    videoSource = new VideoSampleSource({
      codec: candidate.mediabunnyCodec,
      fullCodecString: candidate.webCodec,
      bitrate: plan.videoBitrate,
      bitrateMode: 'variable',
      keyFrameInterval: 2,
      hardwareAcceleration: 'prefer-hardware',
      latencyMode: plan.preset === 'fast' ? 'realtime' : 'quality',
    });
    output.addVideoTrack(videoSource, { frameRate: plan.frameRate });

    audioSource = plan.hasAudio
      ? new AudioSampleSource({
          codec: plan.container === 'webm' ? 'opus' : 'aac',
          fullCodecString: plan.container === 'webm' ? OPUS_CODEC : AAC_CODEC,
          bitrate: plan.audioBitrate,
          bitrateMode: 'variable',
        })
      : null;
    if (audioSource) output.addAudioTrack(audioSource);

    const startedAt = performance.now();
    options.onProgress(makeProgress(plan, 'video', 0, startedAt, options.throughputProbe));

    await output.start();
    await encodeInterleaved(options, plan, videoSource, audioSource, startedAt);
    videoSource.close();
    videoSource = null;

    if (audioSource) {
      audioSource.close();
      audioSource = null;
    }

    options.onProgress(makeProgress(plan, 'finalizing', plan.totalFrames, startedAt, options.throughputProbe));
    const fallbackMime = plan.container === 'webm' ? 'video/webm' : 'video/mp4';
    const mimeType = await output.getMimeType().catch(() => fallbackMime);
    await output.finalize();
    output = null;
    writable = null;
    return { mimeType };
  } catch (error) {
    videoSource?.close();
    audioSource?.close();
    if (output) {
      await output.cancel().catch(() => {});
    } else {
      await writable?.abort().catch(() => {});
    }
    if (error instanceof ExportCancelledError) {
      throw error;
    }
    if (options.signal.aborted) {
      throw new ExportCancelledError();
    }
    throw error;
  }
}

/** @deprecated Use {@link exportTimeline}. */
export const exportTimelineToMp4 = exportTimeline;
