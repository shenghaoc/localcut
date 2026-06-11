/**
 * Phase 47 (T6/T4.3): main-thread publish controller. Owns the `WhipSession`
 * lifecycle, the encoder-budget lease, and the program-feed tap wiring between
 * the pipeline worker and the peer connection. Control-plane only — frames
 * flow through `MediaStreamTrackGenerator` writers, never through JS pixel
 * loops — so the main thread stays interactive (hard gate 1) and the SAB
 * playback clock is untouched (hard gate 3).
 *
 * Collaborators are injected so the decision logic unit-tests in Node without
 * DOM or WebRTC.
 */

import type {
	CapabilityProbeResult,
	LivePublishProbeResult,
	PublishSettingsDoc,
	PublishState,
	WorkerCommand,
	WorkerStateMessage
} from '../protocol';
import { createWhipSession, type WhipSession } from '../engine/whip-session';
import {
	budgetSessionsForProbe,
	canRecordWhileStreaming,
	createEncoderBudget,
	type EncoderBudget,
	type EncoderLease
} from '../engine/encoder-budget';
import { livePublishAvailable } from '../engine/capability-probe-v2';

export type PublishTapMode = 'worker-track' | 'main-frames';

/**
 * Data-plane mode selection (R4.5): the worker-track mode needs the generator
 * available to the worker AND a transferable `MediaStreamTrack` to hand it out;
 * otherwise the generator runs on main and the worker transfers one
 * `VideoFrame` at a time. (`trackTransfer` is the pure transfer capability —
 * shared with the capture probe group — so the generator is checked here.)
 */
export function selectTapMode(probe: LivePublishProbeResult): PublishTapMode {
	return probe.trackGeneratorWorker === 'supported' && probe.trackTransfer === 'supported'
		? 'worker-track'
		: 'main-frames';
}

// ── Shared encoder budget (R3.2) ──
// One ledger for every hardware-encoder consumer on this page: WHIP publish
// now, ISO recording later. Lazily derived from the probe, never recreated, so
// a future recorder acquires from the same instance.
let sharedEncoderBudget: EncoderBudget | null = null;

export function sharedEncoderBudgetForProbe(probe: LivePublishProbeResult): EncoderBudget {
	if (!sharedEncoderBudget) {
		sharedEncoderBudget = createEncoderBudget(
			budgetSessionsForProbe(probe.hardwareH264Encode === 'supported')
		);
	}
	return sharedEncoderBudget;
}

export interface PublishTapStats {
	framesDelivered: number;
	framesDropped: number;
}

interface CloseableFrame {
	close(): void;
}

export interface BoundedFrameSink<F extends CloseableFrame> {
	push(frame: F): void;
	/** Idempotent; closes the underlying writer. */
	stop(): Promise<void>;
}

/**
 * Main-thread side of the 'main-frames' fallback: feeds transferred
 * `VideoFrame`s into the local generator writer with at most one write in
 * flight. The generator closes frames it consumes; a frame arriving while a
 * write is pending is closed immediately (the worker already bounded the
 * transfer, so dropping here only happens under writer backpressure). Every
 * frame is closed exactly once across write/drop/stop/error.
 */
export function createBoundedFrameSink<F extends CloseableFrame>(
	writer: { write(frame: F): Promise<void>; close(): Promise<void> },
	onError?: (error: unknown) => void
): BoundedFrameSink<F> {
	let writing = false;
	let stopped = false;

	return {
		push(frame) {
			if (stopped || writing) {
				frame.close();
				return;
			}
			writing = true;
			writer.write(frame).then(
				() => {
					writing = false;
				},
				(error) => {
					// Writer contract: a rejected write does not consume the chunk.
					frame.close();
					writing = false;
					stopped = true;
					onError?.(error);
				}
			);
		},
		async stop() {
			if (stopped) return;
			stopped = true;
			try {
				await writer.close();
			} catch {
				// Already errored/closed — stop must not throw.
			}
		}
	};
}

/** `MediaStreamTrackGenerator` is Chromium-only and absent from TS lib.dom. */
export interface VideoTrackGeneratorLike extends MediaStreamTrack {
	readonly writable: WritableStream<VideoFrame>;
}

function defaultCreateTrackGenerator(): VideoTrackGeneratorLike {
	const ctor = (globalThis as unknown as Record<string, unknown>).MediaStreamTrackGenerator as
		| (new (init: { kind: 'video' }) => VideoTrackGeneratorLike)
		| undefined;
	if (typeof ctor !== 'function') {
		throw new Error('MediaStreamTrackGenerator is unavailable in this browser.');
	}
	return new ctor({ kind: 'video' });
}

