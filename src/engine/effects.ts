/** WebGPU compute effect chain — Phase 4, extended in Phase 21.
 *
 *  Phase 21 splits the old `encodeColourChain` into `encodeColourImport` +
 *  `encodeBaseCorrection` + `encodeLutApply`, so the pipeline orchestrator in
 *  gpu.ts can interleave normalization, opacity, and output-conversion stages.
 */

import brightnessContrastF32 from './shaders/brightness-contrast.wgsl?raw';
import brightnessContrastF16 from './shaders/brightness-contrast.f16.wgsl?raw';
import saturationF32 from './shaders/saturation.wgsl?raw';
import saturationF16 from './shaders/saturation.f16.wgsl?raw';
import colourTemperatureF32 from './shaders/colour-temperature.wgsl?raw';
import colourTemperatureF16 from './shaders/colour-temperature.f16.wgsl?raw';
import lutApplyF32 from './shaders/lut-apply.wgsl?raw';
import lutApplyF16 from './shaders/lut-apply.f16.wgsl?raw';
import passthroughSource from './shaders/passthrough.wgsl?raw';
import { LutTextureCache, type ClipLut } from './lut';

export type EffectId = 'brightness-contrast' | 'saturation' | 'colour-temperature' | 'lut-apply';
type ScalarEffectId = Exclude<EffectId, 'lut-apply'>;

/** Per-clip colour-grade parameters mirrored in the timeline model. */
export interface ClipEffectParams {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  temperatureStrength: number;
  lutStrength: number;
}

export const DEFAULT_CLIP_EFFECTS: ClipEffectParams = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  temperature: 6500,
  temperatureStrength: 1,
  lutStrength: 0,
};

export function normalizeClipEffects(
  partial: Partial<ClipEffectParams> | undefined,
): ClipEffectParams {
  return {
    brightness: partial?.brightness ?? DEFAULT_CLIP_EFFECTS.brightness,
    contrast: partial?.contrast ?? DEFAULT_CLIP_EFFECTS.contrast,
    saturation: partial?.saturation ?? DEFAULT_CLIP_EFFECTS.saturation,
    temperature: partial?.temperature ?? DEFAULT_CLIP_EFFECTS.temperature,
    temperatureStrength: partial?.temperatureStrength ?? DEFAULT_CLIP_EFFECTS.temperatureStrength,
    lutStrength: partial?.lutStrength ?? DEFAULT_CLIP_EFFECTS.lutStrength,
  };
}

interface UniformField {
  key: keyof ClipEffectParams;
  offset: number;
}

interface EffectRegistryEntry {
  id: ScalarEffectId;
  label: string;
  shaderF32: string;
  shaderF16: string;
  uniformByteLength: number;
  fields: UniformField[];
}

interface LutRegistryEntry {
  id: 'lut-apply';
  label: string;
  shaderF32: string;
  shaderF16: string;
  uniformByteLength: number;
  fields: UniformField[];
}

const EFFECT_REGISTRY: EffectRegistryEntry[] = [
  {
    id: 'brightness-contrast',
    label: 'Brightness / Contrast',
    shaderF32: brightnessContrastF32,
    shaderF16: brightnessContrastF16,
    uniformByteLength: 16,
    fields: [
      { key: 'brightness', offset: 0 },
      { key: 'contrast', offset: 4 },
    ],
  },
  {
    id: 'saturation',
    label: 'Saturation',
    shaderF32: saturationF32,
    shaderF16: saturationF16,
    uniformByteLength: 16,
    fields: [{ key: 'saturation', offset: 0 }],
  },
  {
    id: 'colour-temperature',
    label: 'Colour Temperature',
    shaderF32: colourTemperatureF32,
    shaderF16: colourTemperatureF16,
    uniformByteLength: 16,
    fields: [
      { key: 'temperature', offset: 0 },
      { key: 'temperatureStrength', offset: 4 },
    ],
  },
];

const LUT_REGISTRY_ENTRY: LutRegistryEntry = {
  id: 'lut-apply',
  label: 'LUT',
  shaderF32: lutApplyF32,
  shaderF16: lutApplyF16,
  uniformByteLength: 48,
  fields: [{ key: 'lutStrength', offset: 0 }],
};

export const EFFECT_IDS: EffectId[] = [...EFFECT_REGISTRY.map((entry) => entry.id), LUT_REGISTRY_ENTRY.id];

export function getEffectLabel(id: EffectId): string {
  return [...EFFECT_REGISTRY, LUT_REGISTRY_ENTRY].find((entry) => entry.id === id)?.label ?? id;
}

/** Packs one effect's uniform buffer from clip parameters (testable without GPU). */
export function isBrightnessContrastActive(params: ClipEffectParams): boolean {
  return params.brightness !== 0 || params.contrast !== 1;
}

export function isSaturationActive(params: ClipEffectParams): boolean {
  return params.saturation !== 1;
}

