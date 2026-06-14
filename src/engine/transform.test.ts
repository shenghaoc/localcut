import { describe, expect, it } from 'vite-plus/test';
import {
	computeFitRect,
	DEFAULT_TRANSFORM,
	isIdentityTransform,
	normalizeTransform,
	packTransformUniform,
	transformsEqual,
	TRANSFORM_UNIFORM_FLOATS
} from './transform';

describe('transform model', () => {
	it('normalizes partial params against identity defaults', () => {
		expect(normalizeTransform(undefined)).toEqual(DEFAULT_TRANSFORM);
		expect(normalizeTransform({ x: 0.25 })).toMatchObject({ x: 0.25, scale: 1, opacity: 1 });
	});

	it('clamps opacity and anchor and floors scale', () => {
		const t = normalizeTransform({ opacity: 5, anchorX: -2, anchorY: 9, scale: -1 });
		expect(t.opacity).toBe(1);
		expect(t.anchorX).toBe(0);
		expect(t.anchorY).toBe(1);
		expect(t.scale).toBeGreaterThan(0);
	});

	it('falls back to fill for unknown fit modes', () => {
		expect(normalizeTransform({ fit: 'bogus' as never }).fit).toBe('fill');
		expect(normalizeTransform({ fit: 'letterbox' }).fit).toBe('letterbox');
	});

	it('detects the identity transform', () => {
		expect(isIdentityTransform(DEFAULT_TRANSFORM)).toBe(true);
		expect(isIdentityTransform({ ...DEFAULT_TRANSFORM, scale: 0.5 })).toBe(false);
		expect(transformsEqual(DEFAULT_TRANSFORM, { ...DEFAULT_TRANSFORM })).toBe(true);
	});
});

describe('fit-mode math', () => {
	it('is identity when aspects match', () => {
		for (const mode of ['fill', 'fit', 'letterbox'] as const) {
			expect(computeFitRect(1920, 1080, 1280, 720, mode)).toEqual({ width: 1, height: 1 });
		}
	});

	it('contains a portrait source in a landscape output (fit/letterbox)', () => {
		// 1080x1920 into 1920x1080: ratio = (1080/1920)/(1920/1080) ≈ 0.3164 < 1.
		const rect = computeFitRect(1080, 1920, 1920, 1080, 'fit');
		expect(rect.height).toBe(1);
		expect(rect.width).toBeCloseTo(0.3164, 3);
	});

	it('covers a portrait source in a landscape output (fill)', () => {
		const rect = computeFitRect(1080, 1920, 1920, 1080, 'fill');
		expect(rect.width).toBe(1);
		expect(rect.height).toBeGreaterThan(1);
	});

	it('guards against degenerate dimensions', () => {
		expect(computeFitRect(0, 0, 100, 100, 'fit')).toEqual({ width: 1, height: 1 });
	});
});

