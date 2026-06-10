/**
 * Phase 47 (T1): WHIP client per RFC 9725 — pure HTTP logic over an injected
 * `fetch`, so every path unit-tests in Node. The peer connection lives in
 * `whip-session.ts`; this module only speaks HTTP.
 *
 * The bearer token is attached as a header and must never appear in error
 * messages, logs, or diagnostics (R1.2) — errors carry status codes only.
 */

export type WhipFailureKind = 'rejected-offer' | 'auth' | 'not-found' | 'retryable';

export class WhipRequestError extends Error {
	readonly kind: WhipFailureKind;
	/** HTTP status, or null for network-level failures. */
	readonly status: number | null;

	constructor(kind: WhipFailureKind, status: number | null, message: string) {
		super(message);
		this.name = 'WhipRequestError';
		this.kind = kind;
		this.status = status;
	}
}

export interface WhipPublishResource {
	/** Session resource from the `Location` header, resolved absolute (R1.1). */
	resourceUrl: string;
	/** ICE servers from `Link rel="ice-server"` headers (R1.3). */
	iceServers: RTCIceServer[];
	answerSdp: string;
}

export interface WhipClientConfig {
	endpointUrl: string;
	bearerToken: string | null;
	/** Injected for tests; defaults to the global fetch. */
	fetchFn?: typeof fetch;
}

export interface WhipClient {
	publish(offerSdp: string): Promise<WhipPublishResource>;
	patchIceRestart(
		resourceUrl: string,
		fragment: string
	): Promise<{ status: 'ok'; answerFragment: string } | { status: 'unsupported' }>;
	teardown(resourceUrl: string): Promise<void>;
}

function mapHttpFailure(status: number): WhipRequestError {
	if (status === 400) {
		return new WhipRequestError(
			'rejected-offer',
			status,
			'The endpoint rejected the SDP offer (HTTP 400).'
		);
	}
	if (status === 401 || status === 403) {
		return new WhipRequestError(
			'auth',
			status,
			`The endpoint rejected the bearer token (HTTP ${status}).`
		);
	}
	if (status === 404) {
		return new WhipRequestError('not-found', status, 'The endpoint URL was not found (HTTP 404).');
	}
	return new WhipRequestError('retryable', status, `The endpoint returned HTTP ${status}.`);
}

/**
 * Parses `Link` headers (RFC 8288) for `rel="ice-server"` entries per
 * RFC 9725 §4.4. `Headers` joins repeated Link headers with commas, so entries
 * are split on commas that precede a `<` (URI-references contain no `<`).
 */
export function parseIceServerLinks(linkHeader: string | null): RTCIceServer[] {
	if (!linkHeader) return [];
	const servers: RTCIceServer[] = [];
	for (const entry of linkHeader.split(/,\s*(?=<)/)) {
		const match = entry.match(/^\s*<([^>]+)>\s*((?:;[^;]*)*)$/);
		if (!match) continue;
		const params = new Map<string, string>();
		for (const param of match[2].split(';')) {
			const eq = param.indexOf('=');
			if (eq === -1) continue;
			const key = param.slice(0, eq).trim().toLowerCase();
			const value = param
				.slice(eq + 1)
				.trim()
				.replace(/^"(.*)"$/, '$1');
			params.set(key, value);
		}
		if (params.get('rel') !== 'ice-server') continue;
		const server: RTCIceServer = { urls: match[1] };
		const username = params.get('username');
		const credential = params.get('credential');
		if (username !== undefined) server.username = username;
		if (credential !== undefined) server.credential = credential;
		servers.push(server);
	}
	return servers;
}

export function createWhipClient(config: WhipClientConfig): WhipClient {
	const fetchFn = config.fetchFn ?? fetch;

	function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
		return config.bearerToken !== null && config.bearerToken !== ''
			? { ...extra, Authorization: `Bearer ${config.bearerToken}` }
			: extra;
	}

	async function request(url: string, init: RequestInit): Promise<Response> {
		try {
			return await fetchFn(url, init);
		} catch {
			// Never re-throw the original error: fetch errors can echo the request
			// URL, and a misconfigured user could have pasted a token into it.
			throw new WhipRequestError('retryable', null, 'Network request to the endpoint failed.');
		}
	}

	async function publish(offerSdp: string): Promise<WhipPublishResource> {
		// Redirects (R1.5): the browser follows them (`redirect: 'follow'`) —
		// manual redirect counting is not feasible client-side because cross-origin
		// manual mode yields opaque redirects with no readable Location. The
		// session resource resolves against the *final* response URL.
		const response = await request(config.endpointUrl, {
			method: 'POST',
			headers: authHeaders({ 'Content-Type': 'application/sdp' }),
			body: offerSdp,
			redirect: 'follow'
		});

		if (response.status !== 201) throw mapHttpFailure(response.status);

		const location = response.headers.get('location');
		if (!location) {
			throw new WhipRequestError(
				'retryable',
				201,
				'The endpoint accepted the offer but sent no Location header.'
			);
		}
		return {
			resourceUrl: new URL(location, responseUrl(response, config.endpointUrl)).toString(),
			iceServers: parseIceServerLinks(response.headers.get('link')),
			answerSdp: await response.text()
		};
	}

	async function patchIceRestart(
		resourceUrl: string,
		fragment: string
	): Promise<{ status: 'ok'; answerFragment: string } | { status: 'unsupported' }> {
		const response = await request(resourceUrl, {
			method: 'PATCH',
			headers: authHeaders({ 'Content-Type': 'application/trickle-ice-sdpfrag' }),
			body: fragment
		});
		if (response.status === 405 || response.status === 501) return { status: 'unsupported' };
		if (response.status < 200 || response.status >= 300) throw mapHttpFailure(response.status);
		return { status: 'ok', answerFragment: await response.text() };
	}

	async function teardown(resourceUrl: string): Promise<void> {
		// keepalive lets the DELETE survive pagehide/beforeunload (R1.4). Teardown is
		// best-effort: a failed DELETE must not block closing the local session.
		try {
			await fetchFn(resourceUrl, {
				method: 'DELETE',
				headers: authHeaders(),
				keepalive: true
			});
		} catch {
			// Swallowed deliberately: the server reaps dead sessions; the local
			// teardown must always complete.
		}
	}

	return { publish, patchIceRestart, teardown };
}

/** Mocked Responses may omit `url`; fall back to the request URL for resolution. */
function responseUrl(response: Response, requestUrl: string): string {
	return response.url !== '' ? response.url : requestUrl;
}
