/** Pipelined export — Phase 6. */

import {
  AudioSample,
  AudioSampleSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  VideoSample,
  VideoSampleSource,
  type StreamTargetChunk,
} from 'mediabunny';
import type { ExportPreset, ExportProgress, ThroughputProbe } from '../protocol';
import type { PreviewRenderer } from './gpu';
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
const H264_CODEC = 'avc1.640028';

export class ExportCancelledError extends Error {
  constructor() {
    super('Export canceled.');
    this.name = 'ExportCancelledError';
  }
}

export interface ExportPlan {
  preset: ExportPreset;
  duration: number;
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
  preset: ExportPreset;
  throughputProbe: ThroughputProbe | null;
  signal: AbortSignal;
  onProgress: (progress: ExportProgress) => void;
  masterGain?: number;
  transitions?: readonly AudioTransitionCut[];
}

export interface TimelineExportResult {
  mimeType: string;
}

function even(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

export function deriveExportSize(sourceWidth: number, sourceHeight: number): { width: number; height: number } {
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
): number {
  const pixels = Math.max(1, width * height);
  const scale = pixels / (1920 * 1080);
  const base = preset === 'quality' ? 10_000_000 : 5_000_000;
  const min = preset === 'quality' ? 3_000_000 : 1_500_000;
  const max = preset === 'quality' ? 16_000_000 : 9_000_000;
  return Math.round(Math.min(max, Math.max(min, base * scale)));
}

export function estimatedEncodeFps(
  probe: ThroughputProbe | null,
  preset: ExportPreset,
): number | null {
  if (!probe || !Number.isFinite(probe.encodeFps) || probe.encodeFps <= 0) {
    return null;
  }
  const factor = preset === 'quality' ? 0.8 : 1.25;
  return probe.encodeFps * factor;
}

export function estimateEtaSeconds(
  totalFrames: number,
  doneFrames: number,
  probe: ThroughputProbe | null,
  preset: ExportPreset,
): number | null {
  const fps = estimatedEncodeFps(probe, preset);
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

export function buildExportPlan(
  timeline: Timeline,
  sources: ReadonlyMap<string, MediaInputHandle>,
  preset: ExportPreset,
  probe: ThroughputProbe | null,
): ExportPlan {
  const videoHandle = firstVideoHandle(timeline, sources);
  if (!videoHandle) {
    throw new Error('Export requires at least one decodable video clip.');
  }

  const duration = getTimelineDuration(timeline);
  if (duration <= 0) {
    throw new Error('Export requires a non-empty timeline.');
  }

  const frameRate = videoHandle.frameRate > 0 ? videoHandle.frameRate : DEFAULT_EXPORT_FPS;
  const { width, height } = deriveExportSize(videoHandle.displayWidth, videoHandle.displayHeight);
  const audioHandle = firstAudioHandle(timeline, sources);
  const estimatedFps = estimatedEncodeFps(probe, preset);
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
    preset,
    duration,
    frameRate,
    width,
    height,
    totalFrames: Math.max(1, Math.ceil(duration * frameRate)),
    videoBitrate: videoBitrateForPreset(preset, width, height),
    audioBitrate: preset === 'quality' ? 192_000 : 128_000,
    audioSampleRate,
    audioChannels: Math.min(2, Math.max(1, audioHandle?.audioChannels ?? 2)),
    hasAudio: audioHandle !== null,
    estimatedEncodeFps: estimatedFps,
    subRealtime: estimatedFps !== null && estimatedFps < frameRate,
  };
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

async function assertVideoEncoderSupported(plan: ExportPlan): Promise<void> {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('MP4 export requires WebCodecs VideoEncoder support.');
  }

  const config: VideoEncoderConfig = {
    codec: H264_CODEC,
    width: plan.width,
    height: plan.height,
    bitrate: plan.videoBitrate,
    framerate: plan.frameRate,
    hardwareAcceleration: 'prefer-hardware',
    latencyMode: plan.preset === 'fast' ? 'realtime' : 'quality',
    avc: { format: 'avc' },
  };

  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) {
    throw new Error(
      `H.264 MP4 export is not supported at ${plan.width}x${plan.height} ` +
        `(${Math.round(plan.videoBitrate / 1_000_000)} Mbps). Try a recent Chromium browser with hardware acceleration enabled.`,
    );
  }
}

