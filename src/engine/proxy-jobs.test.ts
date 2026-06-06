import { describe, expect, it } from 'vitest';
import {
  planProxyCandidates,
  proxyRecommendationReasons,
  proxyStatusForAsset,
  type ProxyPlanningOptions,
} from './proxy-jobs';
import type { MediaAssetSnapshot, SourceDescriptorSnapshot } from '../protocol';

function sourceFixture(patch: Partial<SourceDescriptorSnapshot> = {}): SourceDescriptorSnapshot {
  return {
    sourceId: 'source-1',
    fileName: 'large.mp4',
    kind: 'video',
    byteSize: 500_000_000,
    durationS: 60,
    mimeType: 'video/mp4',
    video: {
      width: 3840,
      height: 2160,
      frameRate: 30,
      frameRateMode: 'constant',
      codec: 'avc1.640028',
      canDecode: true,
    },
    audio: {
      channels: 2,
      sampleRate: 48_000,
      codec: 'mp4a.40.2',
      canDecode: true,
    },
    ...patch,
  };
}

describe('proxyRecommendationReasons', () => {
  it('recommends proxies for large, high-bitrate, VFR, heavy, or slow sources', () => {
    const source = sourceFixture({
      byteSize: 800_000_000,
      video: {
        width: 3840,
        height: 2160,
        frameRate: 60,
        frameRateMode: 'variable',
        codec: 'vp09.00.10.08',
        canDecode: true,
      },
    });

    expect(proxyRecommendationReasons(source, { encodeFps: 20, codec: 'h264', width: 1920, height: 1080 })).toEqual([
      'large-resolution',
      'high-bitrate',
      'variable-frame-rate',
      'heavy-codec',
      'slow-throughput',
    ]);
  });

  it('does not recommend proxies for small sources', () => {
    expect(
      proxyRecommendationReasons(
        sourceFixture({
          byteSize: 30_000_000,
          video: { width: 1280, height: 720, frameRate: 30, frameRateMode: 'constant', codec: 'avc1', canDecode: true },
        }),
      ),
    ).toEqual([]);
  });
});

describe('planProxyCandidates', () => {
  it('prioritizes active timeline, visible filmstrip, selected, then background sources', () => {
    const sources = [
      sourceFixture({ sourceId: 'background' }),
      sourceFixture({ sourceId: 'visible' }),
      sourceFixture({ sourceId: 'selected' }),
      sourceFixture({ sourceId: 'active' }),
    ];
    const options: ProxyPlanningOptions = {
      preference: 'automatic',
      activeSourceIds: new Set(['active']),
      visibleSourceIds: new Set(['visible']),
      selectedSourceIds: new Set(['selected']),
      activeRanges: [{ startS: 3, endS: 6 }],
    };

    const plans = planProxyCandidates(sources, options);

    expect(plans.map((plan) => `${plan.sourceId}:${plan.priority}`)).toEqual([
      'active:active-range',
      'visible:visible-filmstrip',
      'selected:selected-source',
      'background:background-bin',
    ]);
    expect(plans[0]!.activeRanges).toEqual([{ startS: 3, endS: 6 }]);
    expect(plans[0]!.settings.width).toBe(1280);
    expect(plans[0]!.settings.height).toBe(720);
  });

  it('respects selected-only and disabled preferences', () => {
    const sources = [sourceFixture({ sourceId: 'a' }), sourceFixture({ sourceId: 'b' })];
    expect(planProxyCandidates(sources, { preference: 'disabled' })).toEqual([]);
    expect(
      planProxyCandidates(sources, {
        preference: 'selected-only',
        selectedSourceIds: new Set(['b']),
      }).map((plan) => plan.sourceId),
    ).toEqual(['b']);
  });
});

describe('proxyStatusForAsset', () => {
  it('returns a serializable media-bin proxy recommendation', () => {
    const source = sourceFixture();
    const asset: MediaAssetSnapshot = {
      sourceId: source.sourceId,
      fileName: source.fileName,
      kind: source.kind,
      durationS: source.durationS,
      byteSize: source.byteSize,
      mimeType: source.mimeType,
      video: {
        width: source.video!.width,
        height: source.video!.height,
        frameRate: source.video!.frameRate,
        frameRateMode: source.video!.frameRateMode,
      },
      audio: {
        channels: source.audio!.channels,
        sampleRate: source.audio!.sampleRate,
      },
    };

    expect(proxyStatusForAsset(asset, null)).toMatchObject({
      status: 'recommended',
      mode: 'original',
    });
  });
});
