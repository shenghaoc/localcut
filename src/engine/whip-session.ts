/**
 * Phase 47 (T2/T3): main-thread WHIP session orchestrator. Owns the
 * `RTCPeerConnection` (which does not exist in workers) and the WHIP signaling
 * exchange; all media flows in from the worker tap as tracks. This is
 * control-plane only — a handful of fetches and SDP strings, no per-frame
 * work — so the main thread stays interactive (hard gate 1).
 *
 * Every collaborator is injected (peer-connection factory, fetch, timers) so
 * the full lifecycle unit-tests in Node with fakes.
 */

import type {
	PublishFailureReason,
	PublishSettingsDoc,
	PublishState,
	PublishStats
} from '../protocol';
import {
	createWhipClient,
	WhipRequestError,
	type WhipClient,
	type WhipClientConfig
} from './whip-client';
import {
	createReconnectController,
	type ReconnectController,
	type ReconnectSchedule
} from './whip-reconnect';
import { applyIceRestartAnswer, buildIceRestartFragment } from './whip-sdp';
import { effectiveCodec } from './publish-settings';

export interface WhipSessionTracks {
	video: MediaStreamTrack;
	audio: MediaStreamTrack | null;
}

export interface WhipSessionDeps {
	createPeerConnection(config: RTCConfiguration): RTCPeerConnection;
	createClient?: (config: WhipClientConfig) => WhipClient;
	fetchFn?: typeof fetch;
	schedule?: ReconnectSchedule;
	statsIntervalMs?: number;
	gatherTimeoutMs?: number;
	/** How long an ICE-restart attempt may take before it counts as failed. */
	attemptTimeoutMs?: number;
	now?: () => number;
}

export interface WhipSession {
	readonly state: PublishState;
	onState(listener: (state: PublishState) => void): () => void;
	start(
		settings: PublishSettingsDoc,
		tracks: WhipSessionTracks,
		options?: { av1EncodeSupported?: boolean }
	): Promise<void>;
	/** Issues the DELETE before closing the peer connection (R1.4). */
	stop(): Promise<void>;
}