/** Strength 0 is an explicit bypass; other effects use their neutral scalar instead. */
export function isColourTemperatureActive(params: ClipEffectParams): boolean {
  return params.temperatureStrength !== 0 && params.temperature !== DEFAULT_CLIP_EFFECTS.temperature;
}

export function isLutActive(params: ClipEffectParams, lut: ClipLut | undefined): boolean {
  return Boolean(lut) && params.lutStrength > 0;
}

export function clipEffectsEqual(a: ClipEffectParams, b: ClipEffectParams): boolean {
  return (
    a.brightness === b.brightness &&
    a.contrast === b.contrast &&
    a.saturation === b.saturation &&
    a.temperature === b.temperature &&
    a.temperatureStrength === b.temperatureStrength &&
    a.lutStrength === b.lutStrength
  );
}

export function packEffectUniform(
  effectId: EffectId,
  params: ClipEffectParams,
): Float32Array {
  const entry = [...EFFECT_REGISTRY, LUT_REGISTRY_ENTRY].find((e) => e.id === effectId);
  if (!entry) throw new Error(`Unknown effect: ${effectId}`);
  const view = new Float32Array(entry.uniformByteLength / 4);
  for (const field of entry.fields) {
    view[field.offset / 4] = params[field.key];
  }
  if (effectId === 'lut-apply') {
    view[8] = 1;
    view[9] = 1;
    view[10] = 1;
  }
  return view;
}

export function packLutUniform(params: ClipEffectParams, lut: ClipLut): Float32Array {
  const view = packEffectUniform('lut-apply', params);
  view.set(lut.domainMin, 4);
  view.set(lut.domainMax, 8);
  return view;
}

export interface StoragePingPong {
  a: GPUTextureView;
  b: GPUTextureView;
  c: GPUTextureView;
}

interface CompiledEffect {
  id: ScalarEffectId;
  byteLength: number;
  pipeline: GPUComputePipeline;
  /** One uniform buffer per concurrent layer slot (grown on demand). A single
   *  frame composites many layers in one submission, so each layer needs its
   *  own buffer — sharing one would let the last write clobber every pass. */
  uniformBuffers: GPUBuffer[];
  bindGroupLayout: GPUBindGroupLayout;
}

interface CompiledLutEffect {
  id: 'lut-apply';
  byteLength: number;
  pipeline: GPUComputePipeline;
  uniformBuffers: GPUBuffer[];
  bindGroupLayout: GPUBindGroupLayout;
}

/**
 * Compiles colour-grade pipelines once and encodes the import → grade chain for
 * one layer into a caller-owned command encoder. Params are supplied per call
 * (layers in a single frame differ), and each layer slot owns its own uniform
 * buffers so the multi-layer single submission stays correct.
 */
export class EffectChain {
  private readonly device: GPUDevice;
  private readonly effects: CompiledEffect[];
  private readonly lutEffect: CompiledLutEffect;
  private readonly luts: LutTextureCache;
  private readonly passthroughPipeline: GPUComputePipeline;
  private readonly passthroughLayout: GPUBindGroupLayout;

