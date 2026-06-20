import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { CaptureSession } from './capture-session';
import { createMockVideoFrame, getCloseCount } from './capture-fixtures';

function callbacks() {
	return {
		onStatusChange: vi.fn(),
		onError: vi.fn()
	};
}

function fakeWriterPort() {
	return {
		postMessage: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn()
	} as unknown as MessagePort & {
		postMessage: ReturnType<typeof vi.fn>;
		addEventListener: ReturnType<typeof vi.fn>;
		removeEventListener: ReturnType<typeof vi.fn>;
	};
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('CaptureSession writer finalization', () => {
	it('does not write scene switches unless recording', async () => {
		const writerPort = fakeWriterPort();
		const session = new CaptureSession('capture-test', callbacks(), writerPort);

		session.appendSceneSwitch('scene-1', 1_000);
		expect(writerPort.postMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: 'write-scene-switch' })
		);

		await session.start(2);
		session.appendSceneSwitch('scene-1', 2_000);

		expect(writerPort.postMessage).toHaveBeenCalledWith({
			type: 'write-scene-switch',
			sessionId: 'capture-test',
			sceneId: 'scene-1',
			atUs: 2_000
		});
	});

	it('times out when the writer never acknowledges finalization', async () => {
		vi.useFakeTimers();
		const writerPort = fakeWriterPort();
		const session = new CaptureSession('capture-test', callbacks(), writerPort);

		await session.start(2);
		const stopPromise = session.stop();
		const stopExpectation = expect(stopPromise).rejects.toThrow('Timed out waiting 10000ms');
		await vi.advanceTimersByTimeAsync(10_000);

		await stopExpectation;
	});
});

describe('CaptureSession push pipeline (main-frames, B5/T5.5)', () => {
	const videoFrame = (timestampS: number) =>
		createMockVideoFrame({
			timestamp: timestampS,
			duration: null,
			type: 'delta',
			width: 1920,
			height: 1080
		});

	it('routes pushed frames to the trackless source pipeline and closes unknown-source frames', async () => {
		const encodes: number[] = [];
		class StubVideoEncoder {
			constructor(_init: VideoEncoderInit) {}
			get encodeQueueSize(): number {
				return 0;
			}
			configure(_config: VideoEncoderConfig): void {}
			encode(frame: VideoFrame): void {
				encodes.push(frame.timestamp);
			}
			async flush(): Promise<void> {}
			close(): void {}
		}
		vi.stubGlobal('VideoEncoder', StubVideoEncoder);

		const session = new CaptureSession('capture-test', callbacks());
		// track: null ⇒ trackless push pipeline.
		session.addSource('s1', 'screen', 'Screen', null, {
			codec: 'avc1.42001E',
			width: 1920,
			height: 1080,
			bitrate: 5_000_000
		});
		await session.start(2);

		const frame = videoFrame(0.5);
		session.pushFrame('s1', frame);
		expect(encodes).toEqual([500_000]);
		expect(getCloseCount(frame)).toBe(1);

		// An unknown source id closes the (transferred) frame here so it never leaks.
		const stray = videoFrame(1);
		session.pushFrame('unknown', stray);
		expect(getCloseCount(stray)).toBe(1);
		expect(encodes).toHaveLength(1);

		session.reset();
		vi.unstubAllGlobals();
	});
});
