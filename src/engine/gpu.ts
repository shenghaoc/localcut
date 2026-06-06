/** WebGPU device, OffscreenCanvas, and the zero-copy layered compositor (Phase 2/4/12). */

import presentSource from './shaders/present.wgsl?raw';
import clearSource from './shaders/clear.wgsl?raw';
import transformF32 from './shaders/transform.wgsl?raw';
import transformF16 from './shaders/transform.f16.wgsl?raw';
import compositeOverF32 from './shaders/composite-over.wgsl?raw';
import compositeOverF16 from './shaders/composite-over.f16.wgsl?raw';
import { EffectChain, type ClipEffectParams } from './effects';
import {
  DEFAULT_TRANSFORM,
  packTransformUniform,
  TRANSFORM_UNIFORM_BYTES,
  type TransformParams,
} from './transform';

export interface GpuInit {
  /** Ready renderer, or null when WebGPU is unavailable. */
  renderer: PreviewRenderer | null;
  features: string[];
  /** Specific, actionable reason WebGPU is unavailable, or null when ready. */
  unavailableReason: string | null;
}

/**
 * One composite layer. Only `'frame'` (per-frame decoded video, re-imported every
 * frame) exists in Phase 12; the `'texture'` arm is the designed entry point for
 * Phase 14 pre-rendered title textures, so the composite loop extends rather than
 * forks.
 */
export interface FrameCompositeLayer {
  kind: 'frame';
  /** Caller-owned; valid only for the submission issued by this call. */
  frame: VideoFrame;
  effects: ClipEffectParams;
  transform: TransformParams;
}

export type CompositeLayer = FrameCompositeLayer;

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

  private presentBindGroup: GPUBindGroup | null = null;
  /** Accumulator view holding the most recent composited frame (preview + export). */
  private lastPresentView: GPUTextureView | null = null;
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

  /** Submissions issued by the last `present()` call (always 1 when a frame rendered). */
  get lastFrameSubmissionCount(): number {
    return this.submissionCount;
  }

  /** Final composited view from the most recent frame (preview + export share this). */
  getProcessedTextureView(): GPUTextureView | null {
    return this.lastPresentView;
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
    this.accTex = [
      this.device.createTexture({ size, format: 'rgba8unorm', usage }),
      this.device.createTexture({ size, format: 'rgba8unorm', usage }),
    ];
    this.storageAView = this.storageA.createView();
    this.storageBView = this.storageB.createView();
    this.storageCView = this.storageC.createView();
    this.transformView = this.transformTex.createView();
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

    if (finalView !== this.lastPresentView || !this.presentBindGroup) {
      this.presentBindGroup = this.device.createBindGroup({
        layout: this.presentPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: finalView },
          { binding: 1, resource: this.sampler },
        ],
      });
      this.lastPresentView = finalView;
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
   * accumulator view. Clears the accumulator to opaque black, then composites
   * each layer "over" it in array order (bottom track first).
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
      // 'frame' is the only arm in Phase 12; switch keeps the 'texture' arm open.
      const srcView = this.encodeLayerColour(encoder, layer, storage, slot);
      this.encodeTransform(encoder, layer, srcView, slot, wgX, wgY);

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

    return accView[acc];
  }

  private encodeLayerColour(
    encoder: GPUCommandEncoder,
    layer: CompositeLayer,
    storage: { a: GPUTextureView; b: GPUTextureView; c: GPUTextureView },
    slot: number,
  ): GPUTextureView {
    // Re-imported every frame; the bind group referencing it is rebuilt per frame.
    const external = this.device.importExternalTexture({ source: layer.frame });
    return this.effectChain.encodeColourChain(
      encoder,
      external,
      storage,
      this.width,
      this.height,
      layer.effects,
      slot,
    );
  }

  private encodeTransform(
    encoder: GPUCommandEncoder,
    layer: CompositeLayer,
    srcView: GPUTextureView,
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
      layer.transform,
      this.width,
      this.height,
      layer.frame.displayWidth,
      layer.frame.displayHeight,
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

  destroy(): void {
    this.effectChain.destroy();
    this.destroyTextures();
    for (const buffer of this.transformBuffers) buffer.destroy();
    this.transformBuffers.length = 0;
    this.presentBindGroup = null;
    this.lastPresentView = null;
    this.device.destroy();
  }

  private destroyTextures(): void {
    this.storageA?.destroy();
    this.storageB?.destroy();
    this.storageC?.destroy();
    this.transformTex?.destroy();
    this.accTex?.[0]?.destroy();
    this.accTex?.[1]?.destroy();
    this.storageA = null;
    this.storageB = null;
    this.storageC = null;
    this.transformTex = null;
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
  if (useF16) wantedFeatures.push('shader-f16');
  if (adapter.features.has('subgroups')) wantedFeatures.push('subgroups');
  if (adapter.features.has('timestamp-query')) wantedFeatures.push('timestamp-query');

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
