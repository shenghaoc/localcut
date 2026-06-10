import { describe, expect, it, vi } from 'vitest';
import {
	createBoundedFrameSink,
	createPublishController,
	selectTapMode,
	type VideoTrackGeneratorLike
} from './publish-controller';
import { createEncoderBudget } from '../engine/encoder-budget';
import { defaultPublishSettings } from '../engine/publish-settings';
import type { WhipSession } from '../engine/whip-session';
import type {
	CapabilityProbeResult,
	LivePublishProbeResult,
	PublishState,
	WorkerCommand,
	WorkerStateMessage
} from '../protocol';

function livePublishProbe(overrides: Partial<LivePublishProbeResult> = {}): LivePublishProbeResult {
	return {
		rtcPeerConnection: 'supported',
		trackGeneratorWorker: 'supported',
		trackTransfer: 'supported',
		generateKeyFrame: 'supported',
		hardwareH264Encode: 'supported',
		...overrides
	};
}

function probeResult(
	livePublish: LivePublishProbeResult,
	av1Encode: 'supported' | 'unsupported' = 'unsupported'
): CapabilityProbeResult {
	// Only the fields the controller reads are populated; the rest of the probe
	// shape is irrelevant to these tests.
	return {
		codecs: { av1Encode },
		livePublish
	} as unknown as CapabilityProbeResult;
}

interface FakeSession extends WhipSession {
	emit(state: PublishState): void;
	startCalls: Array<{
		tracks: { video: MediaStreamTrack; audio: MediaStreamTrack | null };
		av1: boolean | undefined;
	}>;
	stopCalls: number;
}

