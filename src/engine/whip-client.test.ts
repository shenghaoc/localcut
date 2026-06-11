import { describe, expect, it, vi } from 'vite-plus/test';
import {
	createWhipClient,
	parseIceServerLinks,
	WhipRequestError,
	type WhipClientConfig
} from './whip-client';

const ENDPOINT = 'https://ingest.example.com/live/whip';
const OFFER = 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n';

function response(
	status: number,
	options: { headers?: Record<string, string>; body?: string; url?: string } = {}
): Response {
	const res = new Response(status === 204 ? null : (options.body ?? ''), {
		status,
		headers: options.headers
	});
	if (options.url) Object.defineProperty(res, 'url', { value: options.url });
	return res;
}

function client(fetchFn: typeof fetch, overrides: Partial<WhipClientConfig> = {}) {
	return createWhipClient({
		endpointUrl: ENDPOINT,
		bearerToken: 'secret-token',
		fetchFn,
		...overrides
	});
}

async function failureKind(promise: Promise<unknown>): Promise<WhipRequestError> {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(WhipRequestError);
		return error as WhipRequestError;
	}
	throw new Error('expected the request to fail');
}

describe('publish', () => {
	it('POSTs application/sdp with a bearer header and resolves the Location', async () => {
		const fetchFn = vi.fn(async () =>
			response(201, {
				headers: { location: '/live/whip/session-1' },
				body: 'answer-sdp',
				url: ENDPOINT
			})
		);
		const resource = await client(fetchFn as typeof fetch).publish(OFFER);

		expect(fetchFn).toHaveBeenCalledTimes(1);
		const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe(ENDPOINT);
		expect(init.method).toBe('POST');
		expect(init.body).toBe(OFFER);
		const headers = init.headers as Record<string, string>;
		expect(headers['Content-Type']).toBe('application/sdp');
		expect(headers.Authorization).toBe('Bearer secret-token');

		expect(resource.resourceUrl).toBe('https://ingest.example.com/live/whip/session-1');
		expect(resource.answerSdp).toBe('answer-sdp');
	});

	it('omits the Authorization header when no token is configured', async () => {
		const fetchFn = vi.fn(async () =>
			response(201, { headers: { location: '/s/1' }, url: ENDPOINT })
		);
		await client(fetchFn as typeof fetch, { bearerToken: null }).publish(OFFER);
		const headers = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1]
			.headers as Record<string, string>;
		expect(headers.Authorization).toBeUndefined();
	});

	it('resolves an absolute Location as-is', async () => {
		const fetchFn = vi.fn(async () =>
			response(201, {
				headers: { location: 'https://node-7.example.net/sessions/abc' },
				url: ENDPOINT
			})
		);
		const resource = await client(fetchFn as typeof fetch).publish(OFFER);
		expect(resource.resourceUrl).toBe('https://node-7.example.net/sessions/abc');
	});

	it('lets the browser follow redirects and resolves against the final response URL', async () => {
		// `redirect: 'follow'` means fetch lands on the redirected node; the 201's
		// `response.url` is that final URL and Location resolves against it.
		const fetchFn = vi.fn(async () =>
			response(201, {
				headers: { location: '/ingest/whip/s1' },
				url: 'https://edge-1.example.net/ingest/whip'
			})
		);
		const resource = await client(fetchFn as typeof fetch).publish(OFFER);

		const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
		expect(init.redirect).toBe('follow');
		expect(resource.resourceUrl).toBe('https://edge-1.example.net/ingest/whip/s1');
	});

	it.each([
		[400, 'rejected-offer'],
		[401, 'auth'],
		[403, 'auth'],
		[404, 'not-found'],
		[409, 'retryable'],
		[503, 'retryable']
	] as const)('maps HTTP %i to %s', async (status, kind) => {
		const fetchFn = vi.fn(async () => response(status));
		const error = await failureKind(client(fetchFn as typeof fetch).publish(OFFER));
		expect(error.kind).toBe(kind);
		expect(error.status).toBe(status);
	});

	it('maps network failures to retryable and never leaks the token', async () => {
		const fetchFn = vi.fn(async () => {
			throw new TypeError('fetch failed: https://user:secret-token@bad.example');
		});
		const error = await failureKind(client(fetchFn as typeof fetch).publish(OFFER));
		expect(error.kind).toBe('retryable');
		expect(error.status).toBeNull();
		expect(error.message).not.toContain('secret-token');
	});

	it('treats a 201 without Location as retryable', async () => {
		const fetchFn = vi.fn(async () => response(201, { url: ENDPOINT }));
		const error = await failureKind(client(fetchFn as typeof fetch).publish(OFFER));
		expect(error.kind).toBe('retryable');
	});

	it('parses Link rel="ice-server" headers including TURN credentials', async () => {
		const fetchFn = vi.fn(async () =>
			response(201, {
				headers: {
					location: '/s/1',
					link:
						'<stun:stun.example.net>; rel="ice-server", ' +
						'<turn:turn.example.net?transport=udp>; rel="ice-server"; ' +
						'username="user"; credential="pass"; credential-type="password", ' +
						'<https://docs.example.net>; rel="help"'
				},
				url: ENDPOINT
			})
		);
		const resource = await client(fetchFn as typeof fetch).publish(OFFER);
		expect(resource.iceServers).toEqual([
			{ urls: 'stun:stun.example.net' },
			{ urls: 'turn:turn.example.net?transport=udp', username: 'user', credential: 'pass' }
		]);
	});
});

