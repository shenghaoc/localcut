/* eslint-disable typescript/unbound-method -- vi.fn() mock accessors are unbound by design */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { PublishSettingsDoc, PublishState } from '../protocol';
import { defaultPublishSettings } from './publish-settings';
import { type WhipClient, WhipRequestError } from './whip-client';
import {
	createWhipSession,
	extractOutboundSample,
	orderCodecPreferences,
	statsFromSamples,
	type WhipSessionTracks
} from './whip-session';

const LOCAL_SDP = [
	'v=0',
	'a=ice-ufrag:localU',
	'a=ice-pwd:localP',
	'm=video 9 UDP/TLS/RTP/SAVPF 96',
	'a=mid:0',
	'a=candidate:1 1 udp 1 192.0.2.1 5000 typ host'
].join('\r\n');

const ANSWER_SDP = [
	'v=0',
	'm=video 9 UDP/TLS/RTP/SAVPF 96',
	'a=mid:0',
	'a=ice-ufrag:remoteU',
	'a=ice-pwd:remoteP',
	'a=candidate:9 1 udp 1 203.0.113.1 4000 typ host'
].join('\r\n');

class FakeSender {
	parameters: { encodings: Record<string, unknown>[] } = { encodings: [{}] };
	generateKeyFrame = vi.fn(() => Promise.resolve());
	getParameters() {
		return this.parameters;
	}
	setParameters(parameters: { encodings: Record<string, unknown>[] }) {
		this.parameters = parameters;
		return Promise.resolve();
	}
}

class FakePeerConnection {
	readonly sender = new FakeSender();
	readonly events = new Map<string, Set<() => void>>();
	localDescription: { sdp: string } | null = null;
	remoteDescriptions: string[] = [];
	iceGatheringState = 'complete';
	iceConnectionState = 'new';
	closed = false;
	restartIce = vi.fn();
	closeOrder: string[];

	constructor(closeOrder: string[] = []) {
		this.closeOrder = closeOrder;
	}

	addTransceiver() {
		return { sender: this.sender, setCodecPreferences: vi.fn() };
	}
	createOffer() {
		return Promise.resolve({ type: 'offer' as const, sdp: LOCAL_SDP });
	}
	setLocalDescription(description: { sdp?: string }) {
		this.localDescription = { sdp: description.sdp ?? LOCAL_SDP };
		return Promise.resolve();
	}
	setRemoteDescription(description: { sdp: string }) {
		this.remoteDescriptions.push(description.sdp);
		return Promise.resolve();
	}
	setConfiguration() {}
	getStats() {
		const entries = [
			{ type: 'outbound-rtp', kind: 'video', bytesSent: 125_000, framesSent: 60 },
			{ type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.05 }
		];
		return Promise.resolve({
			forEach(callback: (entry: unknown) => void) {
				entries.forEach(callback);
			}
		});
	}
	close() {
		this.closed = true;
		this.closeOrder.push('pc-close');
	}
	addEventListener(name: string, listener: () => void) {
		if (!this.events.has(name)) this.events.set(name, new Set());
		this.events.get(name)?.add(listener);
	}
	removeEventListener(name: string, listener: () => void) {
		this.events.get(name)?.delete(listener);
	}
	fireIce(state: string) {
		this.iceConnectionState = state;
		this.events.get('iceconnectionstatechange')?.forEach((listener) => listener());
	}
}

function fakeTracks(): WhipSessionTracks {
	return {
		video: { getSettings: () => ({ height: 1080 }) } as unknown as MediaStreamTrack,
		audio: null
	};
}

function settingsFixture(): PublishSettingsDoc {
	return {
		...defaultPublishSettings('mediamtx'),
		endpointUrl: 'https://mtx.example.net/live/whip',
		bearerToken: 'key'
	};
}

