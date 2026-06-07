import { describe, expect, it, vi } from 'vitest';
import { chooseLimitedExportCodec, makeVideoFrameFromBitmap, waitForEncodeQueue } from './compat-export';
import { probeResultFor } from './capability-fixtures';
import { bitmapFromFrame, BoundedFrameQueue, drawLayers, fitWithin720p } from './canvas-compositor';
import canvasCompositorSource from './canvas-compositor.ts?raw';
import { uploadCompatFrame } from './compat-webgpu-preview';

describe('canvas compatibility compositor helpers', () => {
  it('caps both dimensions within 1280x720', () => {
    expect(fitWithin720p(3840, 2160)).toEqual({ width: 1280, height: 720 });
    expect(fitWithin720p(1080, 1920)).toEqual({ width: 405, height: 720 });
  });

  it('closes the oldest frame when the queue exceeds three frames', () => {
    const closes = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    const queue = new BoundedFrameQueue<{ close: () => void }>(3);
    for (const close of closes) queue.push({ close });
    expect(closes[0]).toHaveBeenCalledTimes(1);
    expect(closes[1]).not.toHaveBeenCalled();
    expect(queue.size).toBe(3);
  });

  it('does not loop forever when constructed with a non-positive bound', () => {
    const closes = [vi.fn(), vi.fn()];
    const queue = new BoundedFrameQueue<{ close: () => void }>(0);
    // Without the `length > 0` guard, a `0 >= 0` bound spins forever on an empty
    // queue. With it, each push evicts the prior frame and keeps at most one — and
    // crucially the call returns instead of hanging the worker.
    for (const close of closes) queue.push({ close });
    expect(queue.size).toBe(1);
    expect(closes[0]).toHaveBeenCalledTimes(1);
    expect(closes[1]).not.toHaveBeenCalled();
  });

  it('closes the VideoFrame when bitmap creation rejects', async () => {
    const frameClose = vi.fn();
    await expect(
      bitmapFromFrame({ close: frameClose }, async () => { throw new Error('decode-failed'); }, 100, 50),
    ).rejects.toThrow('decode-failed');
    expect(frameClose).toHaveBeenCalledTimes(1);
  });

  it('closes the VideoFrame when bitmap creation throws synchronously', async () => {
    const frameClose = vi.fn();
    await expect(
      bitmapFromFrame({ close: frameClose }, () => { throw new Error('sync-throw'); }, 100, 50),
    ).rejects.toThrow('sync-throw');
    expect(frameClose).toHaveBeenCalledTimes(1);
  });

  it('closes every layer bitmap even when an earlier drawImage throws', () => {
    const closes = [vi.fn(), vi.fn(), vi.fn()];
    const layers = closes.map((close, i) => ({
      bitmap: { width: 10, height: 10, close },
      opacity: 1,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      id: i,
    }));
    const target = {
      globalAlpha: 1,
      clearRect: vi.fn(),
      drawImage: vi.fn((bitmap: { width: number }) => {
        // Fail on the second layer; the first and third must still be closed.
        if (target.drawImage.mock.calls.length === 2) throw new Error('draw-failed');
        void bitmap;
      }),
    };
    expect(() => drawLayers(target, layers, 10, 10)).toThrow('draw-failed');
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
    expect(target.globalAlpha).toBe(1);
  });

  it('closes frames after bitmap creation and layer bitmaps after draw', async () => {
    const frameClose = vi.fn();
    const bitmapClose = vi.fn();
    const bitmap = await bitmapFromFrame(
      { close: frameClose },
      async () => ({ width: 100, height: 50, close: bitmapClose }),
      100,
      50,
    );
    expect(frameClose).toHaveBeenCalledTimes(1);
    const target = {
      globalAlpha: 1,
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    };
    drawLayers(target, [{ bitmap, opacity: 0.5, x: 0, y: 0, width: 100, height: 50 }], 100, 50);
    expect(bitmapClose).toHaveBeenCalledTimes(1);
    expect(target.drawImage).toHaveBeenCalledTimes(1);
  });

  it('clears the shared title raster canvas before each title layer draw', () => {
    expect(canvasCompositorSource).toContain(
      'this.titleCtx.clearRect(0, 0, TITLE_RASTER_WIDTH, TITLE_RASTER_HEIGHT);',
    );
    expect(canvasCompositorSource.indexOf('this.titleCtx.clearRect(0, 0, TITLE_RASTER_WIDTH, TITLE_RASTER_HEIGHT);'))
      .toBeLessThan(canvasCompositorSource.indexOf('rasterizeTitleToCanvas(this.titleCtx, TITLE_RASTER_WIDTH, TITLE_RASTER_HEIGHT, layer.content);'));
  });
});

