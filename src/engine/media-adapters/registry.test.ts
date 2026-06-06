import { describe, expect, it } from 'vitest';
import { openMediaFile, selectPrimaryMediaAdapter } from './registry';
import type { MediaAdapter, MediaInputHandle } from './types';

function adapter(role: MediaAdapter['role'], canInspect = true): MediaAdapter {
  return {
    id: role === 'primary' ? 'mediabunny' : 'web-demuxer-diagnostics',
    role,
    canInspect: () => canInspect,
    inspect: async () => ({
      inspection: {
        sourceId: 'source-1',
        adapterId: 'mediabunny',
        fileName: 'clip.mp4',
        byteSize: 1,
        mimeType: 'video/mp4',
        container: 'mp4',
        durationS: 1,
        tracks: [],
      },
      warnings: [],
    }),
    ...(role === 'primary'
      ? {
          open: async () => {
            throw new Error('not used');
          },
        }
      : {}),
  };
}

describe('media adapter registry', () => {
  it('selects only primary adapters for playback/export handles', () => {
    const selected = selectPrimaryMediaAdapter(
      [adapter('diagnostic'), adapter('primary')],
      new File(['x'], 'clip.mp4', { type: 'video/mp4' }),
    );

    expect(selected?.role).toBe('primary');
    expect(selected?.id).toBe('mediabunny');
  });

  it('does not promote diagnostics-only adapters into the primary path', () => {
    const selected = selectPrimaryMediaAdapter(
      [adapter('diagnostic')],
      new File(['x'], 'clip.mp4', { type: 'video/mp4' }),
    );

    expect(selected).toBeNull();
  });

  it('skips primary adapters that cannot inspect the file', () => {
    const selected = selectPrimaryMediaAdapter(
      [adapter('primary', false), adapter('diagnostic')],
      new File(['x'], 'clip.mp4', { type: 'video/mp4' }),
    );

    expect(selected).toBeNull();
  });

  it('opens through an injected primary adapter for isolated registry tests', async () => {
    const handle = { sourceId: 'source-1' } as MediaInputHandle;
    const injected: MediaAdapter = {
      id: 'mediabunny',
      role: 'primary',
      canInspect: () => true,
      inspect: async () => ({
        inspection: {
          sourceId: 'source-1',
          adapterId: 'mediabunny',
          fileName: 'clip.mp4',
          byteSize: 1,
          mimeType: 'video/mp4',
          container: 'mp4',
          durationS: 1,
          tracks: [],
        },
        warnings: [],
      }),
      open: async () => ({
        handle,
        inspection: {
          sourceId: 'source-1',
          adapterId: 'mediabunny',
          fileName: 'clip.mp4',
          byteSize: 1,
          mimeType: 'video/mp4',
          container: 'mp4',
          durationS: 1,
          tracks: [],
        },
        conformance: {
          sourceId: 'source-1',
          adapterId: 'mediabunny',
          kind: 'video',
          durationS: 1,
          timing: {
            normalizedStartS: 0,
            durationS: 1,
            avOffsetS: 0,
            frameRateMode: 'constant',
          },
          health: 'ok',
        },
        warnings: [],
      }),
    };

    await expect(openMediaFile(new File(['x'], 'clip.mp4'), 'source-1', [adapter('diagnostic'), injected]))
      .resolves.toBe(handle);
  });
});
