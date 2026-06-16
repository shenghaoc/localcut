import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { TrackPipeline, type TrackPipelineCallbacks } from './track-pipeline';
import {
	createMockAudioData,
	createMockMSTPReader,
	createMockVideoFrame,
	getCloseCount,
	type ScriptedAudioData,
	type ScriptedVideoFrame
} from './capture-fixtures';

/** Reader handed to the next StubProcessor instance. */
let nextReader: ReadableStreamDefaultReader<VideoFrame | AudioData> | null = null;

class StubProcessor {
	readable: { getReader(): ReadableStreamDefaultReader<VideoFrame | AudioData> };
	constructor(_opts: { track: MediaStreamTrack }) {
		const reader = nextReader;
		if (!reader) throw new Error('test forgot to set nextReader');
		this.readable = { getReader: () => reader };
	}
}

interface EncodeCall {
	timestamp: number;
	keyFrame: boolean;
}

/** Shared mutable state driving the stub encoders, reset per test. */
const encoderState = {
	queueSize: 0,
	videoEncodes: [] as EncodeCall[],
	audioEncodes: 0,
	flushed: false,
	closed: false
};

class StubVideoEncoder {
	constructor(_init: VideoEncoderInit) {}
	get encodeQueueSize(): number {
		return encoderState.queueSize;
	}
	configure(_config: VideoEncoderConfig): void {}
	encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions): void {
		encoderState.videoEncodes.push({
			timestamp: frame.timestamp,
			keyFrame: options?.keyFrame === true
		});
	}
	async flush(): Promise<void> {
		encoderState.flushed = true;
	}
	close(): void {
		encoderState.closed = true;
	}
}

class StubAudioEncoder {
	constructor(_init: AudioEncoderInit) {}
	get encodeQueueSize(): number {
		return encoderState.queueSize;
	}
	configure(_config: AudioEncoderConfig): void {}
	encode(_data: AudioData): void {
		encoderState.audioEncodes++;
	}
	async flush(): Promise<void> {
		encoderState.flushed = true;
	}
	close(): void {
		encoderState.closed = true;
	}
}

function stubGlobals(): void {
	vi.stubGlobal('MediaStreamTrackProcessor', StubProcessor);
	vi.stubGlobal('VideoEncoder', StubVideoEncoder);
	vi.stubGlobal('AudioEncoder', StubAudioEncoder);
	encoderState.queueSize = 0;
	encoderState.videoEncodes = [];
	encoderState.audioEncodes = 0;
	encoderState.flushed = false;
	encoderState.closed = false;
}

afterEach(() => {
	vi.unstubAllGlobals();
	nextReader = null;
});

const fakeTrack = (): MediaStreamTrack => ({ stop: () => {} }) as unknown as MediaStreamTrack;

interface PipelineHarness {
	pipeline: TrackPipeline;
	ended: Promise<void>;
	overruns: string[];
	errors: string[];
}

function buildPipeline(
	kind: 'screen' | 'mic',
	frames: Array<VideoFrame | AudioData>,
	readerOpts?: { delayMs?: number },
	onVideoFrame?: (sourceId: string, frame: VideoFrame) => void
): PipelineHarness {
	stubGlobals();
	nextReader = createMockMSTPReader(frames as VideoFrame[], readerOpts);

	const overruns: string[] = [];
	const errors: string[] = [];
	let resolveEnded: () => void;
	const ended = new Promise<void>((resolve) => {
		resolveEnded = resolve;
	});

	const callbacks: TrackPipelineCallbacks = {
		onEncodedChunk: () => {},
		onChunkAck: () => {},
		onEncodeError: (_id, error) => {
			errors.push(error);
		},
		onAudioOverrun: (id) => {
			overruns.push(id);
		},
		onPipelineEnded: () => {
			resolveEnded();
		}
	};

	const pipeline = new TrackPipeline({
		sourceId: 'src-1',
		kind,
		track: fakeTrack(),
		videoEncodeConfig:
			kind === 'screen'
				? { codec: 'avc1.42001E', width: 1920, height: 1080, bitrate: 5_000_000 }
				: undefined,
		audioEncodeConfig:
			kind === 'mic' ? { codec: 'opus', sampleRate: 48_000, numberOfChannels: 2 } : undefined,
		onVideoFrame,
		callbacks,
		abort: new AbortController()
	});

	return { pipeline, ended, overruns, errors };
}

