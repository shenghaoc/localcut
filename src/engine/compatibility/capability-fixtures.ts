import type { CapabilityProbeResult, CapabilityTierV2, CodecProbeResult, FeatureSupport } from '../../protocol';

const supportedCodecs: CodecProbeResult = {
  h264Decode: 'supported',
  vp9Decode: 'supported',
  av1Decode: 'supported',
  h264Encode: 'supported',
  vp9Encode: 'supported',
  av1Encode: 'supported',
  aacDecode: 'supported',
  opusDecode: 'supported',
  aacEncode: 'supported',
  opusEncode: 'supported',
} as const;

function baseProbe(): CapabilityProbeResult {
  return {
    crossOriginIsolated: true,
    sharedArrayBuffer: 'supported',
    webGPUCore: 'supported',
    webGPUCompat: 'unsupported',
    compatibilityAdapter: false,
    webCodecsDecode: 'supported',
    webCodecsEncode: 'supported',
    codecs: { ...supportedCodecs },
    fileSystemAccess: 'supported',
    opfs: 'supported',
    audioWorklet: 'supported',
    offscreenCanvas: 'supported',
    tier: 'core-webgpu',
  };
}

function setCodecs(value: FeatureSupport): CodecProbeResult {
  return {
    h264Decode: value,
    vp9Decode: value,
    av1Decode: value,
    h264Encode: value,
    vp9Encode: value,
    av1Encode: value,
    aacDecode: value,
    opusDecode: value,
    aacEncode: value,
    opusEncode: value,
  };
}

export function probeResultFor(tier: CapabilityTierV2): CapabilityProbeResult {
  const probe = baseProbe();
  switch (tier) {
    case 'core-webgpu':
      return probe;
    case 'compatibility-webgpu':
      return {
        ...probe,
        crossOriginIsolated: false,
        sharedArrayBuffer: 'unsupported',
        codecs: { ...probe.codecs, av1Encode: 'unsupported' },
        tier,
      };
    case 'limited-webcodecs':
      return {
        ...probe,
        webGPUCore: 'unsupported',
        webGPUCompat: 'unsupported',
        webCodecsEncode: 'unsupported',
        codecs: {
          ...probe.codecs,
          h264Encode: 'unsupported',
          vp9Encode: 'unsupported',
          av1Encode: 'unsupported',
          aacEncode: 'unsupported',
          opusEncode: 'unsupported',
        },
        fileSystemAccess: 'unsupported',
        tier,
      };
    case 'shell-only':
      return {
        ...probe,
        webGPUCore: 'unsupported',
        webGPUCompat: 'unsupported',
        webCodecsDecode: 'unsupported',
        webCodecsEncode: 'unsupported',
        codecs: setCodecs('unsupported'),
        fileSystemAccess: 'unsupported',
        offscreenCanvas: 'unsupported',
        tier,
      };
  }
}