describe('compat WebGPU upload', () => {
  it('closes the VideoFrame after createImageBitmap and closes the upload bitmap after copy', async () => {
    const frameClose = vi.fn();
    const bitmapClose = vi.fn();
    const copyExternalImageToTexture = vi.fn();
    const submit = vi.fn();
    await uploadCompatFrame(
      { queue: { copyExternalImageToTexture, submit } },
      { close: frameClose },
      {},
      async () => ({ width: 320, height: 180, close: bitmapClose }),
    );
    expect(frameClose).toHaveBeenCalledTimes(1);
    expect(copyExternalImageToTexture).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(bitmapClose).toHaveBeenCalledTimes(1);
  });

  it('closes the VideoFrame and skips the GPU copy when bitmap creation rejects', async () => {
    const frameClose = vi.fn();
    const copyExternalImageToTexture = vi.fn();
    const submit = vi.fn();
    await expect(
      uploadCompatFrame(
        { queue: { copyExternalImageToTexture, submit } },
        { close: frameClose },
        {},
        async () => { throw new Error('compat-decode-failed'); },
      ),
    ).rejects.toThrow('compat-decode-failed');
    expect(frameClose).toHaveBeenCalledTimes(1);
    expect(copyExternalImageToTexture).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('closes the VideoFrame when bitmap creation throws synchronously', async () => {
    const frameClose = vi.fn();
    const copyExternalImageToTexture = vi.fn();
    const submit = vi.fn();
    await expect(
      uploadCompatFrame(
        { queue: { copyExternalImageToTexture, submit } },
        { close: frameClose },
        {},
        () => { throw new Error('compat-sync-throw'); },
      ),
    ).rejects.toThrow('compat-sync-throw');
    expect(frameClose).toHaveBeenCalledTimes(1);
    expect(copyExternalImageToTexture).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});

describe('compat export helpers', () => {
  it('selects h264 before vp9 and null when no limited encoder is available', () => {
    expect(chooseLimitedExportCodec(probeResultFor('compatibility-webgpu'))).toBe('h264');
    expect(chooseLimitedExportCodec(probeResultFor('limited-webcodecs'))).toBeNull();
  });

  it('waits while the encode queue is full', async () => {
    let queueSize = 5;
    let waits = 0;
    await waitForEncodeQueue(
      { get encodeQueueSize() { return queueSize; } },
      3,
      async () => {
        waits += 1;
        queueSize -= 2;
      },
    );
    expect(waits).toBe(1);
  });

  it('closes bitmaps after creating VideoFrames', async () => {
    const bitmapClose = vi.fn();
    const frame = await makeVideoFrameFromBitmap(
      { width: 10, height: 10, close: bitmapClose },
      () => ({ close: vi.fn() }),
    );
    expect(bitmapClose).toHaveBeenCalledTimes(1);
    expect(frame).toBeDefined();
  });

  it('closes the bitmap when VideoFrame construction throws', async () => {
    const bitmapClose = vi.fn();
    await expect(
      makeVideoFrameFromBitmap({ width: 10, height: 10, close: bitmapClose }, () => {
        throw new Error('frame-ctor-failed');
      }),
    ).rejects.toThrow('frame-ctor-failed');
    expect(bitmapClose).toHaveBeenCalledTimes(1);
  });
});
