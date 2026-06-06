/** Title raster path + GPU texture cache — Phase 14.
 *
 * Rasterization (OffscreenCanvas 2D) and the `copyExternalImageToTexture`
 * upload happen ONLY on the edit path ({@link TitleTextureCache.rasterize} /
 * `ensure`), driven by `add-title`/`set-title`. The per-frame compositor reads
 * the cached texture via {@link TitleTextureCache.get} and NEVER rasters or
 * uploads — the accelerated hot path stays free of Canvas2D / CPU pixel
 * round-trips. The cache key covers the text and every style field so a stale
 * texture can never silently show old text.
 */

import {
  TITLE_RASTER_HEIGHT,
  normalizeTitleStyle,
  titleContentHash,
  type TitleContent,
} from './title';

/** 16:9 raster box; titles lay out against this via the Phase 12 transform. */
export const TITLE_RASTER_WIDTH = Math.round((TITLE_RASTER_HEIGHT * 16) / 9);

/** A cached, GPU-resident title raster ready to composite. */
export interface TitleTexture {
  view: GPUTextureView;
  width: number;
  height: number;
  /** Backing GPU texture owned by the uploader; absent in test fakes. */
  texture?: GPUTexture;
}

/**
 * Produces and destroys GPU textures for title content. Injected into the cache
 * so the keying/invalidation logic is testable without a real device (T2.3).
 */
export interface TitleUploader {
  /** Raster + GPU upload for one title. EDIT-PATH ONLY (never per frame). */
  upload(content: TitleContent): TitleTexture;
  destroy(texture: TitleTexture): void;
}

interface CacheEntry {
  hash: string;
  texture: TitleTexture;
}

/**
 * Per-clip title texture cache keyed by (clipId, contentHash). `rasterize`/
 * `ensure` are the only methods that touch the uploader (the cold edit path);
 * `get` is the per-frame read and must stay raster/upload-free.
 */
export class TitleTextureCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly uploader: TitleUploader) {}

  /**
   * Edit-time (re)raster: uploads a fresh texture iff the content hash changed,
   * destroying the superseded one; otherwise returns the cached texture intact.
   */
  rasterize(clipId: string, content: TitleContent): TitleTexture {
    const hash = titleContentHash(content);
    const existing = this.entries.get(clipId);
    if (existing && existing.hash === hash) return existing.texture;
    const texture = this.uploader.upload(content);
    if (existing) this.uploader.destroy(existing.texture);
    this.entries.set(clipId, { hash, texture });
    return texture;
  }

  /** Cold-path guarantee that a current texture exists (used before export). */
  ensure(clipId: string, content: TitleContent): TitleTexture {
    return this.rasterize(clipId, content);
  }

  /** Per-frame read; `null` until first rastered. Never rasters or uploads. */
  get(clipId: string): TitleTexture | null {
    return this.entries.get(clipId)?.texture ?? null;
  }

  /** Cached content hash for a clip, or `null` — exposed for upload-once tests. */
  hashFor(clipId: string): string | null {
    return this.entries.get(clipId)?.hash ?? null;
  }

  remove(clipId: string): void {
    const entry = this.entries.get(clipId);
    if (!entry) return;
    this.uploader.destroy(entry.texture);
    this.entries.delete(clipId);
  }

  /** Drops textures for clips no longer on the timeline (post-edit cleanup). */
  retain(activeClipIds: ReadonlySet<string>): void {
    for (const clipId of [...this.entries.keys()]) {
      if (!activeClipIds.has(clipId)) this.remove(clipId);
    }
  }

  destroy(): void {
    for (const entry of this.entries.values()) this.uploader.destroy(entry.texture);
    this.entries.clear();
  }
}

interface BundledFont {
  family: string;
  url: string;
  weight?: string;
}

/**
 * Bundled open-licence fonts under `public/fonts/`. They load before the first
 * raster so the PWA renders titles offline. Missing/blocked bundles fall back to
 * the browser's generic family (also offline-safe) rather than failing.
 */
const BUNDLED_FONTS: BundledFont[] = [
  // Inter (OFL) and Lora (OFL); see public/fonts/*-OFL.txt.
  { family: 'LocalCut Sans', url: '/fonts/localcut-sans.woff2', weight: '400 700' },
  { family: 'LocalCut Serif', url: '/fonts/localcut-serif.ttf', weight: '400 700' },
];

let fontsReadyPromise: Promise<void> | null = null;

/**
 * Loads the bundled fonts in the worker via `FontFace` (idempotent). Resolves
 * even when a bundle is absent — the raster then uses a generic fallback family.
 * `queryLocalFonts` is a feature-detected enhancement only and never required.
 */
export function loadTitleFonts(): Promise<void> {
  if (fontsReadyPromise) return fontsReadyPromise;
  fontsReadyPromise = (async () => {
    const fontSet = (globalThis as unknown as { fonts?: FontFaceSet }).fonts;
    if (!fontSet || typeof FontFace === 'undefined') return;
    await Promise.all(
      BUNDLED_FONTS.map(async (font) => {
        try {
          const face = new FontFace(font.family, `url(${font.url})`, { weight: font.weight ?? '400' });
          await face.load();
          fontSet.add(face);
        } catch {
          // Bundle missing/blocked — generic fallback keeps titles offline-safe.
        }
      }),
    );
  })();
  return fontsReadyPromise;
}

