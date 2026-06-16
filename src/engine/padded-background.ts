/** Phase 43: Padded-background data types, normalisation, and renderer.
 *
 *  The padded-background preset places the capture clip inside a rounded-rect
 *  frame with an optional gradient/wallpaper background and a drop shadow.
 *  Rendering is a single WGSL compute pass — see shaders/padded-background.wgsl.
 */

import { hashString } from './cache-key';
import type { GradientStop, PaddedBackgroundParams } from '../protocol';

export type { GradientStop, PaddedBackgroundParams };

const DEFAULT_GRADIENT_STOPS: GradientStop[] = [
	{ color: '#1a1a2e', pos: 0 },
	{ color: '#16213e', pos: 1 }
];

export const DEFAULT_PADDED_BACKGROUND: PaddedBackgroundParams = {
	insetMargin: 0.08,
	cornerRadius: 16,
	shadowOpacity: 0.45,
	shadowRadius: 24,
	shadowOffsetY: 8,
	background: { kind: 'gradient', stops: DEFAULT_GRADIENT_STOPS, angleDeg: 0 }
};

/** Fill defaults for missing fields. */
export function normalizePaddedBackground(
	partial: Partial<PaddedBackgroundParams>
): PaddedBackgroundParams {
	const insetMargin =
		typeof partial.insetMargin === 'number'
			? clamp(partial.insetMargin, 0, 0.4)
			: DEFAULT_PADDED_BACKGROUND.insetMargin;
	const cornerRadius =
		typeof partial.cornerRadius === 'number'
			? clamp(partial.cornerRadius, 0, 64)
			: DEFAULT_PADDED_BACKGROUND.cornerRadius;
	const shadowOpacity =
		typeof partial.shadowOpacity === 'number'
			? clamp(partial.shadowOpacity, 0, 1)
			: DEFAULT_PADDED_BACKGROUND.shadowOpacity;
	const shadowRadius =
		typeof partial.shadowRadius === 'number'
			? clamp(partial.shadowRadius, 0, 64)
			: DEFAULT_PADDED_BACKGROUND.shadowRadius;
	const shadowOffsetY =
		typeof partial.shadowOffsetY === 'number'
			? clamp(partial.shadowOffsetY, -32, 32)
			: DEFAULT_PADDED_BACKGROUND.shadowOffsetY;
	const background = normalizeBackground(partial.background);
	return { insetMargin, cornerRadius, shadowOpacity, shadowRadius, shadowOffsetY, background };
}

function normalizeBackground(
	bg: PaddedBackgroundParams['background'] | undefined
): PaddedBackgroundParams['background'] {
	if (!bg) return DEFAULT_PADDED_BACKGROUND.background;
	switch (bg.kind) {
		case 'solid':
			return { kind: 'solid', color: typeof bg.color === 'string' ? bg.color : '#1a1a2e' };
		case 'gradient': {
			const stops = Array.isArray(bg.stops)
				? bg.stops.slice(0, 5).map((s) => ({
						color: typeof s.color === 'string' ? s.color : '#000000',
						pos: typeof s.pos === 'number' ? clamp(s.pos, 0, 1) : 0
					}))
				: DEFAULT_GRADIENT_STOPS;
			const angleDeg = typeof bg.angleDeg === 'number' ? bg.angleDeg : 0;
			return { kind: 'gradient', stops, angleDeg };
		}
		case 'wallpaper':
			return { kind: 'wallpaper', sourceId: typeof bg.sourceId === 'string' ? bg.sourceId : '' };
	}
}

/** Validate and parse a raw value, or return null. */
export function parsePaddedBackground(value: unknown): PaddedBackgroundParams | null {
	if (typeof value !== 'object' || value === null) return null;
	const obj = value as Record<string, unknown>;
	if (typeof obj.background !== 'object' || obj.background === null) return null;
	const bg = obj.background as Record<string, unknown>;
	if (bg.kind !== 'solid' && bg.kind !== 'gradient' && bg.kind !== 'wallpaper') return null;

	const result: Partial<PaddedBackgroundParams> = {};
	if (typeof obj.insetMargin === 'number') result.insetMargin = obj.insetMargin;
	if (typeof obj.cornerRadius === 'number') result.cornerRadius = obj.cornerRadius;
	if (typeof obj.shadowOpacity === 'number') result.shadowOpacity = obj.shadowOpacity;
	if (typeof obj.shadowRadius === 'number') result.shadowRadius = obj.shadowRadius;
	if (typeof obj.shadowOffsetY === 'number') result.shadowOffsetY = obj.shadowOffsetY;
	result.background = bg as PaddedBackgroundParams['background'];

	return normalizePaddedBackground(result);
}

/** Derives a deterministic cache key for the shadow texture. */
export function shadowCacheKey(
	shadowRadius: number,
	cornerRadius: number,
	outputWidth: number,
	outputHeight: number
): string {
	return hashString(`shadow:${shadowRadius}:${cornerRadius}:${outputWidth}:${outputHeight}`).slice(
		0,
		16
	);
}

export interface PaddedWallpaperTexture {
	texture: GPUTexture;
	view: GPUTextureView;
	width: number;
	height: number;
}

export interface PaddedBackgroundWallpaperSource {
	sourceId: string;
	thumbnailAt?: (timeS: number) => Promise<ImageBitmap | null>;
}

/**
 * Small cache holder for Phase 43 wallpaper/shadow resources. The current
 * compositor path renders solid/gradient backgrounds directly; wallpaper lookup
 * remains an explicit cache-miss path until the media-bin picker is wired.
 */
export class PaddedBackgroundRenderer {
	private readonly wallpaperCache = new Map<string, PaddedWallpaperTexture>();

	constructor(private readonly device: GPUDevice) {}

	async wallpaperTextureFor(
		sourceId: string,
		outputWidth: number,
		outputHeight: number,
		resolve?: (sourceId: string) => PaddedBackgroundWallpaperSource | null
	): Promise<PaddedWallpaperTexture | null> {
		const key = `${sourceId}:${outputWidth}x${outputHeight}`;
		const cached = this.wallpaperCache.get(key);
		if (cached) return cached;
		const source = resolve?.(sourceId) ?? null;
		if (!source?.thumbnailAt) {
			console.warn(`Padded background wallpaper source not found: ${sourceId}`);
			return null;
		}
		const bitmap = await source.thumbnailAt(0);
		if (!bitmap) {
			console.warn(`Padded background wallpaper thumbnail unavailable: ${sourceId}`);
			return null;
		}
		const texture = this.device.createTexture({
			size: { width: outputWidth, height: outputHeight },
			format: 'rgba8unorm',
			usage:
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_DST |
				GPUTextureUsage.RENDER_ATTACHMENT
		});
		this.device.queue.copyExternalImageToTexture(
			{ source: bitmap },
			{ texture },
			{ width: outputWidth, height: outputHeight }
		);
		bitmap.close?.();
		const entry = { texture, view: texture.createView(), width: outputWidth, height: outputHeight };
		this.wallpaperCache.set(key, entry);
		return entry;
	}

	dispose(): void {
		for (const entry of this.wallpaperCache.values()) entry.texture.destroy();
		this.wallpaperCache.clear();
	}
}

function clamp(v: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, v));
}
