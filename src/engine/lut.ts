import type { ClipLutSnapshot } from '../protocol';

export interface CubeLut {
  title?: string;
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  values: Float32Array;
}

export interface ClipLut extends CubeLut {
  key: string;
  fileName: string;
}

export interface LutTextureHandle {
  key: string;
  size: number;
  texture: GPUTexture;
  view: GPUTextureView;
  sampler: GPUSampler;
}

function parseTriple(parts: readonly string[], directive: string): [number, number, number] {
  if (parts.length !== 4) throw new Error(`${directive} requires three numeric values.`);
  const values = parts.slice(1).map((part) => Number(part));
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(`${directive} contains a non-numeric value.`);
  }
  return [values[0]!, values[1]!, values[2]!];
}

function parseTitle(line: string): string | undefined {
  const raw = line.slice('TITLE'.length).trim();
  if (!raw) return undefined;
  const quoted = /^"(.+)"$/.exec(raw);
  return quoted ? quoted[1] : raw;
}

export function parseCubeLut(text: string): CubeLut {
  let size: number | null = null;
  let title: string | undefined;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const values: number[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const directive = parts[0]!;

    if (directive === 'TITLE') {
      title = parseTitle(line);
      continue;
    }
    if (directive === 'LUT_1D_SIZE') {
      throw new Error('Only 3D .cube LUTs are supported.');
    }
    if (directive === 'LUT_3D_SIZE') {
      if (parts.length !== 2) throw new Error('LUT_3D_SIZE requires one numeric value.');
      const parsed = Number(parts[1]);
      if (!Number.isInteger(parsed) || parsed < 2 || parsed > 128) {
        throw new Error('LUT_3D_SIZE must be an integer from 2 to 128.');
      }
      size = parsed;
      continue;
    }
    if (directive === 'DOMAIN_MIN') {
      domainMin = parseTriple(parts, directive);
      continue;
    }
    if (directive === 'DOMAIN_MAX') {
      domainMax = parseTriple(parts, directive);
      continue;
    }

    if (parts.length !== 3) {
      throw new Error(`Unexpected .cube directive: ${directive}`);
    }
    const sample = parts.map((part) => Number(part));
    if (sample.some((value) => !Number.isFinite(value))) {
      throw new Error('.cube sample rows must contain numeric RGB triplets.');
    }
    values.push(sample[0]!, sample[1]!, sample[2]!);
  }

  if (size === null) {
    throw new Error('.cube file is missing LUT_3D_SIZE.');
  }
  const expectedValues = size * size * size * 3;
  if (values.length !== expectedValues) {
    throw new Error(`.cube file has ${values.length / 3} samples, expected ${expectedValues / 3}.`);
  }

  return {
    title,
    size,
    domainMin,
    domainMax,
    values: Float32Array.from(values),
  };
}

/** Serialize a parsed LUT back to `.cube` text for portable bundle export. */
export function serializeCubeLut(lut: CubeLut): string {
  const lines: string[] = [];
  if (lut.title) lines.push(`TITLE "${lut.title}"`);
  lines.push(`LUT_3D_SIZE ${lut.size}`);
  lines.push(
    `DOMAIN_MIN ${lut.domainMin[0]} ${lut.domainMin[1]} ${lut.domainMin[2]}`,
    `DOMAIN_MAX ${lut.domainMax[0]} ${lut.domainMax[1]} ${lut.domainMax[2]}`,
  );
  for (let i = 0; i < lut.values.length; i += 3) {
    lines.push(`${lut.values[i]} ${lut.values[i + 1]} ${lut.values[i + 2]}`);
  }
  return `${lines.join('\n')}\n`;
}

export function lutFileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function clipLutFromFile(file: File, cube: CubeLut): ClipLut {
  return {
    ...cloneCubeLut(cube),
    key: lutFileKey(file),
    fileName: file.name,
  };
}

export async function clipLutFromCubeFile(file: File): Promise<ClipLut> {
  const text = await file.text();
  return clipLutFromFile(file, parseCubeLut(text));
}

export function cloneCubeLut(lut: CubeLut): CubeLut {
  return {
    title: lut.title,
    size: lut.size,
    domainMin: [...lut.domainMin],
    domainMax: [...lut.domainMax],
    // LUT sample tables are immutable after import/parse. Share the large table
    // across clip/history clones and copy only the small mutable metadata arrays.
    values: lut.values,
  };
}

export function cloneClipLut(lut: ClipLut | undefined): ClipLut | undefined {
  if (!lut) return undefined;
  return {
    ...cloneCubeLut(lut),
    key: lut.key,
    fileName: lut.fileName,
  };
}

