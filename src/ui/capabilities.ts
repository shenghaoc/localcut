export type CapabilityFeature =
  | 'crossOriginIsolated'
  | 'sharedArrayBuffer'
  | 'webgpu'
  | 'webCodecs'
  | 'offscreenCanvas'
  | 'fileSystemAccess'
  | 'audioWorklet'
  | 'fileApi';

export type CapabilityTier = 'accelerated' | 'limited' | 'starting' | 'blocked';

export interface CapabilitySnapshot {
  fileApi: boolean;
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  webgpu: boolean;
  webCodecs: boolean;
  offscreenCanvas: boolean;
  fileSystemAccess: boolean;
  audioWorklet: boolean;
}

export interface CapabilityRuntime {
  workerReady: boolean;
  webgpuReady: boolean;
  runtimeIssue: string | null;
}

export interface CapabilityFeatureInfo {
  id: CapabilityFeature;
  label: string;
  available: boolean;
  detail: string;
  action: string | null;
}

const ACCELERATED_FEATURES: CapabilityFeature[] = [
  'crossOriginIsolated',
  'sharedArrayBuffer',
  'webgpu',
  'webCodecs',
  'offscreenCanvas',
];

function hasSharedArrayBuffer(): boolean {
  if (typeof SharedArrayBuffer !== 'function') return false;
  try {
    new SharedArrayBuffer(8);
    return true;
  } catch {
    return false;
  }
}

function hasAudioWorklet(): boolean {
  if (typeof AudioContext === 'undefined') return false;
  try {
    // `audioWorklet` is an instance accessor; reading it from the prototype throws
    // "Illegal invocation". Presence checks avoid calling the getter.
    return 'audioWorklet' in AudioContext.prototype;
  } catch {
    return false;
  }
}

function hasFileSystemAccess(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return 'showOpenFilePicker' in window || 'showSaveFilePicker' in window;
  } catch {
    return false;
  }
}

/** Feature-detect browser APIs independently (no user-agent inference). */
export function probeCapabilities(
  env: Partial<CapabilitySnapshot> = {},
): CapabilitySnapshot {
  return {
    fileApi: env.fileApi ?? typeof File !== 'undefined',
    crossOriginIsolated:
      env.crossOriginIsolated ?? globalThis.crossOriginIsolated === true,
    sharedArrayBuffer: env.sharedArrayBuffer ?? hasSharedArrayBuffer(),
    webgpu: env.webgpu ?? (typeof navigator !== 'undefined' && 'gpu' in navigator),
    webCodecs: env.webCodecs ?? typeof VideoDecoder !== 'undefined',
    offscreenCanvas: env.offscreenCanvas ?? typeof OffscreenCanvas !== 'undefined',
    fileSystemAccess: env.fileSystemAccess ?? hasFileSystemAccess(),
    audioWorklet: env.audioWorklet ?? hasAudioWorklet(),
  };
}

function hasAcceleratedFeatures(snapshot: CapabilitySnapshot): boolean {
  return ACCELERATED_FEATURES.every((feature) => snapshot[feature]);
}

export function deriveCapabilityTier(
  snapshot: CapabilitySnapshot,
  runtime: CapabilityRuntime,
): CapabilityTier {
  if (!snapshot.fileApi) return 'blocked';
  if (runtime.workerReady && runtime.webgpuReady && hasAcceleratedFeatures(snapshot)) {
    return 'accelerated';
  }
  if (runtime.workerReady) return 'limited';
  if (
    !runtime.workerReady &&
    snapshot.crossOriginIsolated &&
    snapshot.sharedArrayBuffer &&
    hasAcceleratedFeatures(snapshot) &&
    !runtime.runtimeIssue
  ) {
    return 'starting';
  }
  return 'limited';
}

export function missingAcceleratedFeatures(snapshot: CapabilitySnapshot): CapabilityFeature[] {
  return ACCELERATED_FEATURES.filter((feature) => !snapshot[feature]);
}

