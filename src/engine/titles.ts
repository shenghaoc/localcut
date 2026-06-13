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
	type TitleRasterExtras
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
	upload(content: TitleContent, extras?: TitleRasterExtras): TitleTexture;
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
	rasterize(clipId: string, content: TitleContent, extras?: TitleRasterExtras): TitleTexture {
		const hash = titleContentHash(content, extras);
		const existing = this.entries.get(clipId);
		if (existing && existing.hash === hash) return existing.texture;
		const texture = this.uploader.upload(content, extras);
		if (existing) this.uploader.destroy(existing.texture);
		this.entries.set(clipId, { hash, texture });
		return texture;
	}

	/** Cold-path guarantee that a current texture exists (used before export). */
	ensure(clipId: string, content: TitleContent, extras?: TitleRasterExtras): TitleTexture {
		return this.rasterize(clipId, content, extras);
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
	{ family: 'LocalCut Serif', url: '/fonts/localcut-serif.ttf', weight: '400 700' }
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
					const face = new FontFace(font.family, `url(${font.url})`, {
						weight: font.weight ?? '400'
					});
					await face.load();
					fontSet.add(face);
				} catch {
					// Bundle missing/blocked — generic fallback keeps titles offline-safe.
				}
			})
		);
	})();
	return fontsReadyPromise;
}

/** True when the optional `queryLocalFonts` enhancement is available. */
export function hasLocalFontAccess(): boolean {
	return (
		typeof (globalThis as unknown as { queryLocalFonts?: unknown }).queryLocalFonts === 'function'
	);
}

type Canvas2D = OffscreenCanvasRenderingContext2D;