describe('parseIceServerLinks', () => {
	it('returns an empty list for a missing header', () => {
		expect(parseIceServerLinks(null)).toEqual([]);
	});

	it('ignores malformed entries', () => {
		expect(parseIceServerLinks('garbage; rel="ice-server"')).toEqual([]);
	});
});

describe('patchIceRestart', () => {
	it('PATCHes a trickle-ice-sdpfrag with the bearer header', async () => {
		const fetchFn = vi.fn(async () => response(200, { body: 'answer-frag' }));
		const result = await client(fetchFn as typeof fetch).patchIceRestart(
			'https://ingest.example.com/s/1',
			'frag'
		);
		const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://ingest.example.com/s/1');
		expect(init.method).toBe('PATCH');
		const headers = init.headers as Record<string, string>;
		expect(headers['Content-Type']).toBe('application/trickle-ice-sdpfrag');
		expect(headers.Authorization).toBe('Bearer secret-token');
		expect(result).toEqual({ status: 'ok', answerFragment: 'answer-frag' });
	});

	it.each([405, 501])('reports HTTP %i as unsupported', async (status) => {
		const fetchFn = vi.fn(async () => response(status));
		const result = await client(fetchFn as typeof fetch).patchIceRestart('https://x/s/1', 'frag');
		expect(result).toEqual({ status: 'unsupported' });
	});

	it('maps other failures through the standard error mapping', async () => {
		const fetchFn = vi.fn(async () => response(401));
		const error = await failureKind(
			client(fetchFn as typeof fetch).patchIceRestart('https://x/s/1', 'frag')
		);
		expect(error.kind).toBe('auth');
	});
});

describe('teardown', () => {
	it('DELETEs the session resource with keepalive and the bearer header', async () => {
		const fetchFn = vi.fn(async () => response(204));
		await client(fetchFn as typeof fetch).teardown('https://ingest.example.com/s/1');
		const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://ingest.example.com/s/1');
		expect(init.method).toBe('DELETE');
		expect(init.keepalive).toBe(true);
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
	});

	it('never throws — local teardown must complete even if the DELETE fails', async () => {
		const fetchFn = vi.fn(async () => {
			throw new TypeError('network gone');
		});
		await expect(
			client(fetchFn as typeof fetch).teardown('https://ingest.example.com/s/1')
		).resolves.toBeUndefined();
	});
});
