export interface CloseableFrame {
  close: () => void;
}

export interface CloseableBitmap {
  readonly width: number;
  readonly height: number;
  close: () => void;
}

export interface CanvasLayer {
  bitmap: CloseableBitmap;
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DrawTarget {
  clearRect: (x: number, y: number, width: number, height: number) => void;
  drawImage: (bitmap: CloseableBitmap, x: number, y: number, width: number, height: number) => void;
  globalAlpha: number;
}

export function fitWithin720p(sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  const width = Math.max(1, sourceWidth);
  const height = Math.max(1, sourceHeight);
  const scale = Math.min(1, 1280 / width, 720 / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export class BoundedFrameQueue<T extends CloseableFrame> {
  private readonly frames: T[] = [];

  constructor(private readonly maxFrames = 3) {}

  push(frame: T): void {
    // `> 0` guards against a non-positive maxFrames turning this into an infinite
    // loop (`0 >= 0` is true even when the queue is empty).
    while (this.frames.length > 0 && this.frames.length >= this.maxFrames) {
      this.frames.shift()?.close();
    }
    this.frames.push(frame);
  }

  clear(): void {
    for (const frame of this.frames.splice(0)) frame.close();
  }

  get size(): number {
    return this.frames.length;
  }
}

export async function bitmapFromFrame<TFrame extends CloseableFrame, TBitmap extends CloseableBitmap>(
  frame: TFrame,
  createBitmap: (frame: TFrame, resize: { resizeWidth: number; resizeHeight: number }) => Promise<TBitmap>,
  sourceWidth: number,
  sourceHeight: number,
): Promise<TBitmap> {
  const size = fitWithin720p(sourceWidth, sourceHeight);
  // try/catch (not .catch) so a synchronous throw from createBitmap still closes
  // the frame — every VideoFrame must be released exactly once on every path.
  let bitmap: TBitmap;
  try {
    bitmap = await createBitmap(frame, { resizeWidth: size.width, resizeHeight: size.height });
  } catch (e) {
    frame.close();
    throw e;
  }
  frame.close();
  return bitmap;
}

export function drawLayers(
  target: DrawTarget,
  layers: readonly CanvasLayer[],
  width: number,
  height: number,
): void {
  try {
    target.clearRect(0, 0, width, height);
    for (const layer of layers) {
      target.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
      target.drawImage(layer.bitmap, layer.x, layer.y, layer.width, layer.height);
    }
  } finally {
    // Close every layer's bitmap even if an earlier drawImage threw — otherwise a
    // single failed layer would leak the remaining (already-decoded) bitmaps.
    for (const layer of layers) {
      try {
        layer.bitmap.close();
      } catch {
        // ignore double-close / cleanup errors
      }
    }
    target.globalAlpha = 1;
  }
}
