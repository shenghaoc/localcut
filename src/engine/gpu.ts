/** WebGPU device, OffscreenCanvas, and the zero-copy layered compositor (Phase 2/4/12/21). */

import presentSource from './shaders/present.wgsl?raw';
import clearSource from './shaders/clear.wgsl?raw';
import transformF32 from './shaders/transform.wgsl?raw';
import transformF16 from './shaders/transform.f16.wgsl?raw';
import compositeOverF32 from './shaders/composite-over.wgsl?raw';
import compositeOverF16 from './shaders/composite-over.f16.wgsl?raw';
import sourceNormalizeF32 from './shaders/source-normalize.wgsl?raw';
import sourceNormalizeF16 from './shaders/source-normalize.f16.wgsl?raw';
import outputConvertF32 from './shaders/output-convert.wgsl?raw';
import outputConvertF16 from './shaders/output-convert.f16.wgsl?raw';
import opacityF32 from './shaders/opacity.wgsl?raw';
import opacityF16 from './shaders/opacity.f16.wgsl?raw';
import clippingOverlaySource from './shaders/clipping-overlay.wgsl?raw';
import { EffectChain, type ClipEffectParams } from './effects';
import type { ClipLut } from './lut';
import {
  DEFAULT_TRANSFORM,
  packTransformUniform,
  TRANSFORM_UNIFORM_BYTES,
  type TransformParams,
} from './transform';
import {
  OutputTransfer,
} from './colour';

export interface GpuInit {
  /** Ready renderer, or null when WebGPU is unavailable. */
  renderer: PreviewRenderer | null;
  features: string[];
  /** Specific, actionable reason WebGPU is unavailable, or null when ready. */
  unavailableReason: string | null;
}

/**
 * One composite layer.
 *  - `'frame'` — per-frame decoded video, re-imported every frame, colour-graded.
 *  - `'texture'` — a pre-rendered RGBA texture (Phase 14 title raster) uploaded
 *    once on edit and cached; it skips the colour chain and feeds the transform
 *    pass directly. Both kinds composite inside the one per-frame submission.
 */
export interface FrameCompositeLayer {
  kind: 'frame';
  /** Caller-owned; valid only for the submission issued by this call. */
  frame: VideoFrame;
  effects: ClipEffectParams;
  transform: TransformParams;
  lut?: ClipLut;
}

/**
 * A cached-texture layer. The view is owned by the caller's texture cache (Phase
 * 14 title raster) and must outlive the submission. Carries straight-alpha RGBA;
 * the transform pass premultiplies it like any graded frame.
 */
export interface TextureCompositeLayer {
  kind: 'texture';
  view: GPUTextureView;
  sourceWidth: number;
  sourceHeight: number;
  transform: TransformParams;
}

export type CompositeLayer = FrameCompositeLayer | TextureCompositeLayer;

function unavailable(reason: string): GpuInit {
  return { renderer: null, features: [], unavailableReason: reason };
}

/**
 * Owns the WebGPU device and the per-frame zero-copy layered compositor.
 *
 * Per frame, inside ONE `GPUCommandEncoder` and ONE `queue.submit`:
 *   clear accumulator (opaque black)
 *   for each layer (bottom → top):
 *     importExternalTexture(frame)            // re-imported every frame, never cached
 *     colour chain (A/B/C scratch, per-layer params)
 *     transform pass (position/scale/rotation/anchor/fit) → premultiplied T
 *     composite-over (premultiplied) → accumulator ping-pong
 *   present(final accumulator)
 *
 * Multiple `importExternalTexture` calls per frame are expected and allowed — the
 * architecture gate bans caching imports *across* frames, not several within one.
 * No CPU pixel readback ever happens.
 */
export class PreviewRenderer {
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly canvas: OffscreenCanvas;

  private readonly effectChain: EffectChain;
  private readonly presentPipeline: GPURenderPipeline;
  private readonly clearPipeline: GPUComputePipeline;
  private readonly transformPipeline: GPUComputePipeline;
  private readonly compositePipeline: GPUComputePipeline;
  // Phase 21: new pipeline stages
  private readonly sourceNormalizePipeline: GPUComputePipeline;
  private readonly outputConvertPipeline: GPUComputePipeline;
  private readonly opacityPipeline: GPUComputePipeline;
  private readonly clippingOverlayPipeline: GPUComputePipeline | null;
  private readonly sampler: GPUSampler;

