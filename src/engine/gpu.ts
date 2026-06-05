/** WebGPU device, OffscreenCanvas, and the zero-copy preview renderer (Phase 2). */

import passthroughSource from './shaders/passthrough.wgsl?raw';
import presentSource from './shaders/present.wgsl?raw';

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
 * Per frame: `importExternalTexture(VideoFrame)` → compute passthrough into a
 * storage texture → fullscreen-triangle present to the canvas — all inside a
 * single command submission. No CPU pixel readback ever happens.
 */
export class PreviewRenderer {
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly canvas: OffscreenCanvas;

  private readonly computePipeline: GPUComputePipeline;
  private readonly presentPipeline: GPURenderPipeline;
  private readonly sampler: GPUSampler;

  private storageTexture: GPUTexture | null = null;
  private storageTextureView: GPUTextureView | null = null;
  private presentBindGroup: GPUBindGroup | null = null;
  private width = 0;
  private height = 0;

  constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    canvas: OffscreenCanvas,
  ) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.canvas = canvas;

    const passthroughModule = device.createShaderModule({ code: passthroughSource });
    const presentModule = device.createShaderModule({ code: presentSource });

    this.computePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: passthroughModule, entryPoint: 'main' },
    });
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

  /**
   * (Re)allocates the storage texture and resizes the canvas backing store to the
   * preview resolution. Cheap no-op when the size is unchanged. Called on import
   * and whenever the adaptive controller changes tiers.
   */
  setPreviewSize(width: number, height: number): void {
    const w = Math.max(2, width);
    const h = Math.max(2, height);
    if (w === this.width && h === this.height && this.storageTexture) return;

    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
    });

    this.storageTexture?.destroy();
    this.storageTexture = this.device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.storageTextureView = this.storageTexture.createView();
    this.presentBindGroup = this.device.createBindGroup({
      layout: this.presentPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.storageTextureView },
        { binding: 1, resource: this.sampler },
      ],
    });
  }

  /**
   * Renders one frame. The caller owns `frame` and must `.close()` it afterwards;
   * the external texture is only valid for the submission issued here.
   */
  present(frame: VideoFrame): void {
    if (!this.storageTextureView || !this.presentBindGroup) return;

    const external = this.device.importExternalTexture({ source: frame });
    const computeBindGroup = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: external },
        { binding: 1, resource: this.storageTextureView },
      ],
    });

    const encoder = this.device.createCommandEncoder();

    const compute = encoder.beginComputePass();
    compute.setPipeline(this.computePipeline);
    compute.setBindGroup(0, computeBindGroup);
    compute.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
    compute.end();

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

    // Single submission per frame for the whole import → compute → present chain.
    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.storageTexture?.destroy();
    this.storageTexture = null;
    this.storageTextureView = null;
    this.presentBindGroup = null;
    this.device.destroy();
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
  if (adapter.features.has('shader-f16')) wantedFeatures.push('shader-f16');
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
    renderer: new PreviewRenderer(device, context, format, canvas),
    features: [...wantedFeatures],
    unavailableReason: null,
  };
}
