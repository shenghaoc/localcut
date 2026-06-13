/* eslint-disable typescript/unbound-method -- vi.fn() mock accessors are unbound by design */
import { describe, expect, it, vi } from 'vite-plus/test';
import {
	AdaptiveResolution,
	buildPreviewLadder,
	clampTime,
	frameStepTarget,
	PlaybackController,
	type DecodedFrame,
	type DecodedLayer
} from './playback';

function mockFrame(): DecodedFrame {
	const videoFrame = { close: vi.fn() } as unknown as VideoFrame;
	return {
		toVideoFrame: () => videoFrame,
		close: vi.fn()
	};
}

describe('clampTime', () => {
	it('clamps into [0, duration]', () => {
		expect(clampTime(-5, 10)).toBe(0);
		expect(clampTime(5, 10)).toBe(5);
		expect(clampTime(15, 10)).toBe(10);
	});

	it('treats non-finite times as 0', () => {
		expect(clampTime(NaN, 10)).toBe(0);
		expect(clampTime(Infinity, 10)).toBe(10);
	});

	it('clamps to 0 when duration is unknown', () => {
		expect(clampTime(5, 0)).toBe(0);
		expect(clampTime(5, -1)).toBe(0);
	});
});

describe('frameStepTarget', () => {
	it('steps forward and back by one frame period', () => {
		expect(frameStepTarget(1, 1, 30, 10)).toBeCloseTo(1 + 1 / 30, 6);
		expect(frameStepTarget(1, -1, 30, 10)).toBeCloseTo(1 - 1 / 30, 6);
	});

	it('clamps at the ends', () => {
		expect(frameStepTarget(0, -1, 30, 10)).toBe(0);
		expect(frameStepTarget(10, 1, 30, 10)).toBe(10);
	});

	it('falls back to 30fps for invalid frame rates', () => {
		expect(frameStepTarget(1, 1, 0, 10)).toBeCloseTo(1 + 1 / 30, 6);
	});
});

describe('buildPreviewLadder', () => {
	it('caps preview at 1080p for a 4K source', () => {
		const ladder = buildPreviewLadder(3840, 2160);
		expect(ladder.map((t) => t.label)).toEqual(['1080p', '720p', '540p']);
		expect(ladder[0]).toMatchObject({ width: 1920, height: 1080 });
	});

	it('never upscales above the source', () => {
		const ladder = buildPreviewLadder(1280, 720);
		expect(ladder.map((t) => t.label)).toEqual(['720p', '540p']);
	});

	it('returns the source itself when below the ladder', () => {
		const ladder = buildPreviewLadder(640, 480);
		expect(ladder).toHaveLength(1);
		expect(ladder[0]).toMatchObject({ width: 640, height: 480 });
	});

	it('produces even dimensions', () => {
		const ladder = buildPreviewLadder(1919, 1079);
		for (const tier of ladder) {
			expect(tier.width % 2).toBe(0);
			expect(tier.height % 2).toBe(0);
		}
	});

	it('falls back to 720p for an unknown source size', () => {
		expect(buildPreviewLadder(0, 0)).toEqual([{ width: 1280, height: 720, label: '720p' }]);
	});
});

describe('AdaptiveResolution', () => {
	const tiers = [
		{ width: 1920, height: 1080, label: '1080p' },
		{ width: 1280, height: 720, label: '720p' },
		{ width: 960, height: 540, label: '540p' }
	];

	it('downgrades after a sustained slow streak', () => {
		const adaptive = new AdaptiveResolution(tiers, 33, 4);
		expect(adaptive.record(50)).toBeNull();
		expect(adaptive.record(50)).toBeNull();
		expect(adaptive.record(50)).toBeNull();
		expect(adaptive.record(50)).toMatchObject({ label: '720p' });
		expect(adaptive.current().label).toBe('720p');
	});

	it('does not downgrade on transient spikes', () => {
		const adaptive = new AdaptiveResolution(tiers, 33, 4);
		adaptive.record(50);
		adaptive.record(10); // fast frame relaxes the streak
		adaptive.record(50);
		adaptive.record(50);
		expect(adaptive.current().label).toBe('1080p');
	});

	it('never drops below the lowest tier', () => {
		const adaptive = new AdaptiveResolution(tiers, 33, 1);
		adaptive.record(100); // -> 720p
		adaptive.record(100); // -> 540p
		expect(adaptive.record(100)).toBeNull();
		expect(adaptive.current().label).toBe('540p');
	});
});