export interface PublishControllerDeps {
	sendCommand(command: WorkerCommand): void;
	getProbe(): CapabilityProbeResult | null;
	/** Master-bus tap (R4.4); null when the audio engine is not running. */
	getAudioTrack(): MediaStreamTrack | null;
	releaseAudioTrack(): void;
	/** Injectable for tests; defaults to the shared probe-derived budget. */
	budget?: EncoderBudget;
	createSession?(): WhipSession;
	createTrackGenerator?(): VideoTrackGeneratorLike;
	trackWaitTimeoutMs?: number;
}

export interface PublishController {
	readonly state: PublishState;
	/** Human-readable detail for tap/local failures (never includes the token). */
	readonly lastError: string | null;
	readonly tapStats: PublishTapStats | null;
	/** True when the budget could hold a publish lease plus a recorder (R3.3). */
	canRecordWhileStreaming(): boolean;
	onUpdate(listener: () => void): () => void;
	goLive(settings: PublishSettingsDoc): Promise<void>;
	stop(): Promise<void>;
	/** Routes publish tap messages; returns false for unrelated messages. */
	handleWorkerMessage(msg: WorkerStateMessage): boolean;
	dispose(): void;
}

function defaultCreateSession(): WhipSession {
	return createWhipSession({
		createPeerConnection: (config) => new RTCPeerConnection(config)
	});
}

