import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { CaptureSession } from './capture-session';

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