export function describeFeature(
  feature: CapabilityFeature,
  snapshot: CapabilitySnapshot,
): CapabilityFeatureInfo {
  const available = snapshot[feature];
  switch (feature) {
    case 'fileApi':
      return {
        id: feature,
        label: 'File API',
        available,
        detail: available
          ? 'Local file pickers and drag-and-drop are available.'
          : 'This browser cannot access local files.',
        action: available ? null : 'Use a modern desktop browser.',
      };
    case 'crossOriginIsolated':
      return {
        id: feature,
        label: 'COOP/COEP isolation',
        available,
        detail: available
          ? 'Cross-origin isolation is active for SharedArrayBuffer.'
          : 'This origin is missing COOP/COEP response headers.',
        action: available ? null : 'Serve the app with COOP/COEP headers (Cloudflare _headers or Vite dev server).',
      };
    case 'sharedArrayBuffer':
      return {
        id: feature,
        label: 'SharedArrayBuffer',
        available,
        detail: available
          ? 'Shared memory clock is available for accelerated playback.'
          : 'SharedArrayBuffer is unavailable without isolation.',
        action: available ? null : 'Enable cross-origin isolation, then reload.',
      };
    case 'webgpu':
      return {
        id: feature,
        label: 'WebGPU',
        available,
        detail: available
          ? 'GPU adapter API is exposed by the browser.'
          : 'WebGPU is not available in this browser or profile.',
        action: available ? null : 'Use Chromium with hardware acceleration enabled.',
      };
    case 'webCodecs':
      return {
        id: feature,
        label: 'WebCodecs',
        available,
        detail: available
          ? 'Hardware decode/encode APIs are available.'
          : 'WebCodecs is not exposed in this browser.',
        action: available ? null : 'Use a recent Chromium-based browser.',
      };
    case 'offscreenCanvas':
      return {
        id: feature,
        label: 'OffscreenCanvas',
        available,
        detail: available
          ? 'Worker-owned canvas transfer is supported.'
          : 'OffscreenCanvas is unavailable.',
        action: available ? null : 'Use a modern Chromium browser.',
      };
    case 'fileSystemAccess':
      return {
        id: feature,
        label: 'File System Access',
        available,
        detail: available
          ? 'Direct save-to-disk export pickers are available.'
          : 'Export destination pickers require File System Access.',
        action: available ? null : 'Use Chromium desktop for direct MP4 export.',
      };
    case 'audioWorklet':
      return {
        id: feature,
        label: 'AudioWorklet',
        available,
        detail: available
          ? 'Low-latency audio graph is available.'
          : 'AudioWorklet is unavailable; audio sync may be disabled.',
        action: available ? null : 'Use a browser with AudioWorklet support.',
      };
  }
}

export function listCapabilityFeatures(
  snapshot: CapabilitySnapshot,
): CapabilityFeatureInfo[] {
  const order: CapabilityFeature[] = [
    'fileApi',
    'crossOriginIsolated',
    'sharedArrayBuffer',
    'webgpu',
    'webCodecs',
    'offscreenCanvas',
    'fileSystemAccess',
    'audioWorklet',
  ];
  return order.map((feature) => describeFeature(feature, snapshot));
}

/** Decode-only thumbnail fallback is available when local files can be opened. */
export function canCompatibilityPreview(snapshot: CapabilitySnapshot): boolean {
  return snapshot.fileApi;
}

export function primaryLimitedIssue(
  snapshot: CapabilitySnapshot,
  runtime: CapabilityRuntime,
): string | null {
  if (runtime.runtimeIssue) return runtime.runtimeIssue;
  if (!snapshot.crossOriginIsolated) {
    return 'This page is missing COOP/COEP headers. LocalCut still runs as a client-side shell, but accelerated import, playback, effects, and export need those headers so the browser can expose SharedArrayBuffer for local CPU/GPU work.';
  }
  if (!snapshot.sharedArrayBuffer) {
    return 'This browser or origin cannot expose SharedArrayBuffer. The app shell stays client-side, but accelerated import, playback, effects, and export need SAB plus COOP/COEP headers so the local CPU/GPU path can run safely.';
  }
  if (runtime.workerReady && !runtime.webgpuReady) {
    return 'WebGPU is unavailable in this browser. Accelerated import, playback, effects, and export require a WebGPU-capable Chromium browser.';
  }
  return null;
}

export function importUnavailableReason(
  tier: CapabilityTier,
  snapshot: CapabilitySnapshot,
  runtime: CapabilityRuntime,
): string | null {
  if (tier === 'accelerated') return null;
  if (tier === 'starting') return 'Waiting for the accelerated pipeline to finish starting…';
  if (tier === 'blocked') return 'This browser cannot access local media files.';
  if (canCompatibilityPreview(snapshot)) {
    return 'Accelerated import is unavailable. Compatibility import loads a reduced thumbnail preview only.';
  }
  return primaryLimitedIssue(snapshot, runtime) ?? 'Import is unavailable in limited mode.';
}