const defaultSchedule: ReconnectSchedule = {
	set: (callback, ms) => setTimeout(callback, ms),
	clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

/**
 * Orders codec capabilities for `setCodecPreferences` (R2.1/R2.2): the target
 * codec's entries first — for H.264, constrained-baseline (`42e0…`) with
 * packetization-mode 1 ahead of other H.264 profiles — then everything else as
 * negotiation fallback. Exported for unit tests.
 */
export function orderCodecPreferences(
	capabilities: readonly RTCRtpCodec[],
	codec: 'h264' | 'av1'
): RTCRtpCodec[] {
	const targetMime = codec === 'h264' ? 'video/h264' : 'video/av1';
	const isTarget = (entry: RTCRtpCodec) => entry.mimeType.toLowerCase() === targetMime;
	const isConstrainedBaseline = (entry: RTCRtpCodec) => {
		const fmtp = (entry.sdpFmtpLine ?? '').toLowerCase();
		return fmtp.includes('profile-level-id=42e0') && fmtp.includes('packetization-mode=1');
	};
	const preferred = capabilities.filter(isTarget);
	if (codec === 'h264') {
		preferred.sort((a, b) => Number(isConstrainedBaseline(b)) - Number(isConstrainedBaseline(a)));
	}
	return [...preferred, ...capabilities.filter((entry) => !isTarget(entry))];
}

interface OutboundSample {
	timestampMs: number;
	bytesSent: number;
	framesSent: number;
	rttMs: number | null;
}

/** Pulls the outbound-rtp video numbers out of an `RTCStatsReport` (R5.4). */
export function extractOutboundSample(
	report: Iterable<Record<string, unknown>>,
	timestampMs: number
): OutboundSample {
	let bytesSent = 0;
	let framesSent = 0;
	let rttMs: number | null = null;
	for (const entry of report) {
		if (entry.type === 'outbound-rtp' && entry.kind === 'video') {
			if (typeof entry.bytesSent === 'number') bytesSent = entry.bytesSent;
			if (typeof entry.framesSent === 'number') framesSent = entry.framesSent;
		} else if (entry.type === 'candidate-pair' && entry.nominated === true) {
			if (typeof entry.currentRoundTripTime === 'number') {
				rttMs = entry.currentRoundTripTime * 1000;
			}
		}
	}
	return { timestampMs, bytesSent, framesSent, rttMs };
}

export function statsFromSamples(
	previous: OutboundSample | null,
	current: OutboundSample,
	framesDropped: number
): PublishStats {
	let bitrateKbps = 0;
	if (previous) {
		const elapsedMs = current.timestampMs - previous.timestampMs;
		if (elapsedMs > 0) {
			bitrateKbps = Math.max(
				0,
				Math.round(((current.bytesSent - previous.bytesSent) * 8) / elapsedMs)
			);
		}
	}
	return {
		bitrateKbps,
		rttMs: current.rttMs,
		framesSent: current.framesSent,
		framesDropped
	};
}

function failureReasonFor(error: unknown): PublishFailureReason {
	if (error instanceof WhipRequestError) {
		if (error.kind === 'rejected-offer') return 'rejected-offer';
		if (error.kind === 'auth') return 'auth';
		if (error.kind === 'not-found') return 'not-found';
	}
	return 'local-error';
}

export function createWhipSession(deps: WhipSessionDeps): WhipSession {
	const schedule = deps.schedule ?? defaultSchedule;
	const statsIntervalMs = deps.statsIntervalMs ?? 1_000;
	const gatherTimeoutMs = deps.gatherTimeoutMs ?? 2_500;
	const attemptTimeoutMs = deps.attemptTimeoutMs ?? 8_000;
	const now = deps.now ?? (() => Date.now());
	const makeClient = deps.createClient ?? createWhipClient;

	let state: PublishState = { phase: 'idle' };
	const listeners = new Set<(state: PublishState) => void>();

	let pc: RTCPeerConnection | null = null;
	let client: WhipClient | null = null;
	let controller: ReconnectController | null = null;
	let settings: PublishSettingsDoc | null = null;
	let tracks: WhipSessionTracks | null = null;
	let resourceUrl: string | null = null;
	let remoteSdp: string | null = null;
	let statsTimer: unknown = null;
	let attemptTimer: unknown = null;
	let keyframeTimer: unknown = null;
	let videoSender: RTCRtpSender | null = null;
	let lastSample: OutboundSample | null = null;
	let framesDropped = 0;

	function setState(next: PublishState) {
		state = next;
		for (const listener of listeners) listener(next);
	}

	function clearStatsTimer() {
		if (statsTimer !== null) {
			schedule.clear(statsTimer);
			statsTimer = null;
		}
	}

	function clearAttemptTimer() {
		if (attemptTimer !== null) {
			schedule.clear(attemptTimer);
			attemptTimer = null;
		}
	}

	function clearKeyframeTimer() {
		if (keyframeTimer !== null) {
			schedule.clear(keyframeTimer);
			keyframeTimer = null;
		}
	}

	/**
	 * Keyframe-interval enforcement (R2.4): a timer calling
	 * `RTCRtpSender.generateKeyFrame()` directly where the browser supports it.
	 * Without the method the platform encoder's default GOP applies — the UI
	 * labels that state instead of faking the control.
	 */
	function armKeyframeTimer() {
		clearKeyframeTimer();
		if (!settings || !videoSender) return;
		const sender = videoSender as RTCRtpSender & {
			generateKeyFrame?: (rids?: string[]) => Promise<void>;
		};
		if (typeof sender.generateKeyFrame !== 'function') return;
		const intervalMs = settings.keyframeIntervalS * 1_000;
		const tick = () => {
			keyframeTimer = schedule.set(() => {
				keyframeTimer = null;
				if (state.phase !== 'live' || videoSender !== sender) return;
				// Rejections (e.g. sender momentarily inactive) are non-fatal; the
				// next tick tries again.
				void sender.generateKeyFrame?.()?.catch(() => undefined);
				tick();
			}, intervalMs);
		};
		tick();
	}

	function pollStats() {
		statsTimer = schedule.set(() => {
			statsTimer = null;
			if (state.phase !== 'live' || !pc) return;
			pc.getStats()
				.then((report) => {
					if (state.phase !== 'live') return;
					const entries: Record<string, unknown>[] = [];
					report.forEach((entry) => entries.push(entry as unknown as Record<string, unknown>));
					const sample = extractOutboundSample(entries, now());
					setState({ phase: 'live', stats: statsFromSamples(lastSample, sample, framesDropped) });
					lastSample = sample;
					pollStats();
				})
				.catch(() => {
					// getStats can reject while the connection is tearing down or
					// mid-restart; stats are best-effort, so keep polling while live
					// instead of surfacing an unhandled rejection.
					if (state.phase === 'live') pollStats();
				});
		}, statsIntervalMs);
	}

	function goLive() {
		clearAttemptTimer();
		// Covers both recovery shapes: a self-heal during the grace window and a
		// successful reconnect attempt.
		controller?.noticeRecovered();
		controller?.attemptSucceeded();
		if (state.phase === 'live') return;
		setState({
			phase: 'live',
			stats: { bitrateKbps: 0, rttMs: null, framesSent: lastSample?.framesSent ?? 0, framesDropped }
		});
		clearStatsTimer();
		pollStats();
		armKeyframeTimer();
	}

	function fail(reason: PublishFailureReason) {
		controller?.stop();
		clearStatsTimer();
		clearAttemptTimer();
		clearKeyframeTimer();
		// Clean teardown on fatal local errors too (R1.4): DELETE before close.
		if (client && resourceUrl) void client.teardown(resourceUrl);
		pc?.close();
		pc = null;
		setState({ phase: 'failed', reason });
	}

	async function waitForIceGathering(connection: RTCPeerConnection): Promise<void> {
		if (connection.iceGatheringState === 'complete') return;
		await new Promise<void>((resolve) => {
			const timer = schedule.set(() => {
				connection.removeEventListener('icegatheringstatechange', onChange);
				resolve();
			}, gatherTimeoutMs);
			const onChange = () => {
				if (connection.iceGatheringState !== 'complete') return;
				schedule.clear(timer);
				connection.removeEventListener('icegatheringstatechange', onChange);
				resolve();
			};
			connection.addEventListener('icegatheringstatechange', onChange);
		});
	}

	function buildPeerConnection(): RTCPeerConnection {
		if (!settings || !tracks) throw new Error('Session not configured.');
		const connection = deps.createPeerConnection({});
		const videoTransceiver = connection.addTransceiver(tracks.video, { direction: 'sendonly' });
		if (tracks.audio) connection.addTransceiver(tracks.audio, { direction: 'sendonly' });

		const codec = effectiveCodec(settings, settingsAv1Supported);
		const capabilities =
			typeof RTCRtpSender !== 'undefined' && typeof RTCRtpSender.getCapabilities === 'function'
				? RTCRtpSender.getCapabilities('video')
				: null;
		if (capabilities && typeof videoTransceiver.setCodecPreferences === 'function') {
			videoTransceiver.setCodecPreferences(orderCodecPreferences(capabilities.codecs, codec));
		}

		const sender = videoTransceiver.sender;
		const parameters = sender.getParameters();
		const encoding = (parameters.encodings ??= [{}])[0] ?? (parameters.encodings[0] = {});
		encoding.maxBitrate = settings.videoBitrateKbps * 1_000;
		if (settings.maxFps !== null) encoding.maxFramerate = settings.maxFps;
		const trackHeight = tracks.video.getSettings?.().height;
		if (settings.maxHeight !== null && trackHeight && trackHeight > settings.maxHeight) {
			encoding.scaleResolutionDownBy = trackHeight / settings.maxHeight;
		}
		void sender.setParameters(parameters);
		videoSender = sender;

		connection.addEventListener('iceconnectionstatechange', () => {
			if (pc !== connection) return;
			const iceState = connection.iceConnectionState;
			if (iceState === 'connected' || iceState === 'completed') goLive();
			else if (iceState === 'disconnected') controller?.noticeDisconnected();
			else if (iceState === 'failed') controller?.noticeFailed();
		});
		return connection;
	}

	let settingsAv1Supported = false;

	async function connect(): Promise<void> {
		if (!client) throw new Error('Session not configured.');
		pc?.close();
		pc = buildPeerConnection();
		const connection = pc;
		const offer = await connection.createOffer();
		await connection.setLocalDescription(offer);
		// No trickle on the initial offer (R1.6): gather first, bounded by timeout.
		await waitForIceGathering(connection);
		const offerSdp = connection.localDescription?.sdp ?? offer.sdp ?? '';
		const resource = await client.publish(offerSdp);
		resourceUrl = resource.resourceUrl;
		remoteSdp = resource.answerSdp;
		if (resource.iceServers.length > 0 && typeof connection.setConfiguration === 'function') {
			connection.setConfiguration({ iceServers: resource.iceServers });
		}
		await connection.setRemoteDescription({ type: 'answer', sdp: resource.answerSdp });
	}

	function armAttemptTimeout() {
		clearAttemptTimer();
		attemptTimer = schedule.set(() => {
			attemptTimer = null;
			controller?.attemptFailed();
		}, attemptTimeoutMs);
	}

	async function runAttempt(action: 'ice-restart' | 're-post') {
		if (!client || !controller) return;
		try {
			if (action === 'ice-restart' && pc && resourceUrl && remoteSdp) {
				pc.restartIce();
				const offer = await pc.createOffer({ iceRestart: true });
				await pc.setLocalDescription(offer);
				await waitForIceGathering(pc);
				const fragment = buildIceRestartFragment(pc.localDescription?.sdp ?? '');
				let result: Awaited<ReturnType<WhipClient['patchIceRestart']>>;
				try {
					result = await client.patchIceRestart(resourceUrl, fragment);
				} catch (error) {
					// A 404 means the server lost the session (e.g. it restarted) while
					// the endpoint itself is fine — fall back to a full re-POST instead
					// of declaring the publish dead.
					if (error instanceof WhipRequestError && error.kind === 'not-found') {
						controller.attemptPatchUnsupported();
						return;
					}
					throw error;
				}
				if (result.status === 'unsupported') {
					controller.attemptPatchUnsupported();
					return;
				}
				remoteSdp = applyIceRestartAnswer(remoteSdp, result.answerFragment);
				await pc.setRemoteDescription({ type: 'answer', sdp: remoteSdp });
				// Success is the ICE layer reconnecting; bound the wait.
				armAttemptTimeout();
			} else {
				// Full re-POST: a brand-new session. Drop the old resource best-effort.
				if (resourceUrl) void client.teardown(resourceUrl);
				resourceUrl = null;
				await connect();
				armAttemptTimeout();
			}
		} catch (error) {
			if (error instanceof WhipRequestError && error.kind !== 'retryable') {
				fail(failureReasonFor(error));
				return;
			}
			controller.attemptFailed();
		}
	}

	async function stop(): Promise<void> {
		if (state.phase === 'idle' || state.phase === 'ended') return;
		controller?.stop();
		clearStatsTimer();
		clearAttemptTimer();
		clearKeyframeTimer();
		// DELETE first, then close the peer connection (R1.4).
		if (client && resourceUrl) await client.teardown(resourceUrl);
		pc?.close();
		pc = null;
		resourceUrl = null;
		setState({ phase: 'ended' });
	}

	return {
		get state() {
			return state;
		},
		onState(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async start(nextSettings, nextTracks, options = {}) {
			if (state.phase === 'connecting' || state.phase === 'live' || state.phase === 'reconnecting') {
				throw new Error('A publish session is already running.');
			}
			settings = nextSettings;
			tracks = nextTracks;
			settingsAv1Supported = options.av1EncodeSupported === true;
			framesDropped = 0;
			lastSample = null;
			client = makeClient({
				endpointUrl: nextSettings.endpointUrl,
				bearerToken: nextSettings.bearerToken ?? null,
				fetchFn: deps.fetchFn
			});
			controller = createReconnectController({
				schedule,
				onAttempt: (action, attempt) => {
					setState({ phase: 'reconnecting', attempt, nextRetryMs: 0 });
					void runAttempt(action);
				},
				onGiveUp: () => fail('gave-up'),
				onWaiting: (attempt, delayMs) => {
					clearStatsTimer();
					setState({ phase: 'reconnecting', attempt, nextRetryMs: delayMs });
				}
			});
			setState({ phase: 'connecting' });
			try {
				await connect();
			} catch (error) {
				if (error instanceof WhipRequestError && error.kind === 'retryable') {
					// R1.5: retryable initial failures go through the reconnect policy.
					controller.noticeFailed();
					return;
				}
				fail(failureReasonFor(error));
			}
		},
		stop
	};
}