function withAlpha(ctx: Canvas2D, alpha: number, draw: () => void): void {
	const prev = ctx.globalAlpha;
	ctx.globalAlpha = alpha;
	try {
		draw();
	} finally {
		ctx.globalAlpha = prev;
	}
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
 * outline (stroke under fill), optional drop shadow, optional glow, optional
 * per-line pills, multi-line aware. The generic `sans-serif` fallback in the
 * font string keeps text legible when a bundled font failed to load (offline-safe).
 *
 * Phase 30: CJK script falls back to the system font stack via canvas font
 * fallback: `'LocalCut Sans', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif`.
 */
export function rasterizeTitleToCanvas(
	ctx: Canvas2D,
	width: number,
	height: number,
	content: TitleContent,
	extras?: TitleRasterExtras
): void {
	const style = normalizeTitleStyle(content.style);
	ctx.clearRect(0, 0, width, height);

	const lines = content.text.length > 0 ? content.text.split('\n') : [''];
	const fontSize = style.fontSizePx;
	const lineHeight = fontSize * 1.25;
	ctx.font = `${fontSize}px "${style.fontFamily}", "LocalCut Sans", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`;
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
				blockHeight + pad * 2
			);
		});
	}

	// Phase 30: per-line background pills (drawn before text).
	if (extras?.pill) {
		const pill = extras.pill;
		ctx.textAlign = style.align;
		const anchorX =
			style.align === 'left' ? cx - maxWidth / 2 : style.align === 'right' ? cx + maxWidth / 2 : cx;
		withAlpha(ctx, pill.opacity, () => {
			ctx.fillStyle = pill.color;
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i]!;
				const lineW = ctx.measureText(line).width;
				const ly = cy - blockHeight / 2 + lineHeight * (i + 0.5);
				const rx =
					style.align === 'left'
						? anchorX - pill.paddingXPx
						: style.align === 'right'
							? anchorX - lineW - pill.paddingXPx
							: anchorX - lineW / 2 - pill.paddingXPx;
				const ry = ly - lineHeight / 2 - pill.paddingYPx;
				const rw = lineW + pill.paddingXPx * 2;
				const rh = lineHeight + pill.paddingYPx * 2;
				ctx.beginPath();
				ctx.roundRect(rx, ry, rw, rh, pill.radiusPx);
				ctx.fill();
			}
		});
	}

	ctx.textAlign = style.align;
	const anchorX =
		style.align === 'left' ? cx - maxWidth / 2 : style.align === 'right' ? cx + maxWidth / 2 : cx;

	// Phase 30: glow pass — zero-offset shadow to produce a halo, then draw
	// text body with shadowBlur = 0. The transparent-fill technique is a
	// standard Canvas2D idiom for emitting only the shadow: WebKit, Blink and
	// Gecko all honour `shadowBlur` when `fillStyle` is `'transparent'` because
	// the shadow is computed from the rasterized shape alpha, not the colour.
	// We iterate with the array index (not `lines.indexOf(line)`) so duplicate
	// lines — e.g. an SRT cue containing `"OK\nOK\nOK"` — each get their own
	// glow halo at the correct y-position.
	if (extras?.glow) {
		ctx.shadowColor = extras.glow.color;
		ctx.shadowBlur = extras.glow.blurPx;
		ctx.shadowOffsetX = 0;
		ctx.shadowOffsetY = 0;
		ctx.fillStyle = 'transparent';
		lines.forEach((line, lineIdx) => {
			const ly = cy - blockHeight / 2 + lineHeight * (lineIdx + 0.5);
			ctx.fillText(line, anchorX, ly);
		});
		ctx.shadowBlur = 0;
	}

	// Karaoke per-word highlight: when extras.highlightWord targets the current
	// line, walk the line word-by-word so the active word can use a distinct
	// fill colour while keeping every other word in the base style. Otherwise
	// fall back to a single fillText call per line — same output as before this
	// branch existed.
	const highlight = extras?.highlightWord;

	lines.forEach((line, index) => {
		const ly = cy - blockHeight / 2 + lineHeight * (index + 0.5);
		const targetLine = highlight?.lineIndex ?? 0;
		const wordHighlightActive = highlight !== undefined && index === targetLine && line.length > 0;

		if (!wordHighlightActive) {
			// Existing single-fill path.
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
			return;
		}

		// Word-by-word path. measureText handles the chosen font + size so the
		// total reflows naturally — we only need a starting x and the per-word
		// advance. Use textAlign='left' inside the loop and compute the left
		// edge from the original alignment so the line still anchors correctly.
		const savedAlign = ctx.textAlign;
		const tokens = line.split(/(\s+)/); // keeps the whitespace runs as tokens
		let wordCounter = 0;
		const lineWidth = ctx.measureText(line).width;
		const startX =
			style.align === 'left'
				? anchorX
				: style.align === 'right'
					? anchorX - lineWidth
					: anchorX - lineWidth / 2;
		ctx.textAlign = 'left';
		let cursorX = startX;
		for (const token of tokens) {
			const tokenWidth = ctx.measureText(token).width;
			const isWhitespace = /^\s+$/.test(token);
			if (token.length > 0 && !isWhitespace) {
				const isActive = wordCounter === highlight!.wordIndex;
				if (style.outlineWidthPx > 0) {
					setShadow(ctx, content, true);
					ctx.lineWidth = style.outlineWidthPx;
					ctx.strokeStyle = style.outlineColor;
					ctx.lineJoin = 'round';
					ctx.strokeText(token, cursorX, ly);
					setShadow(ctx, content, false);
				} else {
					setShadow(ctx, content, true);
				}
				ctx.fillStyle = isActive ? highlight!.color : style.color;
				ctx.fillText(token, cursorX, ly);
				setShadow(ctx, content, false);
				wordCounter += 1;
			}
			cursorX += tokenWidth;
		}
		ctx.textAlign = savedAlign;
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
		upload(content: TitleContent, extras?: TitleRasterExtras): TitleTexture {
			rasterizeTitleToCanvas(ctx, TITLE_RASTER_WIDTH, TITLE_RASTER_HEIGHT, content, extras);
			const texture = device.createTexture({
				size: { width: TITLE_RASTER_WIDTH, height: TITLE_RASTER_HEIGHT },
				format: 'rgba8unorm',
				// copyExternalImageToTexture REQUIRES both COPY_DST and RENDER_ATTACHMENT
				// on the destination (WebGPU spec); TEXTURE_BINDING lets the transform
				// pass sample it. RENDER_ATTACHMENT is not optional here.
				usage:
					GPUTextureUsage.TEXTURE_BINDING |
					GPUTextureUsage.COPY_DST |
					GPUTextureUsage.RENDER_ATTACHMENT
			});
			// EDIT-PATH ONLY upload: happens on add-title/set-title, never in present().
			device.queue.copyExternalImageToTexture(
				{ source: canvas },
				{ texture, premultipliedAlpha: false },
				{ width: TITLE_RASTER_WIDTH, height: TITLE_RASTER_HEIGHT }
			);
			return {
				view: texture.createView(),
				width: TITLE_RASTER_WIDTH,
				height: TITLE_RASTER_HEIGHT,
				texture
			};
		},
		destroy(texture: TitleTexture): void {
			texture.texture?.destroy();
		}
	};
}
