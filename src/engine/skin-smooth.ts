/** Phase 32a: GPU Skin Smoothing — TypeScript reference implementation and GPU packing helpers.
 *
 *  The reference implementation mirrors the WGSL math exactly and is used
 *  exclusively by golden tests. The GPU packing helpers are the only functions
 *  imported by gpu.ts and the worker at runtime.
 */

// ─── Constants (mirrored literally in WGSL) ─────────────────────────────

export const SKIN_SMOOTH_EPSILON = 0.01;
export const LUMA_BT709 = [0.2126, 0.7152, 0.0722] as const;
export const LUMA_BT601 = [0.299, 0.587, 0.114] as const;
export const CB_SCALE = 0.564;
export const CR_SCALE = 0.713;

// ─── Types ──────────────────────────────────────────────────────────────

export interface SkinMaskParams {
	cbMin: number;
	cbMax: number;
	crMin: number;
	crMax: number;
	softness: number;
}

export const DEFAULT_SKIN_MASK: SkinMaskParams = {
	cbMin: -0.2,
	cbMax: 0.0,
	crMin: 0.05,
	crMax: 0.2,
	softness: 0.04
};

// ─── Helpers ────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function isFiniteNum(v: number | undefined): v is number {
	return v !== undefined && Number.isFinite(v);
}

/** sRGB OETF: linear → gamma-encoded. Applied per-channel for mask computation. */
function srgbOETF(linear: number): number {
	return linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
}

/** Hermite smoothstep: 3t² − 2t³, clamped to [0,1]. */
function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
	return t * t * (3 - 2 * t);
}

/** Soft band-pass: full weight inside [lo, hi], smooth falloff of width s outside. */
function band(v: number, lo: number, hi: number, s: number): number {
	return smoothstep(lo - s, lo, v) * (1 - smoothstep(hi, hi + s, v));
}

// ─── Normalize ──────────────────────────────────────────────────────────

/** Clamp/swap/finite validation — source of truth for mask normalization. */
export function normalizeSkinMask(partial: Partial<SkinMaskParams> | undefined): SkinMaskParams {
	const raw = partial ?? {};

	let cbMin = isFiniteNum(raw.cbMin) ? clamp(raw.cbMin, -0.5, 0.5) : DEFAULT_SKIN_MASK.cbMin;
	let cbMax = isFiniteNum(raw.cbMax) ? clamp(raw.cbMax, -0.5, 0.5) : DEFAULT_SKIN_MASK.cbMax;
	let crMin = isFiniteNum(raw.crMin) ? clamp(raw.crMin, -0.5, 0.5) : DEFAULT_SKIN_MASK.crMin;
	let crMax = isFiniteNum(raw.crMax) ? clamp(raw.crMax, -0.5, 0.5) : DEFAULT_SKIN_MASK.crMax;
	const softness = isFiniteNum(raw.softness)
		? clamp(raw.softness, 0.005, 0.15)
		: DEFAULT_SKIN_MASK.softness;

	// Swap when min > max after clamping
	if (cbMin > cbMax) {
		const tmp = cbMin;
		cbMin = cbMax;
		cbMax = tmp;
	}
	if (crMin > crMax) {
		const tmp = crMin;
		crMin = crMax;
		crMax = tmp;
	}

	return { cbMin, cbMax, crMin, crMax, softness };
}

// ─── Radius ─────────────────────────────────────────────────────────────

/** Filter radius derived from processed frame height: 1080p → 8, 540p → 4, 2160p → 16. */
export function radiusForHeight(h: number): number {
	return clamp(Math.round((8 * h) / 1080), 2, 24);
}

// ─── Skin mask ──────────────────────────────────────────────────────────

/**
 * Returns mask weight m ∈ [0,1] for a gamma-encoded (sRGB OETF) RGB triple.
 * The input rgb is assumed to be in [0,1] gamma-encoded space.
 */