  constructor(device: GPUDevice, useF16: boolean) {
    this.device = device;

    const passthroughModule = device.createShaderModule({ code: passthroughSource });
    this.passthroughPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: passthroughModule, entryPoint: 'main' },
    });
    this.passthroughLayout = this.passthroughPipeline.getBindGroupLayout(0);

    this.effects = EFFECT_REGISTRY.map((entry) => {
      const code = useF16 ? entry.shaderF16 : entry.shaderF32;
      const module = device.createShaderModule({ code });
      const pipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
      });
      return {
        id: entry.id,
        byteLength: entry.uniformByteLength,
        pipeline,
        uniformBuffers: [],
        bindGroupLayout: pipeline.getBindGroupLayout(0),
      };
    });

    const lutModule = device.createShaderModule({ code: useF16 ? LUT_REGISTRY_ENTRY.shaderF16 : LUT_REGISTRY_ENTRY.shaderF32 });
    const lutPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: lutModule, entryPoint: 'main' },
    });
    this.lutEffect = {
      id: LUT_REGISTRY_ENTRY.id,
      byteLength: LUT_REGISTRY_ENTRY.uniformByteLength,
      pipeline: lutPipeline,
      uniformBuffers: [],
      bindGroupLayout: lutPipeline.getBindGroupLayout(0),
    };
    this.luts = new LutTextureCache(device);
  }

  private uniformBufferFor(effect: Pick<CompiledEffect, 'byteLength' | 'uniformBuffers'>, slot: number): GPUBuffer {
    let buffer = effect.uniformBuffers[slot];
    if (!buffer) {
      buffer = this.device.createBuffer({
        size: effect.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      effect.uniformBuffers[slot] = buffer;
    }
    return buffer;
  }

  importLut(lut: ClipLut): void {
    this.luts.upsert(lut);
  }

  pruneLuts(activeKeys: ReadonlySet<string>): void {
    this.luts.prune(activeKeys);
  }

  private encodeLut(
    encoder: GPUCommandEncoder,
    currentSrc: GPUTextureView,
    currentDst: GPUTextureView,
    lut: ClipLut,
    params: ClipEffectParams,
    layerSlot: number,
    wgX: number,
    wgY: number,
  ): GPUTextureView {
    const lutTexture = this.luts.get(lut.key) ?? this.luts.upsert(lut);
    const uniformBuffer = this.uniformBufferFor(this.lutEffect, layerSlot);
    this.device.queue.writeBuffer(uniformBuffer, 0, packLutUniform(params, lut));
    const bindGroup = this.device.createBindGroup({
      layout: this.lutEffect.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: currentSrc },
        { binding: 2, resource: currentDst },
        { binding: 3, resource: lutTexture.view },
        { binding: 4, resource: lutTexture.sampler },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.lutEffect.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
    return currentDst;
  }

  /**
   * Stage 0: imports a VideoFrame external texture into storage.a via a passthrough
   * compute pass. Returns the storage.a view (ready for downstream stages).
   */
  encodeColourImport(
    encoder: GPUCommandEncoder,
    external: GPUExternalTexture,
    storage: StoragePingPong,
    width: number,
    height: number,
  ): GPUTextureView {
    const wgX = Math.ceil(width / 8);
    const wgY = Math.ceil(height / 8);

    const bindGroup = this.device.createBindGroup({
      layout: this.passthroughLayout,
      entries: [
        { binding: 0, resource: external },
        { binding: 1, resource: storage.a },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.passthroughPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();

    return storage.a;
  }

  /**
   * Stage 2 (base-correction): encodes brightness → saturation → colour-temperature
   * for one layer, reading from `srcView` and returning the last written storage view.
   * `slot` selects the per-layer uniform-buffer set for multi-layer frames.
   */
  encodeBaseCorrection(
    encoder: GPUCommandEncoder,
    srcView: GPUTextureView,
    storage: StoragePingPong,
    width: number,
    height: number,
    params: ClipEffectParams,
    slot = 0,
  ): GPUTextureView {
    const normalized = normalizeClipEffects(params);
    const wgX = Math.ceil(width / 8);
    const wgY = Math.ceil(height / 8);

    const activeEffects: CompiledEffect[] = [];
    if (isBrightnessContrastActive(normalized)) activeEffects.push(this.effects[0]!);
    if (isSaturationActive(normalized)) activeEffects.push(this.effects[1]!);
    if (isColourTemperatureActive(normalized)) activeEffects.push(this.effects[2]!);

    if (activeEffects.length === 0) return srcView;

    let currentSrc = srcView;
    const pingPong = [storage.b, storage.c, storage.a];
    let bufIdx = 0;

    for (const effect of activeEffects) {
      const currentDst = pingPong[bufIdx]!;
      bufIdx = (bufIdx + 1) % 3;

      const uniformBuffer = this.uniformBufferFor(effect, slot);
      this.device.queue.writeBuffer(uniformBuffer, 0, packEffectUniform(effect.id, normalized));

      const bindGroup = this.device.createBindGroup({
        layout: effect.bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: currentSrc },
          { binding: 2, resource: currentDst },
        ],
      });
      const pass = encoder.beginComputePass();
      pass.setPipeline(effect.pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(wgX, wgY);
      pass.end();

      currentSrc = currentDst;
    }

    return currentSrc;
  }

  /**
   * Retained for backward compatibility: full colour chain as a single call.
   * New callers should use the individual stage methods instead.
   */
  encodeColourChain(
    encoder: GPUCommandEncoder,
    external: GPUExternalTexture,
    storage: StoragePingPong,
    width: number,
    height: number,
    params: ClipEffectParams,
    layerSlot = 0,
    lut?: ClipLut,
  ): GPUTextureView {
    const normalized = normalizeClipEffects(params);
    const wgX = Math.ceil(width / 8);
    const wgY = Math.ceil(height / 8);

    let currentSrc = this.encodeColourImport(encoder, external, storage, width, height);
    currentSrc = this.encodeBaseCorrection(encoder, currentSrc, storage, width, height, params, layerSlot);

    if (isLutActive(normalized, lut)) {
      const activeBaseEffects =
        (isBrightnessContrastActive(normalized) ? 1 : 0) +
        (isSaturationActive(normalized) ? 1 : 0) +
        (isColourTemperatureActive(normalized) ? 1 : 0);
      const bufIdx = activeBaseEffects % 3;
      const pingPong = [storage.b, storage.c, storage.a];
      const currentDst = pingPong[bufIdx]!;
      currentSrc = this.encodeLut(encoder, currentSrc, currentDst, lut!, normalized, layerSlot, wgX, wgY);
    }

    return currentSrc;
  }

  destroy(): void {
    for (const effect of this.effects) {
      for (const buffer of effect.uniformBuffers) buffer.destroy();
      effect.uniformBuffers.length = 0;
    }
    for (const buffer of this.lutEffect.uniformBuffers) buffer.destroy();
    this.lutEffect.uniformBuffers.length = 0;
    this.luts.destroy();
  }
}
