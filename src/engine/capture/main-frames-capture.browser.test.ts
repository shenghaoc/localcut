import { describe, expect, it } from 'vite-plus/test';
import type { EncodedPacket } from 'mediabunny';
import { TrackPipeline, type TrackPipelineCallbacks } from './track-pipeline';
import { startCaptureFrameReader } from '../../ui/capture-frame-reader';

/**
 * Bugfix B5/T5.5 — real end-to-end verification of the off-main-thread main-frames
 * recording fallback in a live Chromium, mirroring "start a screen capture, record,
 * confirm the output contains encoded video (not an empty file)".
 *
 * A canvas `captureStream()` video track stands in for the screen-capture track (the
 * encoder is source-agnostic; both are `MediaStreamVideoTrack`s feeding MSTP, and
 * `getDisplayMedia`'s picker can't run headlessly). The data path is the actual
 * fallback code: a main-thread `MediaStreamTrackProcessor` (`startCaptureFrameReader`)
 * → trackless push `TrackPipeline` → real `VideoEncoder`. We assert real encoded
 * chunks land with non-zero bytes and a key frame — exactly what the reverted attempt
 * (frames posted to the writer worker, dropped + leaked) produced none of.
 */

interface CanvasCaptureTrack extends MediaStreamTrack {
	requestFrame?: () => void;
}

async function firstSupportedVideoConfig(): Promise<VideoEncoderConfig | null> {
	const candidates: VideoEncoderConfig[] = [
		{ codec: 'avc1.42001E', width: 320, height: 240, bitrate: 1_000_000, latencyMode: 'realtime' },
		{
			codec: 'vp09.00.10.08',
			width: 320,
			height: 240,
			bitrate: 1_000_000,
			latencyMode: 'realtime'
		},
		{ codec: 'vp8', width: 320, height: 240, bitrate: 1_000_000, latencyMode: 'realtime' }
	];
	for (const config of candidates) {
		try {
			const support = await VideoEncoder.isConfigSupported(config);
			if (support.supported) return config;
		} catch {
			// try the next codec
		}
	}
	return null;
}

const apisPresent =
	typeof VideoEncoder !== 'undefined' &&
	typeof MediaStreamTrackProcessor !== 'undefined' &&
	typeof document !== 'undefined' &&
	typeof HTMLCanvasElement !== 'undefined' &&
	typeof HTMLCanvasElement.prototype.captureStream === 'function';

describe('main-frames capture (real Chromium, B5/T5.5)', () => {
	it('encodes a canvas capture track through the push pipeline into non-empty video', async (ctx) => {
		if (!apisPresent) {
			ctx.skip();
			return;
		}
		const videoConfig = await firstSupportedVideoConfig();
		if (!videoConfig) {
			ctx.skip();
			return;
		}

		const canvas = document.createElement('canvas');
		canvas.width = 320;
		canvas.height = 240;
		const gtx = canvas.getContext('2d');
		expect(gtx).not.toBeNull();
		const draw = (frameIndex: number) => {
			gtx!.fillStyle = frameIndex % 2 === 0 ? '#1133cc' : '#cc8811';
			gtx!.fillRect(0, 0, 320, 240);
			gtx!.fillStyle = '#ffffff';
			gtx!.fillRect((frameIndex * 7) % 300, 20, 24, 200);
		};
		draw(0);

		const stream = canvas.captureStream(30);
		const track = stream.getVideoTracks()[0] as CanvasCaptureTrack;
		expect(track).toBeTruthy();

		const packets: { byteLength: number; keyFrame: boolean }[] = [];
		const errors: string[] = [];
		// Ack indirection so `pipeline` stays a const: the CaptureSession acks once the
		// writer persists each chunk; here we ack immediately to keep slots flowing.
		const ackRef: { ack: () => void } = { ack: () => {} };
		const callbacks: TrackPipelineCallbacks = {
			onEncodedChunk: (_sourceId, packet: EncodedPacket, _fromUs, _toUs, keyFrame) => {
				packets.push({ byteLength: packet.byteLength, keyFrame });
				ackRef.ack();
			},
			onChunkAck: () => {},
			onEncodeError: (_sourceId, error) => {
				errors.push(error);
			},
			onAudioOverrun: () => {},
			onPipelineEnded: () => {}
		};

		const pipeline = new TrackPipeline({
			sourceId: 'screen-1',
			kind: 'screen',
			// No track ⇒ push pipeline (main forwards frames).
			videoEncodeConfig: videoConfig,
			callbacks,
			abort: new AbortController()
		});
		ackRef.ack = () => pipeline.onChunkAck();

		pipeline.start(2_000_000);
		const reader = startCaptureFrameReader(
			track,
			(frame) => pipeline.pushFrame(frame as VideoFrame),
			(error) => errors.push(error instanceof Error ? error.message : String(error))
		);

		// Drive the canvas so the capture track emits frames for ~700ms.
		for (let i = 1; i <= 42; i++) {
			draw(i);
			track.requestFrame?.();
			await new Promise((resolve) => setTimeout(resolve, 16));
		}

		reader.stop();
		await pipeline.stop(); // flushes + closes the encoder
		track.stop();

		expect(errors).toEqual([]);
		// Real encoded output: at least one chunk, non-empty bytes, and a key frame.
		expect(packets.length).toBeGreaterThan(0);
		const totalBytes = packets.reduce((sum, p) => sum + p.byteLength, 0);
		expect(totalBytes).toBeGreaterThan(0);
		expect(packets.some((p) => p.keyFrame)).toBe(true);
	}, 20_000);
});