function vfrFrames(timestampsS: number[]): VideoFrame[] {
	return timestampsS.map((t) =>
		createMockVideoFrame({
			timestamp: t,
			duration: null,
			type: 'delta',
			width: 1920,
			height: 1080
		} satisfies ScriptedVideoFrame)
	);
}

function audioDatas(count: number): AudioData[] {
	return Array.from({ length: count }, (_, i) =>
		createMockAudioData({
			timestamp: i * 0.01,
			duration: 0.01,
			sampleRate: 48_000,
			numberOfFrames: 480,
			numberOfChannels: 2
		} satisfies ScriptedAudioData)
	);
}

describe('TrackPipeline video', () => {
	it('closes every frame exactly once on the happy path and flushes on end', async () => {
		const frames = vfrFrames([0, 0.033, 0.1, 0.5, 0.9]);
		const harness = buildPipeline('screen', frames);

		harness.pipeline.start();
		await harness.ended;

		for (const frame of frames) {
			expect(getCloseCount(frame)).toBe(1);
		}
		expect(encoderState.videoEncodes).toHaveLength(frames.length);
		expect(encoderState.flushed).toBe(true);
		expect(encoderState.closed).toBe(true);
	});

	it('requests key frames on the chunk-duration timestamp cadence, not a frame count', async () => {
		// VFR sequence spanning 4.6 s — keyframes expected at 0 s (first), 2.0 s, and 4.6 s.
		const frames = vfrFrames([0, 0.5, 1.0, 1.5, 2.0, 2.5, 4.6]);
		const harness = buildPipeline('screen', frames);

		harness.pipeline.start(2_000_000);
		await harness.ended;

		const keyTimestamps = encoderState.videoEncodes
			.filter((c) => c.keyFrame)
			.map((c) => c.timestamp);
		expect(keyTimestamps).toEqual([0, 2_000_000, 4_600_000]);
	});

	it('drops frames pre-encode under backpressure, still closing each exactly once', async () => {
		const frames = vfrFrames([0, 0.033, 0.066, 0.1]);
		const harness = buildPipeline('screen', frames);
		harness.pipeline.start();
		encoderState.queueSize = 9; // above VIDEO_QUEUE_BOUND for the whole run

		await harness.ended;

		expect(encoderState.videoEncodes).toHaveLength(0);
		for (const frame of frames) {
			expect(getCloseCount(frame)).toBe(1);
		}
	});

	it('hands cloned frames to the live compose tap before pre-encode drops', async () => {
		const frames = vfrFrames([0, 0.033]);
		const clones = vfrFrames([0, 0.033]);
		frames.forEach((frame, index) => {
			Object.defineProperty(frame, 'clone', {
				value: () => clones[index]!,
				configurable: true
			});
		});
		const received: VideoFrame[] = [];
		const harness = buildPipeline('screen', frames, undefined, (_sourceId, frame) => {
			received.push(frame);
		});

		harness.pipeline.start();
		encoderState.queueSize = 9;
		await harness.ended;

		expect(encoderState.videoEncodes).toHaveLength(0);
		expect(received).toEqual(clones);
		for (const frame of frames) {
			expect(getCloseCount(frame)).toBe(1);
		}
		for (const clone of clones) {
			expect(getCloseCount(clone)).toBe(0);
		}
	});

	it('exits cleanly on stop(): cancels the reader, flushes and closes the encoder', async () => {
		const frames = vfrFrames([0, 0.033, 0.066, 0.1, 0.133, 0.166]);
		const harness = buildPipeline('screen', frames, { delayMs: 2 });

		harness.pipeline.start();
		await harness.pipeline.stop();
		await harness.ended;

		expect(encoderState.flushed).toBe(true);
		expect(encoderState.closed).toBe(true);
		for (const frame of frames) {
			expect(getCloseCount(frame)).toBeLessThanOrEqual(1);
		}
	});

	it('waits for the paused reader to drain before resuming a new run', async () => {
		stubGlobals();
		let resolveRead: ((value: { done: boolean; value?: VideoFrame }) => void) | null = null;
		const firstCancel = vi.fn(() => {
			resolveRead?.({ done: true });
			return Promise.resolve();
		});
		const firstReleaseLock = vi.fn();
		const firstReader = {
			read: vi.fn(
				() =>
					new Promise<{ done: boolean; value?: VideoFrame }>((resolve) => {
						resolveRead = resolve;
					})
			),
			cancel: firstCancel,
			releaseLock: firstReleaseLock
		} as unknown as ReadableStreamDefaultReader<VideoFrame | AudioData>;
		nextReader = firstReader;

		let endedCount = 0;
		const callbacks: TrackPipelineCallbacks = {
			onEncodedChunk: () => {},
			onChunkAck: () => {},
			onEncodeError: () => {},
			onAudioOverrun: () => {},
			onPipelineEnded: () => {
				endedCount++;
			}
		};
		const pipeline = new TrackPipeline({
			sourceId: 'src-1',
			kind: 'screen',
			track: fakeTrack(),
			videoEncodeConfig: { codec: 'avc1.42001E', width: 1920, height: 1080, bitrate: 5_000_000 },
			callbacks,
			abort: new AbortController()
		});

		pipeline.start();
		const pausePromise = pipeline.pause();
		let resolveSecondRead: ((value: { done: boolean; value?: VideoFrame }) => void) | null = null;
		const secondReader = {
			read: vi.fn(
				() =>
					new Promise<{ done: boolean; value?: VideoFrame }>((resolve) => {
						resolveSecondRead = resolve;
					})
			),
			cancel: vi.fn(() => {
				resolveSecondRead?.({ done: true });
				return Promise.resolve();
			}),
			releaseLock: vi.fn()
		} as unknown as ReadableStreamDefaultReader<VideoFrame | AudioData>;
		nextReader = secondReader;
		const resumePromise = pipeline.resume();
		await Promise.all([pausePromise, resumePromise]);

		expect(firstCancel).toHaveBeenCalled();
		expect(firstReleaseLock).toHaveBeenCalled();
		expect(endedCount).toBe(0);
		expect(encoderState.flushed).toBe(true);
		await pipeline.stop();
	});
});

describe('TrackPipeline audio', () => {
	it('closes every AudioData exactly once and never drops below the bound', async () => {
		const datas = audioDatas(6);
		const harness = buildPipeline('mic', datas);

		harness.pipeline.start();
		await harness.ended;

		expect(encoderState.audioEncodes).toBe(datas.length);
		expect(harness.overruns).toHaveLength(0);
		for (const data of datas) {
			expect(getCloseCount(data)).toBe(1);
		}
	});

	it('stops gracefully on sustained overrun without dropping audio silently', async () => {
		const datas = audioDatas(10);
		const harness = buildPipeline('mic', datas);
		harness.pipeline.start();
		encoderState.queueSize = 17; // above AUDIO_QUEUE_BOUND for the whole run

		await harness.ended;

		// Overrun requires 4 consecutive over-bound reads; the first 3 still encode.
		expect(harness.overruns).toEqual(['src-1']);
		expect(encoderState.audioEncodes).toBe(3);
		for (const data of datas.slice(0, 4)) {
			expect(getCloseCount(data)).toBe(1);
		}
		// Data never read from the stream is never touched.
		for (const data of datas.slice(4)) {
			expect(getCloseCount(data)).toBe(0);
		}
	});
});