export function skinMaskWeight(
	rgb: readonly [number, number, number],
	mask: SkinMaskParams
): number {
	const rG = srgbOETF(clamp(rgb[0], 0, 1));
	const gG = srgbOETF(clamp(rgb[1], 0, 1));
	const bG = srgbOETF(clamp(rgb[2], 0, 1));

	const Y601 = rG * LUMA_BT601[0] + gG * LUMA_BT601[1] + bG * LUMA_BT601[2];
	const Cb = (bG - Y601) * CB_SCALE;
	const Cr = (rG - Y601) * CR_SCALE;

	return (
		band(Cb, mask.cbMin, mask.cbMax, mask.softness) *
		band(Cr, mask.crMin, mask.crMax, mask.softness)
	);
}

// ─── Reference guided filter ────────────────────────────────────────────

/** Separable 1-D box blur with border-clamp. */
function boxBlur1D(
	src: Float32Array,
	dst: Float32Array,
	width: number,
	height: number,
	radius: number,
	horizontal: boolean
): void {
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let sum = 0;
			let count = 0;
			for (let k = -radius; k <= radius; k++) {
				const sx = horizontal ? clamp(x + k, 0, width - 1) : x;
				const sy = horizontal ? y : clamp(y + k, 0, height - 1);
				sum += src[sy * width + sx]!;
				count++;
			}
			dst[y * width + x] = sum / count;
		}
	}
}

/**
 * Reference guided filter on luma for a single-channel Float32Array
 * (stride = width, linear light values). Returns a new Float32Array of
 * the same size with smoothed luma values.
 */
export function referenceGuidedFilterLuma(
	luma: Float32Array,
	width: number,
	height: number,
	radius: number,
	epsilon: number
): Float32Array {
	const n = width * height;

	// Pass 1: prepare (Y, Y²)
	const yy = new Float32Array(n * 2);
	for (let i = 0; i < n; i++) {
		const y = luma[i]!;
		yy[i * 2] = y;
		yy[i * 2 + 1] = y * y;
	}

	// Pass 2: box-H on (Y, Y²)
	const yyH = new Float32Array(n * 2);
	{
		const tmpA = new Float32Array(n);
		const tmpB = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			tmpA[i] = yy[i * 2]!;
			tmpB[i] = yy[i * 2 + 1]!;
		}
		const outA = new Float32Array(n);
		const outB = new Float32Array(n);
		boxBlur1D(tmpA, outA, width, height, radius, true);
		boxBlur1D(tmpB, outB, width, height, radius, true);
		for (let i = 0; i < n; i++) {
			yyH[i * 2] = outA[i]!;
			yyH[i * 2 + 1] = outB[i]!;
		}
	}

	// Pass 3: box-V on (Y, Y²) → (meanY, meanY²)
	const meanYY = new Float32Array(n * 2);
	{
		const tmpA = new Float32Array(n);
		const tmpB = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			tmpA[i] = yyH[i * 2]!;
			tmpB[i] = yyH[i * 2 + 1]!;
		}
		const outA = new Float32Array(n);
		const outB = new Float32Array(n);
		boxBlur1D(tmpA, outA, width, height, radius, false);
		boxBlur1D(tmpB, outB, width, height, radius, false);
		for (let i = 0; i < n; i++) {
			meanYY[i * 2] = outA[i]!;
			meanYY[i * 2 + 1] = outB[i]!;
		}
	}

	// Pass 4: coefficients (a, b)
	const ab = new Float32Array(n * 2);
	for (let i = 0; i < n; i++) {
		const meanY = meanYY[i * 2]!;
		const meanY2 = meanYY[i * 2 + 1]!;
		const variance = Math.max(0, meanY2 - meanY * meanY);
		const a = variance / (variance + epsilon);
		const b = (1 - a) * meanY;
		ab[i * 2] = a;
		ab[i * 2 + 1] = b;
	}

	// Pass 5: box-H on (a, b)
	const abH = new Float32Array(n * 2);
	{
		const tmpA = new Float32Array(n);
		const tmpB = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			tmpA[i] = ab[i * 2]!;
			tmpB[i] = ab[i * 2 + 1]!;
		}
		const outA = new Float32Array(n);
		const outB = new Float32Array(n);
		boxBlur1D(tmpA, outA, width, height, radius, true);
		boxBlur1D(tmpB, outB, width, height, radius, true);
		for (let i = 0; i < n; i++) {
			abH[i * 2] = outA[i]!;
			abH[i * 2 + 1] = outB[i]!;
		}
	}

	// Pass 6: box-V on (a, b) → (meanA, meanB)
	const meanAB = new Float32Array(n * 2);
	{
		const tmpA = new Float32Array(n);
		const tmpB = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			tmpA[i] = abH[i * 2]!;
			tmpB[i] = abH[i * 2 + 1]!;
		}
		const outA = new Float32Array(n);
		const outB = new Float32Array(n);
		boxBlur1D(tmpA, outA, width, height, radius, false);
		boxBlur1D(tmpB, outB, width, height, radius, false);
		for (let i = 0; i < n; i++) {
			meanAB[i * 2] = outA[i]!;
			meanAB[i * 2 + 1] = outB[i]!;
		}
	}

	// Pass 7 (partial): compute Y' = meanA * Y + meanB
	const result = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const meanA = meanAB[i * 2]!;
		const meanB = meanAB[i * 2 + 1]!;
		result[i] = meanA * luma[i]! + meanB;
	}

	return result;
}

