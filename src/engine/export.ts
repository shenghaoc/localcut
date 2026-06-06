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
import type { CompositeLayer, PreviewRenderer } from './gpu';
import type { MediaInputHandle } from './media-io';
import {
  accumulateMix,
  applyMasterAndClamp,
  applyMixStage,
  computeClipFadeGain,
  equalPowerCrossfadeGains,
  panCoefficients,
  resolveAudioTransitionAt,
  type AudioTransitionCut,
} from './audio-mix';
import {
  DEFAULT_MASTER_GAIN,
  getTimelineDuration,
  isTitleClip,
  resolveAllAt,
  type Timeline,
  type TimelineClip,
  type TimelineTrack,
} from './timeline';
import type { TitleTexture } from './titles';
import { sampleClipParamsAt } from './keyframes';

const AUDIO_BLOCK_FRAMES = 1024;
const EXPORT_INTERLEAVE_SECONDS = 2;
const MAX_EXPORT_WIDTH = 1920;
const MAX_EXPORT_HEIGHT = 1080;
const MP4_CHUNK_BYTES = 4 * 1024 * 1024;
const DEFAULT_EXPORT_FPS = 30;
/** Default export geometry for title-only timelines (no decodable video). */
const TITLE_ONLY_EXPORT_WIDTH = 1920;
const TITLE_ONLY_EXPORT_HEIGHT = 1080;
const TITLE_ONLY_EXPORT_FPS = 30;
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
  masterGain?: number;
  transitions?: readonly AudioTransitionCut[];
  /** Resolves a title clip's cached raster texture (Phase 14); rasters on the
   *  cold path if needed, never per frame. Returns `null` for non-title clips. */
  titleTextureFor?: (clip: TimelineClip) => TitleTexture | null;
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

/** Default concurrent composite-layer budget when no throughput probe exists. */
export const DEFAULT_LAYER_BUDGET = 8;

/**
 * Concurrent layer budget derived from the encode-throughput probe (Phase 12
 * T2.4). Preview and export share this so an over-budget stack degrades the
 * same way in both. Faster devices allow deeper stacks.
 */
