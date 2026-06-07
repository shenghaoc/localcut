import { describe, expect, it } from 'vitest';
import { deriveCapabilityTierV2, exportConstraintsForProbe } from './capability-probe-v2';
import { compatAdapterProbeResult, probeResultFor } from './compatibility/capability-fixtures';

describe('deriveCapabilityTierV2', () => {
  it('derives all fixture tiers', () => {
    for (const tier of ['core-webgpu', 'compatibility-webgpu', 'limited-webcodecs', 'shell-only'] as const) {
      const probe = probeResultFor(tier);
      expect(deriveCapabilityTierV2(probe)).toBe(tier);
    }
  });

  it('keeps decode-only browsers in limited-webcodecs instead of shell-only', () => {
    const probe = probeResultFor('limited-webcodecs');
    expect(probe.webCodecsDecode).toBe('supported');
    expect(probe.webCodecsEncode).toBe('unsupported');
    expect(deriveCapabilityTierV2(probe)).toBe('limited-webcodecs');
  });

  it('downgrades reduced encode support from core to compatibility-webgpu', () => {
    const probe = { ...probeResultFor('core-webgpu'), codecs: { ...probeResultFor('core-webgpu').codecs, av1Encode: 'unsupported' as const } };
    expect(deriveCapabilityTierV2(probe)).toBe('compatibility-webgpu');
  });

  it('requires OffscreenCanvas before selecting reduced preview tiers', () => {
    const probe = { ...probeResultFor('compatibility-webgpu'), offscreenCanvas: 'unsupported' as const };
    expect(deriveCapabilityTierV2(probe)).toBe('shell-only');
  });

  it('keeps a compat-adapter-only session in compatibility-webgpu', () => {
    const probe = compatAdapterProbeResult();
    expect(probe.webGPUCore).toBe('unsupported');
    expect(probe.webGPUCompat).toBe('supported');
    expect(probe.compatibilityAdapter).toBe(true);
    expect(deriveCapabilityTierV2(probe)).toBe('compatibility-webgpu');
  });
});

describe('exportConstraintsForProbe', () => {
  it('keeps unsupported codec/container pairs out of the picker', () => {
    const probe = probeResultFor('compatibility-webgpu');
    expect(exportConstraintsForProbe(probe)).toEqual([
      { codec: 'h264', container: 'mp4' },
      { codec: 'vp9', container: 'webm' },
    ]);
  });
});
