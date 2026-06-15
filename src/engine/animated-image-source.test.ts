import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';

function createMockFrame(durationUs = 33333) {
	return {
		duration: durationUs,
		close: vi.fn(),
		clone: vi.fn().mockReturnThis()
	};
}

function createMockDecoder(frameCount = 3, frameDurationUs = 33333) {
	const frames = Array.from({ length: frameCount }, () => createMockFrame(frameDurationUs));
	return {
		tracks: [{ frameCount, repetitionCount: 0 }],
		decode: vi.fn().mockImplementation(async ({ frameIndex }: { frameIndex: number }) => ({
			image: frames[frameIndex % frameCount]
		})),
		close: vi.fn()
	};
}

const sharedDecoder = createMockDecoder();

vi.stubGlobal(
	'ImageDecoder',
	class MockImageDecoder {
		tracks = sharedDecoder.tracks;
		decode = sharedDecoder.decode;
		close = sharedDecoder.close;
		constructor() {
			return sharedDecoder;
		}
	}
);

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

describe('AnimatedImageFrameSource', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('frameAt(0) returns frame 0', async () => {
		const { AnimatedImageFrameSource } = await import('./animated-image-source');
		const stream = new ReadableStream();
		const source = new AnimatedImageFrameSource(stream, 'image/gif');
		const frame = await source.frameAt(0);
		expect(frame).not.toBeNull();
		frame?.close();
		source.dispose();
	});

	it('effectiveFps falls back to 25 when no frames', async () => {
		const { AnimatedImageFrameSource } = await import('./animated-image-source');
		const stream = new ReadableStream();
		const source = new AnimatedImageFrameSource(stream, 'image/gif');
		expect(source.effectiveFps).toBe(25);
		source.dispose();
	});

	it('reset() clears internal state', async () => {
		const { AnimatedImageFrameSource } = await import('./animated-image-source');
		const stream = new ReadableStream();
		const source = new AnimatedImageFrameSource(stream, 'image/gif');
		expect(() => source.reset()).not.toThrow();
		source.dispose();
	});

	it('dispose() closes the decoder', async () => {
		const { AnimatedImageFrameSource } = await import('./animated-image-source');
		const stream = new ReadableStream();
		const source = new AnimatedImageFrameSource(stream, 'image/gif');
		expect(() => source.dispose()).not.toThrow();
	});
});