export function layerBudgetFromProbe(probe: ThroughputProbe | null): number {
  if (!probe || !Number.isFinite(probe.encodeFps) || probe.encodeFps <= 0) {
    return DEFAULT_LAYER_BUDGET;
  }
  if (probe.encodeFps >= 60) return 12;
  if (probe.encodeFps >= 30) return DEFAULT_LAYER_BUDGET;
  if (probe.encodeFps >= 15) return 4;
  return 2;
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

export function clipOverlapsRange(
  clip: TimelineClip,
  rangeStartS: number,
  rangeEndS: number,
): boolean {
  const clipEnd = clip.start + clip.duration;
  return clip.start < rangeEndS && clipEnd > rangeStartS;
}

function firstAudioHandleInRange(
  timeline: Timeline,
  sources: ReadonlyMap<string, MediaInputHandle>,
  rangeStartS: number,
  rangeEndS: number,
): MediaInputHandle | null {
  for (const track of timeline) {
    if (track.type !== 'audio') continue;
    if (!trackIsAudible(track, timeline)) continue;
    for (const clip of track.clips) {
      if (!clipOverlapsRange(clip, rangeStartS, rangeEndS)) continue;
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
  // Title-only timelines have no decodable video but are still exportable
  // (source-less titles over black) using the default canvas geometry below.
  const hasTitles = timeline.some(
    (track) => track.type === 'video' && track.clips.some(isTitleClip),
  );
  if (!videoHandle && !hasTitles) {
    throw new Error('Export requires at least one decodable video clip.');
  }

  const timelineDuration = getTimelineDuration(timeline);
  if (timelineDuration <= 0) {
    throw new Error('Export requires a non-empty timeline.');
  }

  const normalized = normalizeExportSettings(
    settings,
    videoHandle?.displayWidth ?? TITLE_ONLY_EXPORT_WIDTH,
    videoHandle?.displayHeight ?? TITLE_ONLY_EXPORT_HEIGHT,
    videoHandle?.frameRate ?? TITLE_ONLY_EXPORT_FPS,
    timelineDuration,
  );
  const { rangeStartS, exportDuration } = resolveExportRange(timelineDuration, normalized.range);
  if (exportDuration <= 0) {
    throw new Error('Export range must have a positive duration.');
  }

  const frameRate = normalized.fps;
  const { totalFrames } = exportFrameBounds(exportDuration, frameRate);
  const rangeEndS = rangeStartS + exportDuration;
  const audioHandle = firstAudioHandleInRange(timeline, sources, rangeStartS, rangeEndS);
  const estimatedFps = estimatedEncodeFps(probe, normalized.preset, normalized.codec);
  const audioSampleRate = audioHandle?.audioSampleRate ?? 48_000;

  if (audioHandle) {
    for (const track of timeline) {
      if (track.type !== 'audio' || !trackIsAudible(track, timeline)) continue;
      for (const clip of track.clips) {
        if (!clipOverlapsRange(clip, rangeStartS, rangeEndS)) continue;
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

export interface MixAudioWindowOptions {
  masterGain?: number;
  transitions?: readonly AudioTransitionCut[];
}

export async function mixAudioWindow(
  timeline: Timeline,
  sources: ReadonlyMap<string, MediaInputHandle>,
  startTime: number,
  frameCount: number,
  sampleRate: number,
  channels: number,
  options: MixAudioWindowOptions = {},
): Promise<Float32Array> {
  const out = new Float32Array(Math.max(0, frameCount) * channels);
  if (frameCount <= 0 || channels <= 0) return out;

  const masterGain = options.masterGain ?? DEFAULT_MASTER_GAIN;
  const transitions = options.transitions ?? [];

  for (const track of timeline) {
    if (track.type !== 'audio' || !trackIsAudible(track, timeline)) continue;

    let offsetFrames = 0;
    while (offsetFrames < frameCount) {
      const timelineTime = startTime + offsetFrames / sampleRate;
      const transition = resolveAudioTransitionAt(track.id, track.clips, transitions, timelineTime);
      if (transition) {
        const outgoing = track.clips.find((clip) => clip.id === transition.outgoingClipId);
        const incoming = track.clips.find((clip) => clip.id === transition.incomingClipId);
        const transitionSpec = transitions.find(
          (item) =>
            item.trackId === track.id &&
            item.fromClipId === transition.outgoingClipId &&
            item.toClipId === transition.incomingClipId,
        );
        if (outgoing && incoming && transitionSpec) {
          const cutTime = outgoing.start + outgoing.duration;
          const half = transitionSpec.durationS * 0.5;
          const windowEnd = cutTime + half;
          const runFrames = Math.max(
            1,
            Math.min(frameCount - offsetFrames, Math.ceil((windowEnd - timelineTime) * sampleRate)),
          );
          const outHandle = sources.get(outgoing.sourceId);
          const inHandle = sources.get(incoming.sourceId);
          const hasOut = Boolean(outHandle?.audioSource);
          const hasIn = Boolean(inHandle?.audioSource);
          if (hasOut || hasIn) {
            const outSourceTime = outgoing.inPoint + (timelineTime - outgoing.start);
            const inSourceTime = incoming.inPoint + (timelineTime - incoming.start);
            const outPcm = hasOut
              ? await outHandle!.audioSource!.pcmWindowAt(outSourceTime, runFrames, channels)
              : null;
            const inPcm = hasIn
              ? await inHandle!.audioSource!.pcmWindowAt(inSourceTime, runFrames, channels)
              : null;
            const windowStart = cutTime - half;
            const { left, right } = panCoefficients(track.pan, channels);
            for (let frame = 0; frame < runFrames; frame += 1) {
              const frameTime = timelineTime + frame / sampleRate;
              const mixT = (frameTime - windowStart) / transitionSpec.durationS;
              const gains = equalPowerCrossfadeGains(mixT);
              const outFade = computeClipFadeGain(
                frameTime - outgoing.start,
                outgoing.duration,
                outgoing.audioFadeIn,
                outgoing.audioFadeOut,
              );
              const inFade = computeClipFadeGain(
                frameTime - incoming.start,
                incoming.duration,
                incoming.audioFadeIn,
                incoming.audioFadeOut,
              );
              const outScale = hasOut ? track.gain * gains.outgoing * outFade : 0;
              const inScale = hasIn ? track.gain * gains.incoming * inFade : 0;
              const srcFrame = frame * channels;
              const destFrame = (offsetFrames + frame) * channels;

              if (channels === 1) {
                const outVal = outPcm ? (outPcm[srcFrame] ?? 0) * outScale : 0;
                const inVal = inPcm ? (inPcm[srcFrame] ?? 0) * inScale : 0;
                out[destFrame] = (out[destFrame] ?? 0) + outVal + inVal;
              } else {
                const outL = outPcm ? (outPcm[srcFrame] ?? 0) : 0;
                const outR = outPcm ? (outPcm[srcFrame + 1] ?? outL) : 0;
                const inL = inPcm ? (inPcm[srcFrame] ?? 0) : 0;
                const inR = inPcm ? (inPcm[srcFrame + 1] ?? inL) : 0;

                out[destFrame] = (out[destFrame] ?? 0) + outL * left * outScale + inL * left * inScale;
                out[destFrame + 1] =
                  (out[destFrame + 1] ?? 0) + outR * right * outScale + inR * right * inScale;
              }
            }
            offsetFrames += runFrames;
            continue;
          }
        }
      }

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
      const mixed = applyMixStage(pcm, channels, {
        gain: track.gain,
        pan: track.pan,
        fadeInS: clip.audioFadeIn,
        fadeOutS: clip.audioFadeOut,
        clipOffsetS: timelineTime - clip.start,
        clipDurationS: clip.duration,
        sampleRate,
      });
      accumulateMix(out, mixed, offsetFrames * channels);
      offsetFrames += runFrames;
    }
  }

  return applyMasterAndClamp(out, masterGain);
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
  const { timeline, sources, renderer, signal, throughputProbe, onProgress, titleTextureFor } = options;
  renderer.setPreviewSize(plan.width, plan.height);

  const frameDuration = 1 / plan.frameRate;
  let lastReport = 0;
  const keyFrameInterval = Math.max(1, Math.round(plan.frameRate * 2));
  const layerBudget = layerBudgetFromProbe(throughputProbe);

  for (let frameIndex = startFrame; frameIndex < endFrame; frameIndex += 1) {
    throwIfCanceled(signal);
    const outputTimestamp = rebaseOutputTimestamp(frameIndex, plan.frameRate);
    const timelineTime = timelineTimeAt(plan, outputTimestamp);
    const duration = Math.max(1e-6, Math.min(frameDuration, plan.exportDuration - outputTimestamp));
    // resolveAllAt is bottom→top. Skip offline/non-decodable sources first, then
    // keep the bottom `layerBudget` decodable layers (dropping the topmost
    // extras) so export degrades identically to preview's makeGetLayers.
    const resolvedLayers = resolveAllAt(
      timeline,
      Math.min(timelineTime, plan.rangeStartS + plan.exportDuration - 1e-6),
    );

    // Decode each layer's source frame, build the composite stack, and render
    // through the same compositor as preview. Every decoded VideoFrame is closed
    // exactly once below — including on a mid-stack decode failure.
    const decodedFrames: VideoFrame[] = [];
    const layers: CompositeLayer[] = [];
    let exportFrame: VideoFrame;
    try {
      let decodedCount = 0;
      for (const layer of resolvedLayers) {
        // Title layers composite from the cached raster (no decode, no budget),
        // preserving z-order — matching preview's makeGetLayers.
        if (isTitleClip(layer.clip)) {
          const texture = layer.clip.title ? titleTextureFor?.(layer.clip) : null;
          if (!texture) continue;
          const sampled = sampleClipParamsAt(layer.clip, timelineTime);
          layers.push({
            kind: 'texture',
            view: texture.view,
            sourceWidth: texture.width,
            sourceHeight: texture.height,
            transform: sampled.transform,
          });
          continue;
        }
        const sourceHandle = sources.get(layer.clip.sourceId);
        if (!sourceHandle?.frameSource) continue;
        // Stop decoding video past the budget but keep scanning so source-less
        // title layers above the budgeted stack still composite (preview parity).
        if (decodedCount >= layerBudget) continue;
        const decoded = await sourceHandle.frameSource.frameAt(layer.sourceTime);
        if (!decoded) continue;
        decodedCount += 1;
        let videoFrame: VideoFrame;
        try {
          videoFrame = decoded.toVideoFrame();
        } finally {
          decoded.close();
        }
        const sampled = sampleClipParamsAt(layer.clip, timelineTime);
        decodedFrames.push(videoFrame);
        layers.push({
          kind: 'frame',
          frame: videoFrame,
          effects: sampled.effects,
          transform: sampled.transform,
          lut: layer.clip.lut,
        });
      }
      exportFrame =
        layers.length > 0
          ? await renderer.renderLayeredForExport(layers, outputTimestamp, duration)
          : await renderer.renderBlackForExport(outputTimestamp, duration);
    } finally {
      for (const frame of decodedFrames) frame.close();
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
      {
        masterGain: options.masterGain,
        transitions: options.transitions,
      },
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
  const chunkBytes = MP4_CHUNK_BYTES;

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