function createFakeSession(): FakeSession {
	let state: PublishState = { phase: 'idle' };
	const listeners = new Set<(next: PublishState) => void>();
	const emit = (next: PublishState) => {
		state = next;
		for (const listener of listeners) listener(next);
	};
	const session: FakeSession = {
		get state() {
			return state;
		},
		onState(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async start(_settings, tracks, options) {
			session.startCalls.push({ tracks, av1: options?.av1EncodeSupported });
		},
		async stop() {
			session.stopCalls += 1;
			emit({ phase: 'ended' });
		},
		emit,
		startCalls: [],
		stopCalls: 0
	};
	return session;
}

function fakeTrack(): MediaStreamTrack {
	return { stop: vi.fn() } as unknown as MediaStreamTrack;
}

function fakeFrame(): VideoFrame & { close: ReturnType<typeof vi.fn> } {
	return { close: vi.fn() } as unknown as VideoFrame & { close: ReturnType<typeof vi.fn> };
}

interface ControllerHarness {
	commands: WorkerCommand[];
	session: FakeSession;
	releaseAudioTrack: ReturnType<typeof vi.fn>;
	audioTrack: MediaStreamTrack;
}

function harness(
	probe: CapabilityProbeResult,
	options: {
		budgetSize?: number;
		generator?: VideoTrackGeneratorLike;
	} = {}
) {
	const commands: WorkerCommand[] = [];
	const session = createFakeSession();
	const audioTrack = fakeTrack();
	const releaseAudioTrack = vi.fn();
	const budget = createEncoderBudget(options.budgetSize ?? 1);
	const controller = createPublishController({
		sendCommand: (command) => commands.push(command),
		getProbe: () => probe,
		getAudioTrack: () => audioTrack,
		releaseAudioTrack,
		budget,
		createSession: () => session,
		createTrackGenerator: options.generator ? () => options.generator! : undefined,
		trackWaitTimeoutMs: 50
	});
	const ctx: ControllerHarness = { commands, session, releaseAudioTrack, audioTrack };
	return { controller, budget, ...ctx };
}

describe('selectTapMode', () => {
	it('prefers the worker-side generator when tracks transfer', () => {
		expect(selectTapMode(livePublishProbe())).toBe('worker-track');
	});

	it('falls back to main-frames without transferable tracks', () => {
		expect(selectTapMode(livePublishProbe({ trackTransfer: 'unsupported' }))).toBe('main-frames');
		expect(selectTapMode(livePublishProbe({ trackTransfer: 'unknown' }))).toBe('main-frames');
	});
});

describe('createBoundedFrameSink', () => {
	it('keeps at most one write in flight and closes frames arriving meanwhile', async () => {
		let resolveWrite: (() => void) | null = null;
		const writes: unknown[] = [];
		const sink = createBoundedFrameSink<{ close(): void }>({
			write(frame) {
				writes.push(frame);
				return new Promise<void>((resolve) => {
					resolveWrite = resolve;
				});
			},
			close: () => Promise.resolve()
		});
		const first = fakeFrame();
		const second = fakeFrame();
		sink.push(first);
		sink.push(second);
		expect(writes).toEqual([first]);
		// The frame that arrived during the pending write is closed, not queued.
		expect(second.close).toHaveBeenCalledTimes(1);
		expect(first.close).not.toHaveBeenCalled();
		resolveWrite!();
		await Promise.resolve();
		const third = fakeFrame();
		sink.push(third);
		expect(writes).toEqual([first, third]);
	});

	it('closes the frame and reports the error when a write rejects', async () => {
		const onError = vi.fn();
		const sink = createBoundedFrameSink<{ close(): void }>(
			{
				write: () => Promise.reject(new Error('writer gone')),
				close: () => Promise.resolve()
			},
			onError
		);
		const frame = fakeFrame();
		sink.push(frame);
		await Promise.resolve();
		await Promise.resolve();
		expect(frame.close).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledTimes(1);
		// Errored sinks close everything that arrives afterwards.
		const late = fakeFrame();
		sink.push(late);
		expect(late.close).toHaveBeenCalledTimes(1);
	});

	it('closes frames pushed after stop and closes the writer once', async () => {
		const close = vi.fn(() => Promise.resolve());
		const sink = createBoundedFrameSink<{ close(): void }>({
			write: () => Promise.resolve(),
			close
		});
		await sink.stop();
		await sink.stop();
		expect(close).toHaveBeenCalledTimes(1);
		const frame = fakeFrame();
		sink.push(frame);
		expect(frame.close).toHaveBeenCalledTimes(1);
	});
});

describe('createPublishController', () => {
	it('blocks go-live with budget-exhausted before any tap or session exists', async () => {
		const { controller, budget, commands, session } = harness(probeResult(livePublishProbe()));
		const blocker = budget.acquire('export');
		expect(blocker).not.toBeNull();
		await controller.goLive(defaultPublishSettings());
		expect(controller.state).toEqual({ phase: 'failed', reason: 'budget-exhausted' });
		expect(commands).toEqual([]);
		expect(session.startCalls).toEqual([]);
	});

	it('fails with unsupported when required probes are missing', async () => {
		const { controller, commands } = harness(
			probeResult(livePublishProbe({ rtcPeerConnection: 'unsupported' }))
		);
		await controller.goLive(defaultPublishSettings());
		expect(controller.state).toEqual({ phase: 'failed', reason: 'unsupported' });
		expect(commands).toEqual([]);
	});

	it('runs the worker-track mode end to end and releases the lease at stop', async () => {
		const { controller, budget, commands, session, releaseAudioTrack, audioTrack } = harness(
			probeResult(livePublishProbe())
		);
		const settings = defaultPublishSettings();
		const live = controller.goLive(settings);
		expect(commands).toEqual([{ type: 'publish-tap-start', mode: 'worker-track' }]);
		expect(budget.available()).toBe(0);

		const track = fakeTrack();
		const handled = controller.handleWorkerMessage({
			type: 'publish-tap-track',
			track
		} as WorkerStateMessage);
		expect(handled).toBe(true);
		await live;

		expect(session.startCalls).toHaveLength(1);
		expect(session.startCalls[0]!.tracks.video).toBe(track);
		expect(session.startCalls[0]!.tracks.audio).toBe(audioTrack);
		expect(session.startCalls[0]!.av1).toBe(false);

		session.emit({
			phase: 'live',
			stats: { bitrateKbps: 0, rttMs: null, framesSent: 0, framesDropped: 0 }
		});
		expect(controller.state.phase).toBe('live');

		await controller.stop();
		expect(session.stopCalls).toBe(1);
		expect(controller.state).toEqual({ phase: 'ended' });
		expect(commands).toContainEqual({ type: 'publish-tap-stop' });
		expect(budget.available()).toBe(1);
		expect(releaseAudioTrack).toHaveBeenCalled();
	});

	it('uses the main-frames fallback generator and routes transferred frames into it', async () => {
		const written: unknown[] = [];
		const generator = {
			writable: {
				getWriter: () => ({
					write(frame: unknown) {
						written.push(frame);
						return Promise.resolve();
					},
					close: () => Promise.resolve()
				})
			},
			stop: vi.fn()
		} as unknown as VideoTrackGeneratorLike;
		const { controller, commands, session } = harness(
			probeResult(livePublishProbe({ trackTransfer: 'unsupported' })),
			{ generator }
		);
		await controller.goLive(defaultPublishSettings());
		expect(commands).toEqual([{ type: 'publish-tap-start', mode: 'main-frames' }]);
		expect(session.startCalls[0]!.tracks.video).toBe(generator);

		const frame = fakeFrame();
		controller.handleWorkerMessage({ type: 'publish-tap-frame', frame } as WorkerStateMessage);
		expect(written).toEqual([frame]);
	});

	it('closes transferred frames when no sink is active', () => {
		const { controller } = harness(probeResult(livePublishProbe()));
		const frame = fakeFrame();
		controller.handleWorkerMessage({ type: 'publish-tap-frame', frame } as WorkerStateMessage);
		expect(frame.close).toHaveBeenCalledTimes(1);
	});

	it('fails go-live and releases the lease on a tap error before the track arrives', async () => {
		const { controller, budget, commands } = harness(probeResult(livePublishProbe()));
		const live = controller.goLive(defaultPublishSettings());
		controller.handleWorkerMessage({
			type: 'publish-tap-error',
			message: 'generator exploded'
		} as WorkerStateMessage);
		await live;
		expect(controller.state).toEqual({ phase: 'failed', reason: 'local-error' });
		expect(controller.lastError).toBe('generator exploded');
		expect(budget.available()).toBe(1);
		expect(commands).toContainEqual({ type: 'publish-tap-stop' });
	});

	it('surfaces tap stats updates', () => {
		const { controller } = harness(probeResult(livePublishProbe()));
		const updates = vi.fn();
		controller.onUpdate(updates);
		controller.handleWorkerMessage({
			type: 'publish-tap-stats',
			framesDelivered: 120,
			framesDropped: 3
		} as WorkerStateMessage);
		expect(controller.tapStats).toEqual({ framesDelivered: 120, framesDropped: 3 });
		expect(updates).toHaveBeenCalled();
	});

	it('ignores unrelated worker messages', () => {
		const { controller } = harness(probeResult(livePublishProbe()));
		expect(controller.handleWorkerMessage({ type: 'dispose-complete' } as WorkerStateMessage)).toBe(
			false
		);
	});
});
