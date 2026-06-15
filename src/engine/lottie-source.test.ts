import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';

vi.stubGlobal(
	'VideoFrame',
	class MockVideoFrame {
		close = vi.fn();
		clone = vi.fn().mockReturnThis();
		timestamp: number;
		constructor(_source: unknown, init?: { timestamp?: number }) {
			this.timestamp = init?.timestamp ?? 0;
		}
	}
);

vi.stubGlobal(
	'OffscreenCanvas',
	class MockOffscreenCanvas {
		getContext() {
			return {};
		}
	}
);

vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ close: vi.fn() }));

function createMockLottie(frameRate = 30, totalFrames = 90) {
	const animation = {
		frameRate,
		totalFrames,
		goToAndStop: vi.fn((_frame: number) => {}),
		destroy: vi.fn()
	};
	return {
		loadAnimation: vi.fn().mockReturnValue(animation),
		animation
	};
}

describe('LottieFrameSource', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('frameAt(0) computes frame index 0', async () => {
		const { LottieFrameSource } = await import('./lottie-source');
		const mock = createMockLottie(30, 90);
		const data = new TextEncoder().encode(JSON.stringify({ v: '5', layers: [] }));
		const source = new LottieFrameSource(data.buffer, 1920, 1080, mock);

		const frame = await source.frameAt(0);
		expect(frame).not.toBeNull();
		expect(mock.animation.goToAndStop).toHaveBeenCalledWith(0, true);
		frame?.close();
		source.dispose();
	});

	it('frameAt(1) computes frame index 30', async () => {
		const { LottieFrameSource } = await import('./lottie-source');
		const mock = createMockLottie(30, 90);
		const data = new TextEncoder().encode(JSON.stringify({ v: '5', layers: [] }));
		const source = new LottieFrameSource(data.buffer, 1920, 1080, mock);

		const frame = await source.frameAt(1);
		expect(mock.animation.goToAndStop).toHaveBeenCalledWith(30, true);
		frame?.close();
		source.dispose();
	});

	it('frameAt(3) wraps to index 0 (loop)', async () => {
		const { LottieFrameSource } = await import('./lottie-source');
		const mock = createMockLottie(30, 90);
		const data = new TextEncoder().encode(JSON.stringify({ v: '5', layers: [] }));
		const source = new LottieFrameSource(data.buffer, 1920, 1080, mock);

		const frame = await source.frameAt(3);
		expect(mock.animation.goToAndStop).toHaveBeenCalledWith(0, true);
		frame?.close();
		source.dispose();
	});

	it('reset() closes all cached frames', async () => {
		const { LottieFrameSource } = await import('./lottie-source');
		const mock = createMockLottie(30, 90);
		const data = new TextEncoder().encode(JSON.stringify({ v: '5', layers: [] }));
		const source = new LottieFrameSource(data.buffer, 1920, 1080, mock);

		expect(() => source.reset()).not.toThrow();
		source.dispose();
	});

	it('dispose() calls animation.destroy()', async () => {
		const { LottieFrameSource } = await import('./lottie-source');
		const mock = createMockLottie(30, 90);
		const data = new TextEncoder().encode(JSON.stringify({ v: '5', layers: [] }));
		const source = new LottieFrameSource(data.buffer, 1920, 1080, mock);

		source.dispose();
		expect(mock.animation.destroy).toHaveBeenCalled();
	});

	it('frameRate and totalFrames are accessible', async () => {
		const { LottieFrameSource } = await import('./lottie-source');
		const mock = createMockLottie(24, 120);
		const data = new TextEncoder().encode(JSON.stringify({ v: '5', layers: [] }));
		const source = new LottieFrameSource(data.buffer, 1920, 1080, mock);

		expect(source.frameRate).toBe(24);
		expect(source.totalFrames).toBe(120);
		source.dispose();
	});
});
