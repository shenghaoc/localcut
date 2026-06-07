export interface CompatGpuQueue {
  submit: (commands: readonly unknown[]) => void;
}

export interface CompatGpuDevice {
  queue: CompatGpuQueue & {
    copyExternalImageToTexture: (
      source: { source: CompatImageBitmap },
      destination: unknown,
      size: readonly [number, number],
    ) => void;
  };
}

export interface CompatImageBitmap {
  readonly width: number;
  readonly height: number;
  close: () => void;
}

export interface CompatVideoFrame {
  close: () => void;
}

export async function uploadCompatFrame<TFrame extends CompatVideoFrame>(
  device: CompatGpuDevice,
  frame: TFrame,
  destination: unknown,
  createBitmap: (frame: TFrame) => Promise<CompatImageBitmap>,
): Promise<void> {
  // try/catch (not .catch) so a synchronous throw from createBitmap still closes
  // the frame — the compat ingestion path must release every VideoFrame once.
  let bitmap: CompatImageBitmap;
  try {
    bitmap = await createBitmap(frame);
  } catch (e) {
    frame.close();
    throw e;
  }
  frame.close();
  try {
    device.queue.copyExternalImageToTexture(
      { source: bitmap },
      destination,
      [bitmap.width, bitmap.height],
    );
    device.queue.submit([{}]);
  } finally {
    bitmap.close();
  }
}