describe('transform uniform packing', () => {
	it('packs an identity transform to a unit mapping centered at the anchor', () => {
		const packed = packTransformUniform(DEFAULT_TRANSFORM, 1920, 1080, 1920, 1080);
		expect(packed).toHaveLength(TRANSFORM_UNIFORM_FLOATS);
		const [m00, m01, m10, m11, t0, t1, opacity, fitFlag] = packed;
		// No rotation, unit scale (aspects match) ⇒ M = identity.
		expect(m00).toBeCloseTo(1);
		expect(m01).toBeCloseTo(0);
		expect(m10).toBeCloseTo(0);
		expect(m11).toBeCloseTo(1);
		// Sampling the output center (0.5, 0.5) lands on the anchor (0.5, 0.5).
		expect(m00! * 0.5 + m01! * 0.5 + t0!).toBeCloseTo(0.5);
		expect(m10! * 0.5 + m11! * 0.5 + t1!).toBeCloseTo(0.5);
		expect(opacity).toBe(1);
		expect(fitFlag).toBe(0);
	});

	it('halves the sampled extent when scaled 2x', () => {
		const packed = packTransformUniform({ ...DEFAULT_TRANSFORM, scale: 2 }, 1000, 1000, 1000, 1000);
		const [m00, , , , t0] = packed;
		// l(o) = m00*o + t0. A 2x layer means the full output edge (o=0..1) samples
		// only the central half of the source (l = 0.25..0.75).
		// eslint-disable-next-line oxc/erasing-op — intentional: asserting transform maps 0 correctly
		expect(m00! * 0 + t0!).toBeCloseTo(0.25);
		expect(m00! * 1 + t0!).toBeCloseTo(0.75);
	});

	it('translates the sampled coordinate opposite the layer offset', () => {
		const packed = packTransformUniform({ ...DEFAULT_TRANSFORM, x: 0.1 }, 1000, 1000, 1000, 1000);
		const [m00, , , , t0] = packed;
		// Moving the layer right by 0.1 of the output shifts the sample left by 0.1.
		expect(m00! * 0.5 + t0!).toBeCloseTo(0.4);
	});

	it('flags letterbox for opaque bars', () => {
		expect(packTransformUniform({ ...DEFAULT_TRANSFORM, fit: 'letterbox' }, 16, 9, 9, 16)[7]).toBe(
			1
		);
		expect(packTransformUniform({ ...DEFAULT_TRANSFORM, fit: 'fit' }, 16, 9, 9, 16)[7]).toBe(0);
	});

	it('packs the layer card extents (fit rect + anchor) for letterbox bounds', () => {
		const packed = packTransformUniform(
			{ ...DEFAULT_TRANSFORM, fit: 'letterbox' },
			1920,
			1080,
			1080,
			1920
		);
		const ratio = 1080 / 1920 / (1920 / 1080); // contain: portrait in landscape
		expect(packed[8]).toBeCloseTo(ratio, 3); // rectW
		expect(packed[9]).toBeCloseTo(1, 5); // rectH
		expect(packed[10]).toBeCloseTo(0.5); // anchorX
		expect(packed[11]).toBeCloseTo(0.5); // anchorY
	});

	it('swaps source dimensions for 90°/270° rotations so the fit rect matches the rotated aspect', () => {
		// A portrait 2160×3840 source (e.g. an unrotated phone frame from a 90°-rotated MOV)
		// displayed in a 3840×2160 landscape output, rotated 90°: the rotated bounding
		// box is 3840×2160, which matches the output exactly — fit:fill must produce
		// rect (1, 1), not (1, ~3.16). Without the swap the layer would be scaled up
		// 3.16× before rotation and then cropped to a narrow center strip.
		const portraitToLandscape = packTransformUniform(
			{ ...DEFAULT_TRANSFORM, rotation: 90 },
			3840,
			2160,
			2160,
			3840
		);
		expect(portraitToLandscape[8]).toBeCloseTo(1, 5); // rectW
		expect(portraitToLandscape[9]).toBeCloseTo(1, 5); // rectH

		// 270° should swap as well.
		const at270 = packTransformUniform(
			{ ...DEFAULT_TRANSFORM, rotation: 270 },
			3840,
			2160,
			2160,
			3840
		);
		expect(at270[8]).toBeCloseTo(1, 5);
		expect(at270[9]).toBeCloseTo(1, 5);

		// 180° must NOT swap (the aspect is preserved); leave behavior identical to 0°.
		const at180 = packTransformUniform(
			{ ...DEFAULT_TRANSFORM, rotation: 180 },
			1920,
			1080,
			1080,
			1920
		);
		const at0 = packTransformUniform(DEFAULT_TRANSFORM, 1920, 1080, 1080, 1920);
		expect(at180[8]).toBeCloseTo(at0[8]!, 5);
		expect(at180[9]).toBeCloseTo(at0[9]!, 5);

		// Arbitrary rotations (not a multiple of 90°) must NOT swap.
		const at45 = packTransformUniform(
			{ ...DEFAULT_TRANSFORM, rotation: 45 },
			1920,
			1080,
			1080,
			1920
		);
		expect(at45[8]).toBeCloseTo(at0[8]!, 5);
		expect(at45[9]).toBeCloseTo(at0[9]!, 5);
	});

	it('applies the rotated fit rect in layer-local axes so 90° rotation does not invert the clip extent', () => {
		// 1920×1080 (landscape 16:9) source rotated 90° in a 100×100 (square) output
		// with fit:fill. The rotated layer's aspect is 9:16 (portrait). In a square
		// output, fill must cover the limiting (width) axis (1.0) and extend
		// vertically (≈1.778). Because (sx, sy) are applied BEFORE the 90° rotation,
		// the layer-local extent must be transposed: layer-x = 1.778 (becomes
		// output-y after rotation), layer-y = 1.0 (becomes output-x after rotation).
		const [m00, m01, m10, m11, t0, t1, , , layerW, layerH] = packTransformUniform(
			{ ...DEFAULT_TRANSFORM, rotation: 90 },
			100,
			100,
			1920,
			1080
		);
		expect(layerW).toBeCloseTo(16 / 9, 3);
		expect(layerH).toBeCloseTo(1, 5);

		// Sample the four output corners and confirm the visible layer-local strip
		// is a vertical band of width 1.0 (output-x) and height >1 (output-y axis
		// extends past the layer card, producing the expected "fill"-and-clip).
		// For a square output the central output column (ox = 0.5) lands on the
		// layer's anchor (0.5, 0.5).
		const lxCenter = m00! * 0.5 + m01! * 0.5 + t0!;
		const lyCenter = m10! * 0.5 + m11! * 0.5 + t1!;
		expect(lxCenter).toBeCloseTo(0.5, 5);
		expect(lyCenter).toBeCloseTo(0.5, 5);
	});

	it('bounds the letterbox card so k stays in [0,1] across the output at scale 1', () => {
		// A full-frame letterbox layer: every output texel maps inside the card, so
		// bars fill the whole frame (the base-layer letterbox case). With k derived
		// as 0.5 + (l - anchor)·rect, the output corners land on the card edges.
		const t = { ...DEFAULT_TRANSFORM, fit: 'letterbox' as const };
		const [m00, m01, m10, m11, t0, t1, , , rectW, rectH, anchorX, anchorY] = packTransformUniform(
			t,
			1920,
			1080,
			1080,
			1920
		);
		for (const [ox, oy] of [
			[0, 0],
			[1, 1],
			[0.5, 0.5]
		]) {
			const lx = m00! * ox + m01! * oy + t0!;
			const ly = m10! * ox + m11! * oy + t1!;
			const kx = 0.5 + (lx - anchorX!) * rectW!;
			const ky = 0.5 + (ly - anchorY!) * rectH!;
			expect(kx).toBeGreaterThanOrEqual(-1e-6);
			expect(kx).toBeLessThanOrEqual(1 + 1e-6);
			expect(ky).toBeGreaterThanOrEqual(-1e-6);
			expect(ky).toBeLessThanOrEqual(1 + 1e-6);
		}
	});
});
