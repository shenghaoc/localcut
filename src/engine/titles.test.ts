import { describe, expect, it } from 'vitest';
import { TitleTextureCache, type TitleTexture, type TitleUploader } from './titles';
import {
  DEFAULT_TITLE_STYLE,
  normalizeTitleContent,
  type TitleContent,
  type TitleStyle,
} from './title';

/** Records uploads/destroys so cache keying is observable without a GPU. */
function fakeUploader() {
  let nextId = 0;
  const uploads: TitleContent[] = [];
  const destroyed: number[] = [];
  const uploader: TitleUploader = {
    upload(content) {
      uploads.push(normalizeTitleContent(content));
      const id = nextId++;
      return { view: { id } as unknown as GPUTextureView, width: 1920, height: 1080, _id: id } as
        TitleTexture & { _id: number };
    },
    destroy(texture) {
      destroyed.push((texture as TitleTexture & { _id: number })._id);
    },
  };
  return { uploader, uploads, destroyed };
}

const ALT: { [K in keyof TitleStyle]: TitleStyle[K] } = {
  fontFamily: 'Other Font',
  fontSizePx: 200,
  color: '#111111',
  backgroundColor: '#222222',
  backgroundOpacity: 0.5,
  outlineColor: '#333333',
  outlineWidthPx: 4,
  shadowColor: '#444444',
  shadowBlurPx: 8,
  shadowOffsetXPx: 6,
  shadowOffsetYPx: 6,
  align: 'right',
};

function content(partial?: Partial<TitleContent>): TitleContent {
  return normalizeTitleContent(partial);
}

describe('TitleTextureCache', () => {
  it('uploads once and reuses on a no-op edit', () => {
    const { uploader, uploads } = fakeUploader();
    const cache = new TitleTextureCache(uploader);

    const first = cache.rasterize('clip-1', content({ text: 'Hi' }));
    const second = cache.rasterize('clip-1', content({ text: 'Hi' }));

    expect(uploads).toHaveLength(1);
    expect(second).toBe(first);
    expect(cache.get('clip-1')).toBe(first);
  });

  it('re-rasters and destroys the old texture on a text-only edit', () => {
    const { uploader, uploads, destroyed } = fakeUploader();
    const cache = new TitleTextureCache(uploader);

    const first = cache.rasterize('clip-1', content({ text: 'A' }));
    const second = cache.rasterize('clip-1', content({ text: 'B' }));

    expect(uploads).toHaveLength(2);
    expect(second).not.toBe(first);
    // The superseded texture is destroyed exactly once.
    expect(destroyed).toEqual([(first as TitleTexture & { _id: number })._id]);
  });

  it('re-rasters when ANY style field changes', () => {
    for (const key of Object.keys(DEFAULT_TITLE_STYLE) as (keyof TitleStyle)[]) {
      const { uploader, uploads } = fakeUploader();
      const cache = new TitleTextureCache(uploader);
      cache.rasterize('clip', content());
      cache.rasterize('clip', content({ style: { ...DEFAULT_TITLE_STYLE, [key]: ALT[key] } }));
      expect(uploads, `field ${key} should re-raster`).toHaveLength(2);
    }
  });

  it('keys per clip id', () => {
    const { uploader, uploads } = fakeUploader();
    const cache = new TitleTextureCache(uploader);
    cache.rasterize('a', content({ text: 'same' }));
    cache.rasterize('b', content({ text: 'same' }));
    expect(uploads).toHaveLength(2);
    expect(cache.get('a')).not.toBe(cache.get('b'));
  });

  it('get never uploads and returns null until rastered', () => {
    const { uploader, uploads } = fakeUploader();
    const cache = new TitleTextureCache(uploader);
    expect(cache.get('missing')).toBeNull();
    expect(uploads).toHaveLength(0);
  });

  it('remove and retain drop textures and destroy them', () => {
    const { uploader, destroyed } = fakeUploader();
    const cache = new TitleTextureCache(uploader);
    const a = cache.rasterize('a', content({ text: 'a' }));
    cache.rasterize('b', content({ text: 'b' }));

    cache.remove('a');
    expect(cache.get('a')).toBeNull();
    expect(destroyed).toContain((a as TitleTexture & { _id: number })._id);

    cache.retain(new Set<string>()); // keep nothing
    expect(cache.get('b')).toBeNull();
  });

  it('destroy clears every cached texture', () => {
    const { uploader, destroyed } = fakeUploader();
    const cache = new TitleTextureCache(uploader);
    cache.rasterize('a', content({ text: 'a' }));
    cache.rasterize('b', content({ text: 'b' }));
    cache.destroy();
    expect(destroyed).toHaveLength(2);
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBeNull();
  });
});