  // Colour-grade scratch (shared sequentially across layers within a frame).
  private storageA: GPUTexture | null = null;
  private storageB: GPUTexture | null = null;
  private storageC: GPUTexture | null = null;
  private storageAView: GPUTextureView | null = null;
  private storageBView: GPUTextureView | null = null;
  private storageCView: GPUTextureView | null = null;
  // Per-layer transform output.
  private transformTex: GPUTexture | null = null;
  private transformView: GPUTextureView | null = null;
  // Accumulator ping-pong.
  private accTex: [GPUTexture, GPUTexture] | null = null;
  private accView: [GPUTextureView, GPUTextureView] | null = null;
  // Phase 21: output-conversion scratch (post-composite, before present).
  private outConvTex: GPUTexture | null = null;
  private outConvView: GPUTextureView | null = null;
  // Phase 21: opacity scratch (dedicated texture to avoid aliasing with storage.c).
  private opacityTex: GPUTexture | null = null;
  private opacityView: GPUTextureView | null = null;
  // Phase 21: zebra overlay texture (only allocated when toggled on).
  private zebraTex: GPUTexture | null = null;
  private zebraView: GPUTextureView | null = null;
  private _zebraUniform: GPUBuffer | null = null;
  private zebraEnabled = false;

  // Phase 21: per-layer normalization uniform buffers.
  private readonly normalizeBuffers: GPUBuffer[] = [];
  private readonly normalizeGroupLayout: GPUBindGroupLayout;
  // Per-layer opacity uniform buffers.
  private readonly opacityBuffers: GPUBuffer[] = [];
  private readonly opacityGroupLayout: GPUBindGroupLayout;
  // Output-conversion uniform buffer.
  private outConvUniform: GPUBuffer | null = null;
  private readonly outConvGroupLayout: GPUBindGroupLayout;

  // Phase 21: scopes SAB reference (set by worker for scope output).
  private scopeSab: Float32Array | null = null;
  private scopesEnabled = false;

  private presentBindGroup: GPUBindGroup | null = null;
  /** Accumulator view holding the most recent composited frame (preview + export). */
  private lastPresentView: GPUTextureView | null = null;
  /** Phase 21: pre-output-conversion accumulator for zebra overlay + scopes. */
  private _lastAccView: GPUTextureView | null = null;
  /** Per-layer transform uniform buffers (grown on demand; one submission, many layers). */
  private readonly transformBuffers: GPUBuffer[] = [];
  private width = 0;
  private height = 0;
  private submissionCount = 0;

  constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    canvas: OffscreenCanvas,
    useF16: boolean,
  ) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.canvas = canvas;

    this.effectChain = new EffectChain(device, useF16);

    const presentModule = device.createShaderModule({ code: presentSource });
    this.presentPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: presentModule, entryPoint: 'vs' },
      fragment: { module: presentModule, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.clearPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: clearSource }), entryPoint: 'main' },
    });
    this.transformPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: useF16 ? transformF16 : transformF32 }),
        entryPoint: 'main',
      },
    });
    this.compositePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: useF16 ? compositeOverF16 : compositeOverF32 }),
        entryPoint: 'main',
      },
    });

    // Phase 21: new stage pipelines
    this.sourceNormalizePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: useF16 ? sourceNormalizeF16 : sourceNormalizeF32 }),
        entryPoint: 'main',
      },
    });
    this.outputConvertPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: useF16 ? outputConvertF16 : outputConvertF32 }),
        entryPoint: 'main',
      },
    });
    this.opacityPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: useF16 ? opacityF16 : opacityF32 }),
        entryPoint: 'main',
      },
    });
    this.clippingOverlayPipeline = (() => {
      try {
        return device.createComputePipeline({
          layout: 'auto',
          compute: {
            module: device.createShaderModule({ code: clippingOverlaySource }),
            entryPoint: 'main',
          },
        });
      } catch {
        return null;
      }
    })();

    this.normalizeGroupLayout = this.sourceNormalizePipeline.getBindGroupLayout(0);
    this.outConvGroupLayout = this.outputConvertPipeline.getBindGroupLayout(0);
    this.opacityGroupLayout = this.opacityPipeline.getBindGroupLayout(0);

    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /** The compositor's device — title textures must be uploaded on it (Phase 14). */
  get gpuDevice(): GPUDevice {
    return this.device;
  }

  /** Submissions issued by the last `present()` call (always 1 when a frame rendered). */
  get lastFrameSubmissionCount(): number {
    return this.submissionCount;
  }

  /** Final composited view from the most recent frame (preview + export share this). */
  getProcessedTextureView(): GPUTextureView | null {
    return this.lastPresentView;
  }

  /** Phase 21: set the SAB used for scope output (written by worker, read by UI). */
  setScopeSab(sab: SharedArrayBuffer): void {
    this.scopeSab = new Float32Array(sab);
  }

  /** Phase 21: toggle the zebra clipping overlay on/off. */
  setZebraEnabled(enabled: boolean): void {
    this.zebraEnabled = enabled;
    if (enabled && !this.zebraTex && this.width > 0) {
      const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
      this.zebraTex = this.device.createTexture({
        size: { width: this.width, height: this.height },
        format: 'rgba8unorm',
        usage,
      });
      this.zebraView = this.zebraTex.createView();
    }
  }

  /** Phase 21: enable/disable scope computation during the preview loop. */
  setScopesEnabled(enabled: boolean): void {
    this.scopesEnabled = enabled;
  }

  importLut(lut: ClipLut): void {
    this.effectChain.importLut(lut);
  }

  pruneLuts(activeKeys: ReadonlySet<string>): void {
    this.effectChain.pruneLuts(activeKeys);
  }

  /**
   * (Re)allocates the compute textures and resizes the canvas backing store.
   * Cheap no-op when the size is unchanged.
   */
  setPreviewSize(width: number, height: number): void {
    const w = Math.max(2, width);
    const h = Math.max(2, height);
    if (w === this.width && h === this.height && this.storageA) return;

    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
    });

    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
    const size = { width: w, height: h };

    this.destroyTextures();

    this.storageA = this.device.createTexture({ size, format: 'rgba8unorm', usage });
    this.storageB = this.device.createTexture({ size, format: 'rgba8unorm', usage });
    this.storageC = this.device.createTexture({ size, format: 'rgba8unorm', usage });
    this.transformTex = this.device.createTexture({ size, format: 'rgba8unorm', usage });
    // Phase 21: output-conversion scratch
    this.outConvTex = this.device.createTexture({ size, format: 'rgba8unorm', usage });
    // Phase 21: opacity scratch (dedicated to avoid aliasing)
    this.opacityTex = this.device.createTexture({ size, format: 'rgba8unorm', usage });
    this.accTex = [
      this.device.createTexture({ size, format: 'rgba8unorm', usage }),
      this.device.createTexture({ size, format: 'rgba8unorm', usage }),
    ];
    this.storageAView = this.storageA.createView();
    this.storageBView = this.storageB.createView();
    this.storageCView = this.storageC.createView();
    this.transformView = this.transformTex.createView();
    this.outConvView = this.outConvTex!.createView();
    this.opacityView = this.opacityTex!.createView();
    this.accView = [this.accTex[0].createView(), this.accTex[1].createView()];

    this.lastPresentView = null;
    this.presentBindGroup = null;
  }

  /**
   * Renders one frame from a layer stack (bottom → top). The caller owns every
   * `frame` and must `.close()` it afterwards; external textures are valid only
   * for the submission issued here. An empty stack clears to black.
   */
  present(layers: readonly CompositeLayer[]): void {
    if (!this.accView || !this.storageAView || !this.storageBView || !this.storageCView) return;

    const encoder = this.device.createCommandEncoder();
    const finalView = this.compositeLayers(encoder, layers);

    // Phase 21: optional zebra clipping overlay — fed from pre-conversion
    // accumulator so isClipped() can detect out-of-range values.
    let presentView = finalView;
    if (this.zebraEnabled && this.clippingOverlayPipeline && this.zebraView && this._lastAccView) {
      presentView = this.encodeZebraOverlay(encoder, this._lastAccView);
    }

    // Phase 21: scope dispatch when enabled (post-composite, pre-present)
    if (this.scopesEnabled && this._lastAccView && this.scopeSab) {
      this.dispatchScopes(encoder, this._lastAccView);
    }

    if (presentView !== this.lastPresentView || !this.presentBindGroup) {
      this.presentBindGroup = this.device.createBindGroup({
        layout: this.presentPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: presentView },
          { binding: 1, resource: this.sampler },
        ],
      });
      this.lastPresentView = presentView;
    }

    const render = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    render.setPipeline(this.presentPipeline);
    render.setBindGroup(0, this.presentBindGroup);
    render.draw(3);
    render.end();

    // Single submission per frame: clear → N×(import → grade → transform → composite) → present.
    this.device.queue.submit([encoder.finish()]);
    this.submissionCount = 1;
  }

  /**
   * Encodes the full layered composite into `encoder` and returns the final
   * accumulator view (after compositing, before output-conversion). Clears the
   * accumulator to opaque black, then composites each layer "over" it in array
   * order (bottom track first).
   *
   * Stage order (single source of truth: PIPELINE_ORDER in colour.ts):
   *   source-normalization → base-correction → lut-apply → opacity →
   *   transform → compositing → output-conversion
   *
   * Returns the final output-converted view. The pre-conversion accumulator
   * view is saved to `_lastAccView` for zebra overlay and scope diagnostics.
   */
  private compositeLayers(
    encoder: GPUCommandEncoder,
    layers: readonly CompositeLayer[],
  ): GPUTextureView {
    const accView = this.accView!;
    const wgX = Math.ceil(this.width / 8);
    const wgY = Math.ceil(this.height / 8);

    // Clear accumulator slot 0 to opaque black.
    {
      const bindGroup = this.device.createBindGroup({
        layout: this.clearPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: accView[0] }],
      });
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.clearPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(wgX, wgY);
      pass.end();
    }

    const storage = { a: this.storageAView!, b: this.storageBView!, c: this.storageCView! };
    let acc = 0; // index of the accumulator holding the current "under"

    layers.forEach((layer, slot) => {
      // Stage 1: source-normalization + colour import
      const srcView =
        layer.kind === 'frame'
          ? this.encodeSourceNormalize(encoder, layer, storage, slot)
          : layer.view;

      const srcWidth = layer.kind === 'frame' ? layer.frame.displayWidth : layer.sourceWidth;
      const srcHeight = layer.kind === 'frame' ? layer.frame.displayHeight : layer.sourceHeight;

      // Stage 2: base-correction (only for frame layers)
      const correctedView =
        layer.kind === 'frame'
          ? this.effectChain.encodeBaseCorrection(
              encoder, srcView, storage, this.width, this.height,
              layer.effects, slot,
            )
          : srcView;

      // Stage 3: lut-apply (only for frame layers with an active LUT)
      let lutView = correctedView;
      if (layer.kind === 'frame' && layer.lut && layer.effects.lutStrength > 0) {
        // Pick a destination that is not the current source
        const lutDst =
          correctedView === storage.a ? storage.b :
          correctedView === storage.b ? storage.c : storage.a;
        lutView = this.effectChain.encodeLut(
          encoder, correctedView, lutDst,
          layer.lut, layer.effects, slot, wgX, wgY,
        );
      }

      // Stage 4: opacity
      const opaqueView = this.encodeOpacity(encoder, lutView, layer.transform, slot, wgX, wgY);

      // Stage 5: transform — pass identity opacity if the opacity stage already
      // multiplied alpha (the transform shader also multiplies by u.params.z).
      const xfParams =
        layer.transform.opacity < 1.0 && opaqueView !== lutView
          ? { ...layer.transform, opacity: 1.0 }
          : layer.transform;
      this.encodeTransform(
        encoder, xfParams, opaqueView, srcWidth, srcHeight, slot, wgX, wgY,
      );

      // Stage 6: compositing
      const under = acc;
      const over = under === 0 ? 1 : 0;
      const bindGroup = this.device.createBindGroup({
        layout: this.compositePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: accView[under] },
          { binding: 1, resource: this.transformView! },
          { binding: 2, resource: accView[over] },
        ],
      });
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.compositePipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(wgX, wgY);
      pass.end();
      acc = over;
    });

    // Stage 7: output-conversion (applied to final accumulator)
    this._lastAccView = accView[acc];
    return this.encodeOutputConvert(encoder, accView[acc], wgX, wgY);
  }

  // ── Stage encoders (Phase 21) ──────────────────────────────────────────

  /** Stage 1: source-normalization — import + normalize to working linear space. */
  private encodeSourceNormalize(
    encoder: GPUCommandEncoder,
    layer: FrameCompositeLayer,
    storage: { a: GPUTextureView; b: GPUTextureView; c: GPUTextureView },
    slot: number,
  ): GPUTextureView {
    const wgX = Math.ceil(this.width / 8);
    const wgY = Math.ceil(this.height / 8);

    // Import external texture via passthrough into storage.a
    const imported = this.effectChain.encodeColourImport(
      encoder,
      this.device.importExternalTexture({ source: layer.frame }),
      storage,
      this.width, this.height,
    );

    // Source normalization: decode transfer + convert colour space to working linear.
    // When per-clip colour metadata is available, the per-clip normalization params
    // are written to the uniform buffer; currently defaults to identity (sRGB→linear).
    let buffer = this.normalizeBuffers[slot];
    if (!buffer) {
      buffer = this.device.createBuffer({
        size: 8, // inverseTransfer: u32 + fullRange: u32
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.normalizeBuffers[slot] = buffer;
    }
    // Default: sRGB→linear, full range
    this.device.queue.writeBuffer(buffer, 0, new Uint32Array([2, 1]));

    // Normalize into storage.b (safe: storage.a holds the imported frame)
    const dstView = storage.b;
    const bindGroup = this.device.createBindGroup({
      layout: this.normalizeGroupLayout,
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: imported },
        { binding: 2, resource: dstView },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.sourceNormalizePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();

    return dstView;
  }

  /** Stage 4: opacity — multiply alpha by per-layer opacity uniform. */
  private encodeOpacity(
    encoder: GPUCommandEncoder,
    srcView: GPUTextureView,
    transform: TransformParams,
    slot: number,
    wgX: number,
    wgY: number,
  ): GPUTextureView {
    if (transform.opacity >= 1.0 || !this.opacityView) return srcView;

    // Use dedicated opacity scratch texture to avoid aliasing with storage.c
    const dstView = this.opacityView;

    let buffer = this.opacityBuffers[slot];
    if (!buffer) {
      buffer = this.device.createBuffer({
        size: 4, // single f32
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.opacityBuffers[slot] = buffer;
    }
    this.device.queue.writeBuffer(buffer, 0, new Float32Array([transform.opacity]));

    const bindGroup = this.device.createBindGroup({
      layout: this.opacityGroupLayout,
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: srcView },
        { binding: 2, resource: dstView },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.opacityPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();

    return dstView;
  }

  /** Stage 7: output-conversion — working linear → sRGB OETF for display/export. */
  private encodeOutputConvert(
    encoder: GPUCommandEncoder,
    accSrc: GPUTextureView,
    wgX: number,
    wgY: number,
  ): GPUTextureView {
    if (!this.outConvView) return accSrc;

    // Write output-conversion uniform
    if (!this.outConvUniform) {
      this.outConvUniform = this.device.createBuffer({
        size: 8, // transferOut: u32 + encodeFullRange: u32
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }
    this.device.queue.writeBuffer(
      this.outConvUniform, 0,
      new Uint32Array([OutputTransfer.SRGB, 1]), // full range
    );

    const bindGroup = this.device.createBindGroup({
      layout: this.outConvGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.outConvUniform } },
        { binding: 1, resource: accSrc },
        { binding: 2, resource: this.outConvView },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.outputConvertPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();

    return this.outConvView;
  }

  private encodeTransform(
    encoder: GPUCommandEncoder,
    transform: TransformParams,
    srcView: GPUTextureView,
    srcWidth: number,
    srcHeight: number,
    slot: number,
    wgX: number,
    wgY: number,
  ): void {
    let buffer = this.transformBuffers[slot];
    if (!buffer) {
      buffer = this.device.createBuffer({
        size: TRANSFORM_UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.transformBuffers[slot] = buffer;
    }
    const packed = packTransformUniform(
      transform,
      this.width,
      this.height,
      srcWidth,
      srcHeight,
    );
    this.device.queue.writeBuffer(buffer, 0, packed);

    const bindGroup = this.device.createBindGroup({
      layout: this.transformPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: srcView },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: this.transformView! },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.transformPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  /**
   * Renders a layer stack through the same compositor as preview, then captures
   * the compositor-backed canvas as the frame handed to the encoder.
   */
  async renderLayeredForExport(
    layers: readonly CompositeLayer[],
    timestamp: number,
    duration: number,
  ): Promise<VideoFrame> {
    this.present(layers);
    await this.device.queue.onSubmittedWorkDone();
    return this.captureCanvasFrame(timestamp, duration);
  }

  /** Emits a GPU-cleared black frame for gaps in the timeline (empty stack). */
  async renderBlackForExport(timestamp: number, duration: number): Promise<VideoFrame> {
    if (this.width <= 0 || this.height <= 0) {
      throw new Error('Export renderer has not been sized.');
    }
    return this.renderLayeredForExport([], timestamp, duration);
  }

  /** Phase 21: encodes the zebra clipping overlay on top of the composited frame. */
  private encodeZebraOverlay(
    encoder: GPUCommandEncoder,
    srcView: GPUTextureView,
  ): GPUTextureView {
    if (!this.clippingOverlayPipeline || !this.zebraView) return srcView;

    const wgX = Math.ceil(this.width / 8);
    const wgY = Math.ceil(this.height / 8);

    // Reusable uniform buffer — avoid per-frame allocation
    if (!this._zebraUniform) {
      this._zebraUniform = this.device.createBuffer({
        size: 12, // width: u32, height: u32, stripePeriod: u32
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }
    this.device.queue.writeBuffer(
      this._zebraUniform, 0,
      new Uint32Array([this.width, this.height, 4]),
    );

    const bindGroup = this.device.createBindGroup({
      layout: this.clippingOverlayPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this._zebraUniform } },
        { binding: 1, resource: srcView },
        { binding: 2, resource: this.zebraView },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.clippingOverlayPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();

    return this.zebraView;
  }

  /** Phase 21: dispatches scope results to the SAB for main-thread rendering.
   *  Currently writes a heartbeat sequence; full shader-based scopes require
   *  storage buffer allocation (deferred to a follow-on). */
  private dispatchScopes(
    _encoder: GPUCommandEncoder,
    _accView: GPUTextureView,
  ): void {
    if (!this.scopeSab) return;
    const seq = this.scopeSab[0] + 1;
    this.scopeSab[0] = seq;
  }

  destroy(): void {
    this.effectChain.destroy();
    this.destroyTextures();
    for (const buffer of this.transformBuffers) buffer.destroy();
    this.transformBuffers.length = 0;
    for (const buffer of this.normalizeBuffers) buffer.destroy();
    this.normalizeBuffers.length = 0;
    for (const buffer of this.opacityBuffers) buffer.destroy();
    this.opacityBuffers.length = 0;
    this.outConvUniform?.destroy();
    this.outConvUniform = null;
    this.presentBindGroup = null;
    this.lastPresentView = null;
    this.scopeSab = null;
    this.device.destroy();
  }

  private destroyTextures(): void {
    this.storageA?.destroy();
    this.storageB?.destroy();
    this.storageC?.destroy();
    this.transformTex?.destroy();
    this.outConvTex?.destroy();
    this.opacityTex?.destroy();
    this.zebraTex?.destroy();
    this.accTex?.[0]?.destroy();
    this.accTex?.[1]?.destroy();
    this.storageA = null;
    this.storageB = null;
    this.storageC = null;
    this.transformTex = null;
    this.outConvTex = null;
    this.outConvView = null;
    this.opacityTex = null;
    this.opacityView = null;
    this.zebraTex = null;
    this.zebraView = null;
    this._zebraUniform?.destroy();
    this._zebraUniform = null;
    this.accTex = null;
    this.storageAView = null;
    this.storageBView = null;
    this.storageCView = null;
    this.transformView = null;
    this.accView = null;
  }

  private captureCanvasFrame(timestamp: number, duration: number): VideoFrame {
    return new VideoFrame(this.canvas, {
      timestamp: Math.round(timestamp * 1_000_000),
      duration: Math.max(1, Math.round(duration * 1_000_000)),
    });
  }
}

export async function initGpu(canvas: OffscreenCanvas): Promise<GpuInit> {
  if (!navigator.gpu) {
    return unavailable(
      'This browser does not expose the WebGPU API. Use a recent Chromium-based desktop browser (Chrome/Edge 113+).',
    );
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    return unavailable(
      'No WebGPU adapter was found. Enable hardware acceleration and update your GPU drivers, then reload.',
    );
  }

  const wantedFeatures: GPUFeatureName[] = [];
  const useF16 = adapter.features.has('shader-f16');
  const hasSubgroups = adapter.features.has('subgroups');
  const hasTimestampQuery = adapter.features.has('timestamp-query');
  if (useF16) wantedFeatures.push('shader-f16');
  if (hasSubgroups) wantedFeatures.push('subgroups');
  if (hasTimestampQuery) wantedFeatures.push('timestamp-query');

  let device: GPUDevice;
  try {
    device = await adapter.requestDevice({ requiredFeatures: wantedFeatures });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return unavailable(`WebGPU device request failed: ${detail}`);
  }

  const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!context) {
    device.destroy();
    return unavailable('Could not acquire a WebGPU context for the preview canvas.');
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
  });

  return {
    renderer: new PreviewRenderer(device, context, format, canvas, useF16),
    features: [...wantedFeatures],
    unavailableReason: null,
  };
}

export { DEFAULT_TRANSFORM };
