import type { CapabilityProbeResult, ExportCodecSupport, ExportVideoCodec } from '../../protocol';
import { exportConstraintsForProbe } from '../capability-probe-v2';
import type { CloseableBitmap, CloseableFrame } from './canvas-compositor';

export interface EncodeQueue {
  readonly encodeQueueSize: number;
}

export type Delay = () => Promise<void>;

export function limitedExportCodecs(probe: CapabilityProbeResult): readonly ExportCodecSupport[] {
  return exportConstraintsForProbe(probe).filter((entry) => entry.codec === 'h264' || entry.codec === 'vp9');
}

export function chooseLimitedExportCodec(probe: CapabilityProbeResult): ExportVideoCodec | null {
  const supported = limitedExportCodecs(probe);
  if (supported.some((entry) => entry.codec === 'h264')) return 'h264';
  if (supported.some((entry) => entry.codec === 'vp9')) return 'vp9';
  return null;
}

export async function waitForEncodeQueue(
  encoder: EncodeQueue,
  maxQueueSize = 3,
  delay: Delay = () => new Promise((resolve) => setTimeout(resolve, 0)),
): Promise<void> {
  while (encoder.encodeQueueSize > maxQueueSize) {
    await delay();
  }
}

export async function makeVideoFrameFromBitmap<TBitmap extends CloseableBitmap, TFrame extends CloseableFrame>(
  bitmap: TBitmap,
  createFrame: (bitmap: TBitmap) => TFrame,
): Promise<TFrame> {
  const frame = createFrame(bitmap);
  bitmap.close();
  return frame;
}