describe('PlaybackController', () => {
	it('drops a stale decode when generation changes during getFrames', async () => {
		const pending: Array<(layers: DecodedLayer[] | null) => void> = [];
		const frame = mockFrame();
		const writeClock = vi.fn();
		const renderFrames = vi.fn();

		const controller = new PlaybackController({
			duration: 10,
			frameRate: 30,
			getFrames: (): Promise<DecodedLayer[] | null> =>
				new Promise((resolve) => {
					pending.push(resolve);
				}),
			renderFrames,
			writeClock
		});

		controller.seek(1);
		await Promise.resolve();
		expect(pending).toHaveLength(1);

		controller.seek(5);
		pending[0]!([{ decoded: frame, meta: undefined }]);
		await Promise.resolve();

		expect(frame.close).toHaveBeenCalledOnce();
		expect(renderFrames).not.toHaveBeenCalled();
	});

	it('pauses and reports when renderAt rejects during playback', async () => {
		const writeClock = vi.fn();
		const onPlaybackError = vi.fn();
		const now = 0;
		const scheduled: Array<() => void> = [];

		const controller = new PlaybackController({
			duration: 10,
			frameRate: 30,
			getFrames: () => Promise.reject(new Error('decode failed')),
			renderFrames: vi.fn(),
			writeClock,
			onPlaybackError,
			now: () => now,
			scheduler: (cb) => {
				scheduled.push(cb);
				return setTimeout(cb, 0) as ReturnType<typeof setTimeout>;
			},
			clearScheduler: (h) => clearTimeout(h)
		});

		controller.play();
		expect(scheduled).toHaveLength(1);
		scheduled[0]!();
		await vi.waitFor(() => expect(onPlaybackError).toHaveBeenCalled());

		expect(controller.isPlaying()).toBe(false);
		expect(onPlaybackError).toHaveBeenCalledOnce();
		expect(writeClock).toHaveBeenCalledWith(expect.any(Number), false);
	});

	it('routes a paused-seek decode failure to onPlaybackError', async () => {
		const onPlaybackError = vi.fn();
		const controller = new PlaybackController({
			duration: 10,
			frameRate: 30,
			getFrames: () => Promise.reject(new Error('seek decode failed')),
			renderFrames: vi.fn(),
			writeClock: vi.fn(),
			onPlaybackError
		});

		controller.seek(3);
		await vi.waitFor(() => expect(onPlaybackError).toHaveBeenCalledOnce());
	});

	it('renders and closes both frames on a successful tick', async () => {
		const frame = mockFrame();
		const videoFrame = frame.toVideoFrame() as unknown as { close: ReturnType<typeof vi.fn> };
		const renderFrames = vi.fn();
		const scheduled: Array<() => void> = [];

		const controller = new PlaybackController({
			duration: 10,
			frameRate: 30,
			getFrames: () => Promise.resolve([{ decoded: frame, meta: undefined }]),
			renderFrames,
			writeClock: vi.fn(),
			now: () => 0,
			scheduler: (cb) => {
				scheduled.push(cb);
				return 0 as ReturnType<typeof setTimeout>;
			},
			clearScheduler: vi.fn()
		});

		controller.play();
		scheduled[0]!(); // run one tick
		await vi.waitFor(() => expect(renderFrames).toHaveBeenCalledOnce());
		expect(renderFrames).toHaveBeenCalledWith(
			[{ frame: videoFrame, meta: undefined }],
			expect.any(Number)
		);

		// The DecodedFrame and the derived VideoFrame are both closed exactly once.
		expect(frame.close as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
		expect(videoFrame.close).toHaveBeenCalledOnce();
	});

	it('refresh() is a no-op when transport is playing', async () => {
		const frame = mockFrame();
		const renderFrames = vi.fn();
		const scheduled: Array<() => void> = [];

		const controller = new PlaybackController({
			duration: 10,
			frameRate: 30,
			getFrames: () => Promise.resolve([{ decoded: frame, meta: undefined }]),
			renderFrames,
			writeClock: vi.fn(),
			now: () => 0,
			scheduler: (cb) => {
				scheduled.push(cb);
				return 0 as ReturnType<typeof setTimeout>;
			},
			clearScheduler: vi.fn()
		});

		controller.play();
		scheduled[0]!();
		await vi.waitFor(() => expect(renderFrames).toHaveBeenCalledOnce());

		const callsBeforeRefresh = scheduled.length;
		const renderCallsBefore = renderFrames.mock.calls.length;
		controller.refresh();
		expect(scheduled.length).toBe(callsBeforeRefresh);
		expect(renderFrames.mock.calls.length).toBe(renderCallsBefore);
		expect(controller.isPlaying()).toBe(true);
	});
});
