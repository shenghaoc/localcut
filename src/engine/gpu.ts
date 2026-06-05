/** WebGPU device + OffscreenCanvas — expanded in Phase 2. */

export interface GpuContext {
  device: GPUDevice | null;
  context: GPUCanvasContext | null;
  features: string[];
}

export async function initGpu(canvas: OffscreenCanvas): Promise<GpuContext> {
  if (!navigator.gpu) {
    return { device: null, context: null, features: [] };
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    return { device: null, context: null, features: [] };
  }

  const wantedFeatures: GPUFeatureName[] = [];
  if (adapter.features.has('shader-f16')) wantedFeatures.push('shader-f16');
  if (adapter.features.has('subgroups')) wantedFeatures.push('subgroups');
  if (adapter.features.has('timestamp-query')) wantedFeatures.push('timestamp-query');

  const device = await adapter.requestDevice({ requiredFeatures: wantedFeatures });
  const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!context) {
    device.destroy();
    return { device: null, context: null, features: [] };
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
  });

  return { device, context, features: [...wantedFeatures] };
}

export function destroyGpu(gpu: GpuContext | null) {
  gpu?.device?.destroy();
}