function makeHarness(clientOverrides: Partial<WhipClient> = {}) {
	const closeOrder: string[] = [];
	const connections: FakePeerConnection[] = [];
	const client: WhipClient = {
		publish: vi.fn(async () => ({
			resourceUrl: 'https://mtx.example.net/live/whip/s1',
			iceServers: [],
			answerSdp: ANSWER_SDP
		})),
		patchIceRestart: vi.fn(async () => ({ status: 'ok' as const, answerFragment: '' })),
		teardown: vi.fn(async () => {
			closeOrder.push('delete');
		}),
		...clientOverrides
	};
	const states: PublishState[] = [];
	const session = createWhipSession({
		createPeerConnection: () => {
			const connection = new FakePeerConnection(closeOrder);
			connections.push(connection);
			return connection as unknown as RTCPeerConnection;
		},
		createClient: () => client,
		schedule: {
			set: (callback, ms) => setTimeout(callback, ms),
			clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
		}
	});
	session.onState((state) => states.push(state));
	return { session, client, connections, states, closeOrder };
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('happy path', () => {
	it('POSTs the gathered offer, applies the answer, and goes live on ICE connected', async () => {
		const { session, client, connections, states } = makeHarness();
		await session.start(settingsFixture(), fakeTracks());

		expect(client.publish).toHaveBeenCalledWith(LOCAL_SDP);
		expect(connections[0].remoteDescriptions).toEqual([ANSWER_SDP]);
		expect(session.state.phase).toBe('connecting');

		connections[0].fireIce('connected');
		expect(session.state.phase).toBe('live');
		expect(states.map((state) => state.phase)).toEqual(['connecting', 'live']);
	});

	it('drives RTCRtpSender.generateKeyFrame() on the configured interval while live', async () => {
		const { session, connections } = makeHarness();
		await session.start(settingsFixture(), fakeTracks()); // keyframeIntervalS: 2
		connections[0].fireIce('connected');

		await vi.advanceTimersByTimeAsync(6_000);
		expect(connections[0].sender.generateKeyFrame).toHaveBeenCalledTimes(3);

		await session.stop();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(connections[0].sender.generateKeyFrame).toHaveBeenCalledTimes(3);
	});

	it('applies bitrate and resolution caps to the sender encoding', async () => {
		const { session, connections } = makeHarness();
		const settings = { ...settingsFixture(), maxHeight: 720, maxFps: 30 };
		await session.start(settings, fakeTracks());

		const encoding = connections[0].sender.parameters.encodings[0];
		expect(encoding.maxBitrate).toBe(4500 * 1000);
		expect(encoding.maxFramerate).toBe(30);
		expect(encoding.scaleResolutionDownBy).toBe(1080 / 720);
	});
});

describe('stop', () => {
	it('issues the DELETE before closing the peer connection (R1.4)', async () => {
		const { session, connections, closeOrder } = makeHarness();
		await session.start(settingsFixture(), fakeTracks());
		connections[0].fireIce('connected');

		await session.stop();
		expect(closeOrder).toEqual(['delete', 'pc-close']);
		expect(session.state.phase).toBe('ended');
	});
});

describe('failure mapping', () => {
	it('a late async failure after the user stopped never overwrites ended', async () => {
		let rejectPublish: (error: unknown) => void = () => undefined;
		const publish = vi.fn(
			() =>
				new Promise((_resolve, reject) => {
					rejectPublish = reject;
				})
		);
		const { session } = makeHarness({ publish: publish as unknown as WhipClient['publish'] });

		const startPromise = session.start(settingsFixture(), fakeTracks());
		expect(session.state.phase).toBe('connecting');
		// Let the connect chain reach the (now pending) POST before stopping.
		for (let i = 0; i < 20 && publish.mock.calls.length === 0; i++) await Promise.resolve();
		expect(publish).toHaveBeenCalledTimes(1);
		await session.stop();
		expect(session.state.phase).toBe('ended');

		// The pending POST now fails with a non-retryable error; the dead session
		// must stay ended instead of flipping to failed.
		rejectPublish(new WhipRequestError('auth', 401, 'rejected'));
		await startPromise;
		expect(session.state.phase).toBe('ended');
	});

	it('auth failures end the session without retries', async () => {
		const { session, client } = makeHarness({
			publish: vi.fn(async () => {
				throw new WhipRequestError('auth', 401, 'rejected');
			})
		});
		await session.start(settingsFixture(), fakeTracks());
		expect(session.state).toEqual({ phase: 'failed', reason: 'auth' });
		expect(client.publish).toHaveBeenCalledTimes(1);
	});

	it('retryable initial failures enter the reconnect ladder and re-POST', async () => {
		const publish = vi
			.fn()
			.mockRejectedValueOnce(new WhipRequestError('retryable', 503, 'busy'))
			.mockResolvedValue({
				resourceUrl: 'https://mtx.example.net/live/whip/s2',
				iceServers: [],
				answerSdp: ANSWER_SDP
			});
		const { session, connections } = makeHarness({ publish });
		await session.start(settingsFixture(), fakeTracks());
		expect(session.state.phase).toBe('reconnecting');

		await vi.advanceTimersByTimeAsync(2_000);
		expect(publish).toHaveBeenCalledTimes(2);
		connections.at(-1)?.fireIce('connected');
		expect(session.state.phase).toBe('live');
	});

	it('gives up as failed after exhausting the ladder', async () => {
		const publish = vi.fn(async () => {
			throw new WhipRequestError('retryable', 503, 'busy');
		});
		const { session } = makeHarness({ publish });
		await session.start(settingsFixture(), fakeTracks());

		await vi.advanceTimersByTimeAsync(2_000 + 4_000 + 8_000 + 16_000 + 16_000);
		expect(session.state).toEqual({ phase: 'failed', reason: 'gave-up' });
		// Initial POST + 5 retries.
		expect(publish).toHaveBeenCalledTimes(6);
	});
});

describe('mid-stream drop', () => {
	it('tries an ICE-restart PATCH after grace, then re-POSTs when unsupported', async () => {
		const patchIceRestart = vi.fn(async () => ({ status: 'unsupported' as const }));
		const { session, client, connections } = makeHarness({ patchIceRestart });
		await session.start(settingsFixture(), fakeTracks());
		connections[0].fireIce('connected');

		connections[0].fireIce('disconnected');
		// Grace (3 s) + first backoff (2 s) → attempt 1: PATCH, then immediate re-POST.
		await vi.advanceTimersByTimeAsync(5_000);
		expect(connections[0].restartIce).toHaveBeenCalled();
		expect(patchIceRestart).toHaveBeenCalledTimes(1);
		expect(client.publish).toHaveBeenCalledTimes(2);

		connections.at(-1)?.fireIce('connected');
		expect(session.state.phase).toBe('live');
	});

	it('a PATCH 404 (server lost the session) falls back to a full re-POST', async () => {
		const patchIceRestart = vi.fn(async () => {
			throw new WhipRequestError('not-found', 404, 'session gone');
		});
		const { session, client, connections } = makeHarness({ patchIceRestart });
		await session.start(settingsFixture(), fakeTracks());
		connections[0].fireIce('connected');

		connections[0].fireIce('failed');
		await vi.advanceTimersByTimeAsync(2_000);
		expect(patchIceRestart).toHaveBeenCalledTimes(1);
		expect(client.publish).toHaveBeenCalledTimes(2);

		connections.at(-1)?.fireIce('connected');
		expect(session.state.phase).toBe('live');
	});

	it('a disconnect that self-heals within grace never retries', async () => {
		const { session, client, connections } = makeHarness();
		await session.start(settingsFixture(), fakeTracks());
		connections[0].fireIce('connected');
		connections[0].fireIce('disconnected');
		connections[0].fireIce('connected');

		await vi.advanceTimersByTimeAsync(60_000);
		expect(client.patchIceRestart).not.toHaveBeenCalled();
		expect(client.publish).toHaveBeenCalledTimes(1);
		expect(session.state.phase).toBe('live');
	});
});

describe('orderCodecPreferences', () => {
	const capabilities = [
		{ mimeType: 'video/VP8', clockRate: 90000 },
		{
			mimeType: 'video/H264',
			clockRate: 90000,
			sdpFmtpLine: 'profile-level-id=640c1f;packetization-mode=1'
		},
		{
			mimeType: 'video/H264',
			clockRate: 90000,
			sdpFmtpLine: 'profile-level-id=42e01f;packetization-mode=1'
		},
		{ mimeType: 'video/AV1', clockRate: 90000 }
	] as RTCRtpCodec[];

	it('puts constrained-baseline H.264 first by default', () => {
		const ordered = orderCodecPreferences(capabilities, 'h264');
		expect(ordered[0].sdpFmtpLine).toContain('42e0');
		expect(ordered[1].mimeType).toBe('video/H264');
		expect(ordered).toHaveLength(capabilities.length);
	});

	it('puts AV1 first when selected', () => {
		const ordered = orderCodecPreferences(capabilities, 'av1');
		expect(ordered[0].mimeType).toBe('video/AV1');
	});
});

describe('stats', () => {
	it('derives bitrate from byte deltas and surfaces RTT', () => {
		const previous = { timestampMs: 0, bytesSent: 0, framesSent: 0, rttMs: null };
		const current = extractOutboundSample(
			[
				{ type: 'outbound-rtp', kind: 'video', bytesSent: 500_000, framesSent: 30 },
				{ type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.025 }
			],
			1_000
		);
		const stats = statsFromSamples(previous, current, 2);
		expect(stats.bitrateKbps).toBe(4_000);
		expect(stats.rttMs).toBe(25);
		expect(stats.framesSent).toBe(30);
		expect(stats.framesDropped).toBe(2);
	});
});
