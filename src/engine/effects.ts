/** WebGPU compute effect chain — Phase 4. */

import brightnessContrastF32 from './shaders/brightness-contrast.wgsl?raw';
import brightnessContrastF16 from './shaders/brightness-contrast.f16.wgsl?raw';
import saturationF32 from './shaders/saturation.wgsl?raw';
import saturationF16 from './shaders/saturation.f16.wgsl?raw';
import colourTemperatureF32 from './shaders/colour-temperature.wgsl?raw';
import colourTemperatureF16 from './shaders/colour-temperature.f16.wgsl?raw';
import passthroughSource from './shaders/passthrough.wgsl?raw';

export type EffectId = 'brightness-contrast' | 'saturation' | 'colour-temperature';

/** Per-clip colour-grade parameters mirrored in the timeline model. */
export interface ClipEffectParams {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  temperatureStrength: number;
}

export const DEFAULT_CLIP_EFFECTS: ClipEffectParams = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  temperature: 6500,
  temperatureStrength: 1,
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
  };
}

interface UniformField {
  key: keyof ClipEffectParams;
  offset: number;
}

interface EffectRegistryEntry {
  id: EffectId;
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

export const EFFECT_IDS: EffectId[] = EFFECT_REGISTRY.map((entry) => entry.id);

export function getEffectLabel(id: EffectId): string {
  return EFFECT_REGISTRY.find((entry) => entry.id === id)?.label ?? id;
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

export function clipEffectsEqual(a: ClipEffectParams, b: ClipEffectParams): boolean {
  return (
    a.brightness === b.brightness &&
    a.contrast === b.contrast &&
    a.saturation === b.saturation &&
    a.temperature === b.temperature &&
    a.temperatureStrength === b.temperatureStrength
  );
}

export function packEffectUniform(
  effectId: EffectId,
  params: ClipEffectParams,
): Float32Array {
  const entry = EFFECT_REGISTRY.find((e) => e.id === effectId);
  if (!entry) throw new Error(`Unknown effect: ${effectId}`);
  const view = new Float32Array(entry.uniformByteLength / 4);
  for (const field of entry.fields) {
    view[field.offset / 4] = params[field.key];
  }
  return view;
}

export interface StoragePingPong {
  a: GPUTextureView;
  b: GPUTextureView;
  c: GPUTextureView;
}

interface CompiledEffect {
  id: EffectId;
  byteLength: number;
  pipeline: GPUComputePipeline;
  /** One uniform buffer per concurrent layer slot (grown on demand). A single
   *  frame composites many layers in one submission, so each layer needs its
   *  own buffer — sharing one would let the last write clobber every pass. */
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
  }

  private uniformBufferFor(effect: CompiledEffect, slot: number): GPUBuffer {
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

  /**
   * Encodes import → brightness → saturation → colour-temperature for one layer
   * into `encoder`. `params` are the layer's clip effects; `layerSlot` selects
   * the per-layer uniform-buffer set. Returns the texture view holding the final
   * graded frame (preview present and export encode share this).
   */
  encodeColourChain(
    encoder: GPUCommandEncoder,
    external: GPUExternalTexture,
    storage: StoragePingPong,
    width: number,
    height: number,
    params: ClipEffectParams,
    layerSlot = 0,
  ): GPUTextureView {
    const normalized = normalizeClipEffects(params);
    const wgX = Math.ceil(width / 8);
    const wgY = Math.ceil(height / 8);

    // External → A
    {
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
    }

    const activeEffects: CompiledEffect[] = [];
    if (isBrightnessContrastActive(normalized)) activeEffects.push(this.effects[0]!);
    if (isSaturationActive(normalized)) activeEffects.push(this.effects[1]!);
    if (isColourTemperatureActive(normalized)) activeEffects.push(this.effects[2]!);

    let currentSrc = storage.a;
    const pingPong = [storage.b, storage.c, storage.a];
    let bufIdx = 0;

    for (const effect of activeEffects) {
      const currentDst = pingPong[bufIdx]!;
      bufIdx = (bufIdx + 1) % 3;

      const uniformBuffer = this.uniformBufferFor(effect, layerSlot);
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

  destroy(): void {
    for (const effect of this.effects) {
      for (const buffer of effect.uniformBuffers) buffer.destroy();
      effect.uniformBuffers.length = 0;
    }
  }
}
