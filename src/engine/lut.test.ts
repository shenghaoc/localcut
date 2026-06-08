import { afterEach, describe, expect, it, vi } from 'vitest';
import { LutTextureCache, parseCubeLut, type ClipLut } from './lut';

function identityCube(size: number): string {
	const rows: string[] = [`TITLE "Identity ${size}"`, `LUT_3D_SIZE ${size}`];
	for (let b = 0; b < size; b += 1) {
		for (let g = 0; g < size; g += 1) {
			for (let r = 0; r < size; r += 1) {
				rows.push(`${r / (size - 1)} ${g / (size - 1)} ${b / (size - 1)}`);
			}
		}
	}
	return rows.join('\n');
}

describe('.cube LUT parser', () => {
	const runtime = globalThis as unknown as { GPUTextureUsage?: Record<string, number> };
	const previousUsage = runtime.GPUTextureUsage;

	afterEach(() => {
		if (previousUsage) {
			runtime.GPUTextureUsage = previousUsage;
		} else {
			delete runtime.GPUTextureUsage;
		}
	});

	it('parses a valid 2x2x2 cube with title and domains', () => {
		const lut = parseCubeLut(`
      # comment
      TITLE "Warm"
      DOMAIN_MIN 0 0 0
      DOMAIN_MAX 1 1 1
      LUT_3D_SIZE 2
      0 0 0
      1 0 0
      0 1 0
      1 1 0
      0 0 1
      1 0 1
      0 1 1
      1 1 1
    `);
		expect(lut.title).toBe('Warm');
		expect(lut.size).toBe(2);
		expect(lut.domainMin).toEqual([0, 0, 0]);
		expect(lut.values).toHaveLength(24);
		expect(lut.values[23]).toBe(1);
	});

	it('parses differently sized 3D LUTs', () => {
		const lut = parseCubeLut(identityCube(3));
		expect(lut.size).toBe(3);
		expect(lut.values).toHaveLength(81);
	});

	it('rejects malformed cube files gracefully', () => {
		expect(() => parseCubeLut('0 0 0')).toThrow(/LUT_3D_SIZE/);
		expect(() => parseCubeLut('LUT_1D_SIZE 16')).toThrow(/3D/);
		expect(() => parseCubeLut('LUT_3D_SIZE 1\n0 0 0')).toThrow(/integer/);
		expect(() => parseCubeLut('LUT_3D_SIZE 2\n0 0 0')).toThrow(/samples/);
		expect(() => parseCubeLut('LUT_3D_SIZE 2\nDOMAIN_MIN 0 nope 0')).toThrow(/non-numeric/);
	});

	it('destroys and evicts inactive cached LUT textures', () => {
		runtime.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2 };
		const destroyed: string[] = [];
		const textures = new Map<
			string,
			{ destroy: ReturnType<typeof vi.fn>; createView: ReturnType<typeof vi.fn> }
		>();
		let nextTextureKey = 'lut-a';
		const device = {
			createTexture: vi.fn(() => {
				const key = nextTextureKey;
				const texture = {
					destroy: vi.fn(() => destroyed.push(key)),
					createView: vi.fn(() => ({ key: `${key}-view` }))
				};
				textures.set(key, texture);
				return texture;
			}),
			createSampler: vi.fn(() => ({})),
			queue: {
				writeTexture: vi.fn()
			}
		} as unknown as GPUDevice;
		const lut = (key: string): ClipLut => ({
			key,
			fileName: `${key}.cube`,
			title: key,
			size: 2,
			domainMin: [0, 0, 0],
			domainMax: [1, 1, 1],
			values: new Float32Array(24)
		});
		const cache = new LutTextureCache(device);

		nextTextureKey = 'lut-a';
		cache.upsert(lut('lut-a'));
		nextTextureKey = 'lut-b';
		cache.upsert(lut('lut-b'));
		cache.prune(new Set(['lut-a']));

		expect(cache.get('lut-a')).not.toBeNull();
		expect(cache.get('lut-b')).toBeNull();
		expect(textures.get('lut-b')?.destroy).toHaveBeenCalledTimes(1);
		expect(destroyed).toEqual(['lut-b']);
	});
});