export function createPublishController(deps: PublishControllerDeps): PublishController {
	let state: PublishState = { phase: 'idle' };
	let lastError: string | null = null;
	let tapStats: PublishTapStats | null = null;

	let session: WhipSession | null = null;
	let sessionUnsubscribe: (() => void) | null = null;
	let lease: EncoderLease | null = null;
	let workerTrack: MediaStreamTrack | null = null;
	let mainSink: BoundedFrameSink<VideoFrame> | null = null;
	let mainGeneratorTrack: MediaStreamTrack | null = null;
	let tapStarted = false;
	let starting = false;
	let stopRequested = false;
	let pendingTrackResolve: ((track: MediaStreamTrack) => void) | null = null;
	let pendingTrackReject: ((error: Error) => void) | null = null;

	const listeners = new Set<() => void>();

	function notify() {
		for (const listener of listeners) listener();
	}

	function setState(next: PublishState) {
		state = next;
		notify();
	}

	function setError(message: string) {
		lastError = message;
		notify();
	}

	function rejectPendingTrack(error: Error) {
		const reject = pendingTrackReject;
		pendingTrackResolve = null;
		pendingTrackReject = null;
		reject?.(error);
	}

	function cleanupTap() {
		if (tapStarted) {
			deps.sendCommand({ type: 'publish-tap-stop' });
			tapStarted = false;
		}
		workerTrack?.stop();
		workerTrack = null;
		if (mainSink) {
			void mainSink.stop();
			mainSink = null;
		}
		mainGeneratorTrack?.stop();
		mainGeneratorTrack = null;
		deps.releaseAudioTrack();
	}

	function teardown() {
		sessionUnsubscribe?.();
		sessionUnsubscribe = null;
		session = null;
		cleanupTap();
		lease?.release();
		lease = null;
	}

	function sessionActive(): boolean {
		return state.phase === 'connecting' || state.phase === 'live' || state.phase === 'reconnecting';
	}

	function startVideoTap(probe: LivePublishProbeResult): Promise<MediaStreamTrack> {
		const mode = selectTapMode(probe);
		if (mode === 'worker-track') {
			return new Promise<MediaStreamTrack>((resolve, reject) => {
				const timeout = setTimeout(() => {
					rejectPendingTrack(
						new Error('Timed out waiting for the publish track from the pipeline worker.')
					);
				}, deps.trackWaitTimeoutMs ?? 10_000);
				pendingTrackResolve = (track) => {
					clearTimeout(timeout);
					workerTrack = track;
					resolve(track);
				};
				pendingTrackReject = (error) => {
					clearTimeout(timeout);
					reject(error);
				};
				tapStarted = true;
				deps.sendCommand({ type: 'publish-tap-start', mode });
			});
		}
		const generator = (deps.createTrackGenerator ?? defaultCreateTrackGenerator)();
		mainSink = createBoundedFrameSink<VideoFrame>(generator.writable.getWriter(), (error) =>
			setError(
				`Publish frame sink failed: ${error instanceof Error ? error.message : String(error)}`
			)
		);
		mainGeneratorTrack = generator;
		tapStarted = true;
		deps.sendCommand({ type: 'publish-tap-start', mode });
		return Promise.resolve(generator);
	}

	async function stopForFailure() {
		// A clean stop still issues the WHIP DELETE; the failure state is set after
		// so the panel explains why the session went down.
		try {
			await session?.stop();
		} catch {
			// Best effort — the failure state below is the user-facing outcome.
		}
		teardown();
		setState({ phase: 'failed', reason: 'local-error' });
	}

	const onPageHide = () => {
		// Best-effort teardown (R1.4): the engine DELETE uses keepalive.
		void session?.stop();
	};
	if (typeof window !== 'undefined') {
		window.addEventListener('pagehide', onPageHide);
		window.addEventListener('beforeunload', onPageHide);
	}

	return {
		get state() {
			return state;
		},
		get lastError() {
			return lastError;
		},
		get tapStats() {
			return tapStats;
		},
		canRecordWhileStreaming() {
			const probe = deps.getProbe();
			if (!probe) return false;
			const budget = deps.budget ?? sharedEncoderBudgetForProbe(probe.livePublish);
			return canRecordWhileStreaming(budget);
		},
		onUpdate(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async goLive(settings) {
			if (starting || sessionActive()) return;
			lastError = null;
			tapStats = null;
			stopRequested = false;
			const probe = deps.getProbe();
			if (!probe || !livePublishAvailable(probe.livePublish)) {
				setState({ phase: 'failed', reason: 'unsupported' });
				return;
			}
			// Budget check happens before any tap or peer connection exists (R3.4).
			const budget = deps.budget ?? sharedEncoderBudgetForProbe(probe.livePublish);
			lease = budget.acquire('whip-publish');
			if (!lease) {
				setState({ phase: 'failed', reason: 'budget-exhausted' });
				return;
			}
			starting = true;
			setState({ phase: 'connecting' });
			try {
				const video = await startVideoTap(probe.livePublish);
				const audio = deps.getAudioTrack();
				const nextSession = (deps.createSession ?? defaultCreateSession)();
				session = nextSession;
				sessionUnsubscribe = nextSession.onState((next) => {
					setState(next);
					if (next.phase === 'ended' || next.phase === 'failed') teardown();
				});
				await nextSession.start(
					settings,
					{ video, audio },
					{
						av1EncodeSupported: probe.codecs.av1Encode === 'supported'
					}
				);
			} catch (error) {
				lastError = error instanceof Error ? error.message : String(error);
				teardown();
				setState(stopRequested ? { phase: 'ended' } : { phase: 'failed', reason: 'local-error' });
			} finally {
				starting = false;
			}
		},
		async stop() {
			stopRequested = true;
			if (pendingTrackReject) {
				rejectPendingTrack(new Error('Publish canceled.'));
				return;
			}
			const active = session;
			if (active) {
				// The session's 'ended' transition drives teardown via the listener.
				await active.stop();
				return;
			}
			cleanupTap();
			lease?.release();
			lease = null;
			if (state.phase !== 'idle') setState({ phase: 'ended' });
		},
		handleWorkerMessage(msg) {
			switch (msg.type) {
				case 'publish-tap-track': {
					const resolve = pendingTrackResolve;
					pendingTrackResolve = null;
					pendingTrackReject = null;
					if (resolve) resolve(msg.track);
					else msg.track.stop();
					return true;
				}
				case 'publish-tap-frame':
					if (mainSink) mainSink.push(msg.frame);
					else msg.frame.close();
					return true;
				case 'publish-tap-stats':
					tapStats = { framesDelivered: msg.framesDelivered, framesDropped: msg.framesDropped };
					notify();
					return true;
				case 'publish-tap-error':
					lastError = msg.message;
					if (pendingTrackReject) {
						rejectPendingTrack(new Error(msg.message));
					} else if (sessionActive()) {
						void stopForFailure();
					}
					notify();
					return true;
				default:
					return false;
			}
		},
		dispose() {
			if (typeof window !== 'undefined') {
				window.removeEventListener('pagehide', onPageHide);
				window.removeEventListener('beforeunload', onPageHide);
			}
			void session?.stop();
			teardown();
			listeners.clear();
		}
	};
}
