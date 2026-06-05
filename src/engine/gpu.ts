/** WebGPU device, OffscreenCanvas, and the zero-copy preview renderer (Phase 2+4). */

import presentSource from './shaders/present.wgsl?raw';
import {
  EffectChain,
  clipEffectsEqual,
  type ClipEffectParams,
  DEFAULT_CLIP_EFFECTS,
  normalizeClipEffects,
} from './effects';

export interface GpuInit {
  /** Ready renderer, or null when WebGPU is unavailable. */
  renderer: PreviewRenderer | null;
  features: string[];
  /** Specific, actionable reason WebGPU is unavailable, or null when ready. */
  unavailableReason: string | null;
}

function unavailable(reason: string): GpuInit {
  return { renderer: null, features: [], unavailableReason: reason };
}

/**
 * Owns the WebGPU device and the per-frame zero-copy preview pipeline.
 *
 * Per frame: `importExternalTexture(VideoFrame)` → colour-grade compute chain
 * (ping-pong storage A/B/C) → fullscreen-triangle present — all inside a single
 * command submission. No CPU pixel readback ever happens.
 */
export class PreviewRenderer {
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly canvas: OffscreenCanvas;

  private readonly effectChain: EffectChain;
  private readonly presentPipeline: GPURenderPipeline;
  private readonly sampler: GPUSampler;

  private storageA: GPUTexture | null = null;
  private storageB: GPUTexture | null = null;
  private storageC: GPUTexture | null = null;
  private storageAView: GPUTextureView | null = null;
  private storageBView: GPUTextureView | null = null;
  private storageCView: GPUTextureView | null = null;
  private presentBindGroup: GPUBindGroup | null = null;
  /** Texture view last written by the effect chain (A, B, or C depending on active passes). */
  private lastPresentView: GPUTextureView | null = null;
  private width = 0;
  private height = 0;
  private submissionCount = 0;
  private clipEffects: ClipEffectParams = { ...DEFAULT_CLIP_EFFECTS };

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

  /** Processed output view from the most recent frame (preview + export share this). */
  getProcessedTextureView(): GPUTextureView | null {
    return this.lastPresentView ?? this.storageAView;
  }

  setClipEffects(params: Partial<ClipEffectParams> | undefined): void {
    const next = normalizeClipEffects(params);
    if (clipEffectsEqual(next, this.clipEffects)) return;
    this.clipEffects = next;
    this.effectChain.setParams(this.clipEffects);
  }

  /**
   * (Re)allocates storage textures A/B/C and resizes the canvas backing store.
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

    this.storageA?.destroy();
    this.storageB?.destroy();
    this.storageC?.destroy();

    this.storageA = this.device.createTexture({ size, format: 'rgba8unorm', usage });
    this.storageB = this.device.createTexture({ size, format: 'rgba8unorm', usage });
    this.storageC = this.device.createTexture({ size, format: 'rgba8unorm', usage });
    this.storageAView = this.storageA.createView();
    this.storageBView = this.storageB.createView();
    this.storageCView = this.storageC.createView();

    this.lastPresentView = null;
    this.rebuildPresentBindGroup();
  }

  /**
   * Renders one frame. The caller owns `frame` and must `.close()` it afterwards;
   * the external texture is only valid for the submission issued here.
   */
  present(frame: VideoFrame, effects?: Partial<ClipEffectParams>): void {
    if (!this.storageAView || !this.storageBView || !this.storageCView || !this.presentBindGroup) {
      return;
    }

    this.setClipEffects(effects);

    const external = this.device.importExternalTexture({ source: frame });
    const encoder = this.device.createCommandEncoder();

    const outputView = this.effectChain.encodeColourChain(
      encoder,
      external,
      { a: this.storageAView, b: this.storageBView, c: this.storageCView },
      this.width,
      this.height,
    );

    if (outputView !== this.lastPresentView) {
      this.rebuildPresentBindGroup(outputView);
      this.lastPresentView = outputView;
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

    // Single submission per frame for import → effect chain → present.
    this.device.queue.submit([encoder.finish()]);
    this.submissionCount = 1;
  }

  /**
   * Renders through the same importExternalTexture → effect chain → present path,
   * then captures the compositor-backed canvas as the frame handed to the encoder.
   */
  async renderForExport(
    frame: VideoFrame,
    timestamp: number,
    duration: number,
    effects?: Partial<ClipEffectParams>,
  ): Promise<VideoFrame> {
    this.present(frame, effects);
    await this.device.queue.onSubmittedWorkDone();
    return this.captureCanvasFrame(timestamp, duration);
  }

  /** Emits a GPU-cleared black frame for gaps in the timeline. */
  async renderBlackForExport(timestamp: number, duration: number): Promise<VideoFrame> {
    if (this.width <= 0 || this.height <= 0) {
      throw new Error('Export renderer has not been sized.');
    }

    const encoder = this.device.createCommandEncoder();
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
    render.end();

    this.device.queue.submit([encoder.finish()]);
    this.submissionCount = 1;
    await this.device.queue.onSubmittedWorkDone();
    return this.captureCanvasFrame(timestamp, duration);
  }

  destroy(): void {
    this.effectChain.destroy();
    this.storageA?.destroy();
    this.storageB?.destroy();
    this.storageC?.destroy();
    this.storageA = null;
    this.storageB = null;
    this.storageC = null;
    this.storageAView = null;
    this.storageBView = null;
    this.storageCView = null;
    this.presentBindGroup = null;
    this.lastPresentView = null;
    this.device.destroy();
  }

  private rebuildPresentBindGroup(source: GPUTextureView | null = this.storageAView): void {
    if (!source) return;
    this.presentBindGroup = this.device.createBindGroup({
      layout: this.presentPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source },
        { binding: 1, resource: this.sampler },
      ],
    });
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
