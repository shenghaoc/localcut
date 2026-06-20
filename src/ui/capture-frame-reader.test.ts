import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { startCaptureFrameReader } from './capture-frame-reader';

/** Reader handed to the next StubProcessor instance. */
let nextReader: {
	read: () => Promise<{ done: boolean; value?: unknown }>;
	cancel: () => Promise<void>;
	releaseLock: () => void;
};

class StubProcessor {
	readable: { getReader: () => typeof nextReader };
	constructor(_opts: { track: MediaStreamTrack }) {
		this.readable = { getReader: () => nextReader };
	}
}

function stubMSTP(): void {
	vi.stubGlobal('MediaStreamTrackProcessor', StubProcessor);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

const fakeTrack = (): MediaStreamTrack => ({}) as unknown as MediaStreamTrack;

interface MockFrame {
	closeCount: number;
	close: () => void;
}
function mockFrame(): MockFrame {
	const f: MockFrame = {
		closeCount: 0,
		close() {
			f.closeCount++;
		}
	};
	return f;
}

/** Drains all immediately-resolved microtasks in the reader loop. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function scriptedReader(frames: MockFrame[]) {
	let index = 0;
	let cancelled = false;
	return {
		read: async () => {
			if (cancelled || index >= frames.length) return { done: true, value: undefined };
			return { done: false, value: frames[index++] };
		},
		cancel: async () => {
			cancelled = true;
		},
		releaseLock: () => {}
	};
}

describe('startCaptureFrameReader (B5/T5.5)', () => {
	it('forwards each frame to pushFrame and does not close transferred frames', async () => {
		const frames = [mockFrame(), mockFrame(), mockFrame()];
		stubMSTP();
		nextReader = scriptedReader(frames);

		const forwarded: MockFrame[] = [];
		startCaptureFrameReader(fakeTrack(), (frame) => {
			// Simulate a successful transfer: the worker owns + closes it, not the reader.
			forwarded.push(frame as unknown as MockFrame);
		});
		await flush();

		expect(forwarded).toEqual(frames);
		for (const frame of frames) {
			expect(frame.closeCount).toBe(0);
		}
	});

	it('closes the un-transferred frame and surfaces the error when pushFrame throws', async () => {
		const frames = [mockFrame(), mockFrame()];
		stubMSTP();
		nextReader = scriptedReader(frames);

		const errors: unknown[] = [];
		startCaptureFrameReader(
			fakeTrack(),
			() => {
				throw new Error('transfer failed');
			},
			(error) => errors.push(error)
		);
		await flush();

		// First frame: pushFrame throws ⇒ reader closes the still-owned frame + reports
		// the error, then stops (the second frame is never read/forwarded).
		expect(frames[0]!.closeCount).toBe(1);
		expect(errors).toHaveLength(1);
		expect(frames[1]!.closeCount).toBe(0);
	});

	it('routes a synchronous MediaStreamTrackProcessor init failure to onError, not the caller', async () => {
		class ThrowingProcessor {
			constructor() {
				throw new Error('unsupported track');
			}
		}
		vi.stubGlobal('MediaStreamTrackProcessor', ThrowingProcessor);

		const errors: unknown[] = [];
		// Must not throw synchronously — the Record panel's start handler calls this.
		expect(() =>
			startCaptureFrameReader(
				fakeTrack(),
				() => {},
				(error) => errors.push(error)
			)
		).not.toThrow();
		await flush();

		expect(errors).toHaveLength(1);
		expect((errors[0] as Error).message).toBe('unsupported track');
	});

	it('closes a frame that resolves after stop() instead of forwarding it', async () => {
		const frame = mockFrame();
		let resolveRead: ((value: { done: boolean; value?: unknown }) => void) | null = null;
		stubMSTP();
		nextReader = {
			read: () =>
				new Promise<{ done: boolean; value?: unknown }>((resolve) => {
					resolveRead = resolve;
				}),
			cancel: async () => {},
			releaseLock: () => {}
		};

		const forwarded: MockFrame[] = [];
		const reader = startCaptureFrameReader(fakeTrack(), (f) =>
			forwarded.push(f as unknown as MockFrame)
		);
		reader.stop(); // mark stopped before the in-flight read resolves
		resolveRead!({ done: false, value: frame });
		await flush();

		expect(forwarded).toHaveLength(0);
		expect(frame.closeCount).toBe(1);
	});
});
