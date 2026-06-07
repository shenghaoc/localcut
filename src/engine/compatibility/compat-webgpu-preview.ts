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
  const bitmap = await createBitmap(frame).catch((e) => { frame.close(); throw e; });
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
