import { describe, expect, it } from 'vitest';
import metadataSource from './video-events.ts?raw';
import thumbnailSource from './thumbnail.ts?raw';

const FORBIDDEN_IMPORTS = [
  '../engine/gpu',
  '../engine/worker',
  '../engine/effects',
  '../engine/export',
  '../engine/playback',
];

describe('compatibility engine invariants', () => {
  it('does not import accelerated engine modules', () => {
    for (const [name, source] of [
      ['video-events.ts', metadataSource],
      ['thumbnail.ts', thumbnailSource],
    ] as const) {
      for (const forbidden of FORBIDDEN_IMPORTS) {
        expect(source, `${name} must not import ${forbidden}`).not.toContain(
          `from '${forbidden}'`,
        );
        expect(source, `${name} must not import ${forbidden}`).not.toContain(
          `from "${forbidden}"`,
        );
      }
      expect(source).not.toMatch(/queue\.submit/);
      expect(source).not.toMatch(/importExternalTexture/);
    }
  });
});
