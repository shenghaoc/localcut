/** WebGPU device + OffscreenCanvas — expanded in Phase 2. */

export interface GpuContext {
  device: GPUDevice | null;
  context: GPUCanvasContext | null;
  features: string[];
  /** Specific, actionable reason WebGPU is unavailable, or null when ready. */
  unavailableReason: string | null;
}

function unavailable(reason: string): GpuContext {
  return { device: null, context: null, features: [], unavailableReason: reason };
}

export async function initGpu(canvas: OffscreenCanvas): Promise<GpuContext> {
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

  return { device, context, features: [...wantedFeatures], unavailableReason: null };
}

export function destroyGpu(gpu: GpuContext | null) {
  gpu?.device?.destroy();
}