/**
 * Full seven-pass reference: RGBA Float32Array in, RGBA Float32Array out.
 * strength ∈ [0,1]; mask defaults to DEFAULT_SKIN_MASK if omitted.
 * Input is in working-linear space. Returns a new Float32Array; input is not mutated.
 */
export function referenceSkinSmooth(
	rgba: Float32Array,
	width: number,
	height: number,
	strength: number,
	mask?: SkinMaskParams
): Float32Array {
	const n = width * height;
	const result = new Float32Array(rgba.length);

	if (strength <= 0) {
		result.set(rgba);
		return result;
	}

	const effectiveMask = mask ?? DEFAULT_SKIN_MASK;

	// Extract BT.709 luma from working-linear RGB
	const luma = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const r = rgba[i * 4]!;
		const g = rgba[i * 4 + 1]!;
		const b = rgba[i * 4 + 2]!;
		luma[i] = r * LUMA_BT709[0] + g * LUMA_BT709[1] + b * LUMA_BT709[2];
	}

	// Run guided filter on luma
	const smoothedLuma = referenceGuidedFilterLuma(luma, width, height, 4, SKIN_SMOOTH_EPSILON);

	// Compose: outRgb = clamp(rgbLin + strength * m * (Y' − Y), 0, 1)
	for (let i = 0; i < n; i++) {
		const r = rgba[i * 4]!;
		const g = rgba[i * 4 + 1]!;
		const b = rgba[i * 4 + 2]!;
		const a = rgba[i * 4 + 3]!;

		const Y = luma[i]!;
		const Yprime = smoothedLuma[i]!;
		const m = skinMaskWeight([r, g, b], effectiveMask);
		const delta = strength * m * (Yprime - Y);

		result[i * 4] = clamp(r + delta, 0, 1);
		result[i * 4 + 1] = clamp(g + delta, 0, 1);
		result[i * 4 + 2] = clamp(b + delta, 0, 1);
		result[i * 4 + 3] = a;
	}

	return result;
}

// ─── GPU packing helpers ────────────────────────────────────────────────

/** Returns a 4-element Uint32Array: [radius, dirX, dirY, 0] */
export function packSkinBoxUniform(radius: number, horizontal: boolean): Uint32Array {
	return new Uint32Array([radius, horizontal ? 1 : 0, horizontal ? 0 : 1, 0]);
}

/**
 * Returns an 8-element Float32Array: [strength, cbMin, cbMax, crMin, crMax, softness, 0, 0]
 * after normalizing mask to valid ranges.
 */
export function packSkinApplyUniform(
	strength: number,
	mask: SkinMaskParams | undefined
): Float32Array {
	const m = normalizeSkinMask(mask);
	return new Float32Array([strength, m.cbMin, m.cbMax, m.crMin, m.crMax, m.softness, 0, 0]);
}

/**
 * Returns true when skinSmoothStrength > 0.
 * Bypass is session-only state — gpu.ts consults bypass before calling encodeSkinSmooth.
 */
export function isSkinSmoothActive(params: { skinSmoothStrength: number }): boolean {
	return params.skinSmoothStrength > 0;
}