export function lutSnapshot(lut: ClipLut | undefined): ClipLutSnapshot | undefined {
  if (!lut) return undefined;
  return {
    key: lut.key,
    fileName: lut.fileName,
    title: lut.title,
    size: lut.size,
  };
}

export function parsePersistedClipLut(value: unknown): ClipLut | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const key = typeof record.key === 'string' && record.key.length > 0 ? record.key : null;
  const fileName = typeof record.fileName === 'string' && record.fileName.length > 0 ? record.fileName : null;
  const size = typeof record.size === 'number' && Number.isInteger(record.size) ? record.size : null;
  const title = record.title === undefined || typeof record.title === 'string' ? record.title : null;
  const domainMin = Array.isArray(record.domainMin) ? record.domainMin : null;
  const domainMax = Array.isArray(record.domainMax) ? record.domainMax : null;
  const values =
    record.values instanceof Float32Array
      ? record.values
      : Array.isArray(record.values)
        ? Float32Array.from(record.values)
        : null;
  if (!key || !fileName || !size || title === null || !domainMin || !domainMax || !values) return null;
  if (size < 2 || size > 128 || values.length !== size * size * size * 3) return null;
  if (domainMin.length !== 3 || domainMax.length !== 3) return null;
  const min = domainMin.map(Number);
  const max = domainMax.map(Number);
  if (min.some((n) => !Number.isFinite(n)) || max.some((n) => !Number.isFinite(n))) return null;
  if (values.some((n) => !Number.isFinite(n))) return null;
  return {
    key,
    fileName,
    title,
    size,
    domainMin: [min[0]!, min[1]!, min[2]!],
    domainMax: [max[0]!, max[1]!, max[2]!],
    values: new Float32Array(values),
  };
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value * 255)));
}

function align(value: number, multiple: number): number {
  return Math.ceil(value / multiple) * multiple;
}

function packLutRgba8(lut: CubeLut): { data: Uint8Array; bytesPerRow: number; rowsPerImage: number } {
  const rowBytes = lut.size * 4;
  const bytesPerRow = align(rowBytes, 256);
  const rowsPerImage = lut.size;
  const data = new Uint8Array(bytesPerRow * rowsPerImage * lut.size);
  for (let z = 0; z < lut.size; z += 1) {
    for (let y = 0; y < lut.size; y += 1) {
      for (let x = 0; x < lut.size; x += 1) {
        const sampleIndex = ((z * lut.size * lut.size) + (y * lut.size) + x) * 3;
        const rowOffset = (z * rowsPerImage + y) * bytesPerRow + x * 4;
        data[rowOffset] = clampByte(lut.values[sampleIndex] ?? 0);
        data[rowOffset + 1] = clampByte(lut.values[sampleIndex + 1] ?? 0);
        data[rowOffset + 2] = clampByte(lut.values[sampleIndex + 2] ?? 0);
        data[rowOffset + 3] = 255;
      }
    }
  }
  return { data, bytesPerRow, rowsPerImage };
}

export class LutTextureCache {
  private readonly device: GPUDevice;
  private readonly handles = new Map<string, LutTextureHandle>();

  constructor(device: GPUDevice) {
    this.device = device;
  }

  upsert(lut: ClipLut): LutTextureHandle {
    const existing = this.handles.get(lut.key);
    if (existing) return existing;
    const texture = this.device.createTexture({
      size: { width: lut.size, height: lut.size, depthOrArrayLayers: lut.size },
      dimension: '3d',
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const packed = packLutRgba8(lut);
    this.device.queue.writeTexture(
      { texture },
      packed.data,
      { bytesPerRow: packed.bytesPerRow, rowsPerImage: packed.rowsPerImage },
      { width: lut.size, height: lut.size, depthOrArrayLayers: lut.size },
    );
    const handle: LutTextureHandle = {
      key: lut.key,
      size: lut.size,
      texture,
      view: texture.createView({ dimension: '3d' }),
      sampler: this.device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        addressModeW: 'clamp-to-edge',
      }),
    };
    this.handles.set(lut.key, handle);
    return handle;
  }

  get(key: string): LutTextureHandle | null {
    return this.handles.get(key) ?? null;
  }

  prune(activeKeys: ReadonlySet<string>): void {
    for (const [key, handle] of this.handles) {
      if (activeKeys.has(key)) continue;
      handle.texture.destroy();
      this.handles.delete(key);
    }
  }

  destroy(): void {
    for (const handle of this.handles.values()) {
      handle.texture.destroy();
    }
    this.handles.clear();
  }
}