async function assertAudioEncoderSupported(plan: ExportPlan): Promise<void> {
  if (!plan.hasAudio) return;
  if (typeof AudioEncoder === 'undefined') {
    throw new Error('Audio export requires WebCodecs AudioEncoder support.');
  }

  const support = await AudioEncoder.isConfigSupported({
    codec: AAC_CODEC,
    numberOfChannels: plan.audioChannels,
    sampleRate: plan.audioSampleRate,
    bitrate: plan.audioBitrate,
  });
  if (!support.supported) {
    throw new Error(
      `AAC export is not supported at ${plan.audioSampleRate} Hz / ` +
        `${plan.audioChannels} channel(s) in this browser.`,
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
    phase,
    doneFrames,
    totalFrames: plan.totalFrames,
    percent: plan.totalFrames > 0 ? Math.min(1, doneFrames / plan.totalFrames) : 1,
    etaSeconds: phase !== 'video'
      ? null
      : estimateEtaSeconds(plan.totalFrames, doneFrames, probe, plan.preset),
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
    const timestamp = frameIndex / plan.frameRate;
    const duration = Math.max(1e-6, Math.min(frameDuration, plan.duration - timestamp));
    const resolved = resolveAt(timeline, Math.min(timestamp, Math.max(0, plan.duration - 1e-6)));

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
            timestamp,
            duration,
            resolved.clip.effects,
          );
        } finally {
          sourceFrame?.close();
          decoded.close();
        }
      } else {
        exportFrame = await renderer.renderBlackForExport(timestamp, duration);
      }
    } else {
      exportFrame = await renderer.renderBlackForExport(timestamp, duration);
    }

    let sample: VideoSample;
    try {
      sample = new VideoSample(exportFrame, { timestamp, duration });
    } catch (error) {
      exportFrame.close();
      throw error;
    }

    // VideoSample wraps VideoFrame directly and closes that backing frame from
    // sample.close(); closing exportFrame separately would double-close it.
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
    const timestamp = cursor / plan.audioSampleRate;
    const pcm = await mixAudioWindow(
      timeline,
      sources,
      timestamp,
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
      timestamp,
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
  const totalAudioFrames = Math.max(1, Math.ceil(plan.duration * plan.audioSampleRate));
  let audioCursor = 0;

  for (let videoStart = 0; videoStart < plan.totalFrames; videoStart += videoFramesPerSlice) {
    const videoEnd = Math.min(plan.totalFrames, videoStart + videoFramesPerSlice);
    await encodeVideoRange(options, plan, videoSource, startedAt, videoStart, videoEnd);

    if (audioSource) {
      const sliceEndTime = Math.min(plan.duration, videoEnd / plan.frameRate);
      const audioEnd = Math.min(totalAudioFrames, Math.ceil(sliceEndTime * plan.audioSampleRate));
      await encodeAudioRange(options, plan, audioSource, startedAt, audioCursor, audioEnd);
      audioCursor = audioEnd;
    }
  }

  if (audioSource && audioCursor < totalAudioFrames) {
    await encodeAudioRange(options, plan, audioSource, startedAt, audioCursor, totalAudioFrames);
  }
}

export async function exportTimelineToMp4(
  options: TimelineExportOptions,
): Promise<TimelineExportResult> {
  const plan = buildExportPlan(
    options.timeline,
    options.sources,
    options.preset,
    options.throughputProbe,
  );
  throwIfCanceled(options.signal);
  await assertVideoEncoderSupported(plan);
  await assertAudioEncoderSupported(plan);

  let writable: FileSystemWritableFileStream | null = null;
  let output: Output<Mp4OutputFormat, StreamTarget> | null = null;
  let videoSource: VideoSampleSource | null = null;
  let audioSource: AudioSampleSource | null = null;

  try {
    writable = await options.outputHandle.createWritable();
    const target = new StreamTarget(
      writable as unknown as WritableStream<StreamTargetChunk>,
      { chunked: true, chunkSize: MP4_CHUNK_BYTES },
    );
    output = new Output({
      format: new Mp4OutputFormat({ fastStart: false }),
      target,
    });

    videoSource = new VideoSampleSource({
      codec: 'avc',
      fullCodecString: H264_CODEC,
      bitrate: plan.videoBitrate,
      bitrateMode: 'variable',
      keyFrameInterval: 2,
      hardwareAcceleration: 'prefer-hardware',
      latencyMode: plan.preset === 'fast' ? 'realtime' : 'quality',
    });
    output.addVideoTrack(videoSource, { frameRate: plan.frameRate });

    audioSource = plan.hasAudio
      ? new AudioSampleSource({
          codec: 'aac',
          fullCodecString: AAC_CODEC,
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
    const mimeType = await output.getMimeType().catch(() => 'video/mp4');
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
