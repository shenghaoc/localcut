import type {
  ClipDependencyKey,
  ProxyGenerationSettings,
  RenderCacheKey,
  RenderCacheEntry,
  SourceDependencyKey,
} from './cache-types';
import type { ExportSettings, SourceDescriptorSnapshot } from '../protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableNumber(value: number): string {
  if (Number.isNaN(value)) return '"NaN"';
  if (value === Number.POSITIVE_INFINITY) return '"Infinity"';
  if (value === Number.NEGATIVE_INFINITY) return '"-Infinity"';
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)));
}

function stablePrimitive(value: string | number | boolean | null | undefined): string {
  if (typeof value === 'number') return stableNumber(value);
  if (value === undefined) return '"__undefined__"';
  return JSON.stringify(value);
}

function stableArrayBufferView(value: ArrayBufferView): string {
  if (value instanceof DataView) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return stableStringify(Array.from(bytes));
  }
  const array = Array.from(value as unknown as Iterable<number>);
  return stableStringify(array);
}

export function stableStringify(value: unknown): string {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return stablePrimitive(value);
  }
  if (ArrayBuffer.isView(value)) {
    return stableArrayBufferView(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return stablePrimitive(String(value));
}

export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function hashStableValue(namespace: string, value: unknown): string {
  return `${namespace}:${hashString(stableStringify(value))}`;
}

export function sourceFingerprintFromDescriptor(source: SourceDescriptorSnapshot): string {
  return hashStableValue('source', {
    kind: source.kind,
    fileName: source.fileName,
    byteSize: source.byteSize,
    durationS: source.durationS,
    mimeType: source.mimeType,
    video: source.video,
    audio: source.audio,
    timing: source.timing,
  });
}

export function sourceConformanceHash(source: SourceDescriptorSnapshot): string {
  return hashStableValue('conformance', {
    adapterId: source.adapterId,
    kind: source.kind,
    durationS: source.durationS,
    video: source.video
      ? {
          frameRateMode: source.video.frameRateMode,
          rotationDeg: source.video.rotationDeg,
          trackStartS: source.video.trackStartS,
          trackDurationS: source.video.trackDurationS,
          codec: source.video.codec,
          canDecode: source.video.canDecode,
        }
      : undefined,
    audio: source.audio
      ? {
          channels: source.audio.channels,
          sampleRate: source.audio.sampleRate,
          trackStartS: source.audio.trackStartS,
          trackDurationS: source.audio.trackDurationS,
          codec: source.audio.codec,
          canDecode: source.audio.canDecode,
        }
      : undefined,
    timing: source.timing,
    healthStatus: source.health?.status,
  });
}

export function proxySettingsHash(settings: ProxyGenerationSettings): string {
  return hashStableValue('proxy-settings', settings);
}

export function canonicalExportSettingsForCache(settings: ExportSettings): ExportSettings {
  const canonical: ExportSettings = {
    preset: settings.preset,
    codec: settings.codec,
    container: settings.container,
    width: settings.width,
    height: settings.height,
    fps: settings.fps,
    videoBitrate: settings.videoBitrate,
  };
  if (settings.range) {
    canonical.range = {
      startS: settings.range.startS,
      endS: settings.range.endS,
    };
  }
  if (settings.sourceMode === 'proxy') {
    canonical.sourceMode = 'proxy';
  }
  return canonical;
}

export function exportSettingsHash(settings: ExportSettings): string {
  return hashStableValue('export-settings', canonicalExportSettingsForCache(settings));
}

export function renderCacheKeyHash(key: RenderCacheKey): string {
  return hashStableValue('render-cache-key', canonicalRenderCacheKey(key));
}

export function renderCacheKeysEqual(a: RenderCacheKey, b: RenderCacheKey): boolean {
  return stableStringify(canonicalRenderCacheKey(a)) === stableStringify(canonicalRenderCacheKey(b));
}

export function renderCacheEntryMatchesKey(
  entry: Pick<RenderCacheEntry, 'keyHash' | 'key'>,
  requestedKey: RenderCacheKey,
): boolean {
  return entry.keyHash === renderCacheKeyHash(requestedKey) && renderCacheKeysEqual(entry.key, requestedKey);
}

function sortStrings(values: readonly string[]): string[] {
  return [...values].sort();
}

function sortSources(values: readonly SourceDependencyKey[]): SourceDependencyKey[] {
  return [...values].sort((a, b) => {
    const source = a.sourceId.localeCompare(b.sourceId);
    if (source !== 0) return source;
    return a.fingerprint.localeCompare(b.fingerprint);
  });
}

function sortClips(values: readonly ClipDependencyKey[]): ClipDependencyKey[] {
  return [...values].sort((a, b) => {
    const track = a.trackId.localeCompare(b.trackId);
    if (track !== 0) return track;
    const start = a.startS - b.startS;
    if (start !== 0) return start;
    return a.clipId.localeCompare(b.clipId);
  });
}

export function canonicalRenderCacheKey(key: RenderCacheKey): RenderCacheKey {
  return {
    ...key,
    timelineRange: {
      startS: key.timelineRange.startS,
      endS: key.timelineRange.endS,
    },
    outputSize: {
      width: key.outputSize.width,
      height: key.outputSize.height,
    },
    sourceFingerprints: sortSources(key.sourceFingerprints),
    clipDependencies: sortClips(key.clipDependencies),
    transitionHashes: sortStrings(key.transitionHashes),
    titleTextureHashes: sortStrings(key.titleTextureHashes),
    lutHashes: sortStrings(key.lutHashes),
    keyframeHashes: sortStrings(key.keyframeHashes),
  };
}