/** True when the optional `queryLocalFonts` enhancement is available. */
export function hasLocalFontAccess(): boolean {
  return typeof (globalThis as unknown as { queryLocalFonts?: unknown }).queryLocalFonts === 'function';
}

type Canvas2D = OffscreenCanvasRenderingContext2D;

function withAlpha(ctx: Canvas2D, alpha: number, draw: () => void): void {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = alpha;
  draw();
  ctx.globalAlpha = prev;
}

function setShadow(ctx: Canvas2D, content: TitleContent, on: boolean): void {
  const style = normalizeTitleStyle(content.style);
  const active =
    on && (style.shadowBlurPx > 0 || style.shadowOffsetXPx !== 0 || style.shadowOffsetYPx !== 0);
  ctx.shadowColor = active ? style.shadowColor : 'transparent';
  ctx.shadowBlur = active ? style.shadowBlurPx : 0;
  ctx.shadowOffsetX = active ? style.shadowOffsetXPx : 0;
  ctx.shadowOffsetY = active ? style.shadowOffsetYPx : 0;
}

/**
 * Draws a title onto a transparent 2D canvas: optional background box, optional
 * outline (stroke under fill), optional drop shadow, multi-line aware. The
 * generic `sans-serif` fallback in the font string keeps text legible when a
 * bundled font failed to load (offline-safe).
 */
export function rasterizeTitleToCanvas(
  ctx: Canvas2D,
  width: number,
  height: number,
  content: TitleContent,
): void {
  const style = normalizeTitleStyle(content.style);
  ctx.clearRect(0, 0, width, height);

  const lines = content.text.length > 0 ? content.text.split('\n') : [''];
  const fontSize = style.fontSizePx;
  const lineHeight = fontSize * 1.25;
  ctx.font = `${fontSize}px "${style.fontFamily}", "LocalCut Sans", sans-serif`;
  ctx.textBaseline = 'middle';

  let maxWidth = 0;
  for (const line of lines) maxWidth = Math.max(maxWidth, ctx.measureText(line).width);
  const blockHeight = lineHeight * lines.length;
  const cx = width / 2;
  const cy = height / 2;
  const pad = fontSize * 0.3;

  if (style.backgroundOpacity > 0) {
    withAlpha(ctx, style.backgroundOpacity, () => {
      ctx.fillStyle = style.backgroundColor;
      ctx.fillRect(
        cx - maxWidth / 2 - pad,
        cy - blockHeight / 2 - pad,
        maxWidth + pad * 2,
        blockHeight + pad * 2,
      );
    });
  }

  ctx.textAlign = style.align;
  const anchorX = style.align === 'left' ? cx - maxWidth / 2 : style.align === 'right' ? cx + maxWidth / 2 : cx;

  lines.forEach((line, index) => {
    const ly = cy - blockHeight / 2 + lineHeight * (index + 0.5);
    // Shadow attaches to the outermost shape only (outline if present, else
    // fill) so it isn't doubled by drawing both stroke and fill.
    if (style.outlineWidthPx > 0) {
      setShadow(ctx, content, true);
      ctx.lineWidth = style.outlineWidthPx;
      ctx.strokeStyle = style.outlineColor;
      ctx.lineJoin = 'round';
      ctx.strokeText(line, anchorX, ly);
      setShadow(ctx, content, false);
    } else {
      setShadow(ctx, content, true);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, anchorX, ly);
    setShadow(ctx, content, false);
  });
}

/**
 * Real GPU uploader: rasters on a worker OffscreenCanvas and copies the result
 * into a cached `rgba8unorm` texture with straight (non-premultiplied) alpha —
 * the transform pass premultiplies it. EDIT-PATH ONLY; see the module header.
 */
export function createCanvasTitleUploader(device: GPUDevice): TitleUploader {
  const canvas = new OffscreenCanvas(TITLE_RASTER_WIDTH, TITLE_RASTER_HEIGHT);
  const ctx = canvas.getContext('2d', { alpha: true }) as Canvas2D | null;
  if (!ctx) throw new Error('Title raster: could not acquire a 2D context.');

  return {
    upload(content: TitleContent): TitleTexture {
      rasterizeTitleToCanvas(ctx, TITLE_RASTER_WIDTH, TITLE_RASTER_HEIGHT, content);
      const texture = device.createTexture({
        size: { width: TITLE_RASTER_WIDTH, height: TITLE_RASTER_HEIGHT },
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      // EDIT-PATH ONLY upload: happens on add-title/set-title, never in present().
      device.queue.copyExternalImageToTexture(
        { source: canvas },
        { texture, premultipliedAlpha: false },
        { width: TITLE_RASTER_WIDTH, height: TITLE_RASTER_HEIGHT },
      );
      return { view: texture.createView(), width: TITLE_RASTER_WIDTH, height: TITLE_RASTER_HEIGHT, texture };
    },
    destroy(texture: TitleTexture): void {
      texture.texture?.destroy();
    },
  };
}
