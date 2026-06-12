/**
 * Phase 47 (T10/R8.3–R8.4): WHIP publish against a real MediaMTX ingest.
 * The harness page (whip-harness.html) publishes a synthetic program feed via
 * the production WhipSession/WhipClient code; assertions read MediaMTX's API.
 *
 * Requires MediaMTX on localhost with the API enabled (the CI workflow starts
 * it as a docker container named `whip-mediamtx` on the host network).
 */

import { execSync } from 'node:child_process';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { WhipHarness } from '../../src/testing/whip-harness';

declare global {
	interface Window {
		__whipHarness: WhipHarness;
	}
}

const STREAM_PATH = 'live';
const WHIP_URL = `http://127.0.0.1:8889/${STREAM_PATH}/whip`;
const API_PATHS = 'http://127.0.0.1:9997/v3/paths/list';
/** How to bounce the ingest server mid-stream (overridable for non-docker runs). */
const MEDIAMTX_RESTART_CMD =
	process.env.MEDIAMTX_RESTART_CMD ??
	`docker restart ${process.env.MEDIAMTX_CONTAINER ?? 'whip-mediamtx'}`;

interface MediaMtxPath {
	name: string;
	ready: boolean;
	bytesReceived: number;
}

async function ingestPath(request: APIRequestContext): Promise<MediaMtxPath | null> {
	const response = await request.get(API_PATHS);
	if (!response.ok()) return null;
	const body = (await response.json()) as { items?: MediaMtxPath[] };
	return body.items?.find((item) => item.name === STREAM_PATH) ?? null;
}

async function harnessState(page: Page): Promise<string> {
	return page.evaluate(() => window.__whipHarness.state());
}

async function startPublish(page: Page): Promise<void> {
	await page.goto('/whip-harness.html');
	await page.evaluate((url) => window.__whipHarness.start(url), WHIP_URL);
	await expect.poll(() => harnessState(page), { timeout: 30_000 }).toBe('live');
}

test.describe.configure({ mode: 'serial' });

test('publishes to MediaMTX and the ingest receives a growing byte stream', async ({
	page,
	request
}) => {
	await startPublish(page);

	await expect
		.poll(async () => (await ingestPath(request))?.ready ?? false, { timeout: 30_000 })
		.toBe(true);

	const before = (await ingestPath(request))?.bytesReceived ?? 0;
	await expect
		.poll(async () => (await ingestPath(request))?.bytesReceived ?? 0, { timeout: 30_000 })
		.toBeGreaterThan(before);

	await page.evaluate(() => window.__whipHarness.stop());
});

test('stopping sends the WHIP DELETE and the ingest session disappears', async ({
	page,
	request
}) => {
	await startPublish(page);
	await expect
		.poll(async () => (await ingestPath(request))?.ready ?? false, { timeout: 30_000 })
		.toBe(true);

	await page.evaluate(() => window.__whipHarness.stop());
	await expect.poll(() => harnessState(page)).toBe('ended');

	// The DELETE ends the session server-side immediately — the path must drop
	// out of ready without waiting for any ingest timeout.
	await expect
		.poll(async () => (await ingestPath(request))?.ready ?? false, { timeout: 15_000 })
		.toBe(false);
});

test('a mid-stream server drop walks the documented reconnect policy back to live', async ({
	page,
	request
}) => {
	await startPublish(page);
	await expect
		.poll(async () => (await ingestPath(request))?.ready ?? false, { timeout: 30_000 })
		.toBe(true);

	execSync(MEDIAMTX_RESTART_CMD, { stdio: 'inherit' });

	// R5.2: grace period → ICE restart (PATCH 404s on the restarted server) →
	// full re-POST → live again. ICE failure detection dominates the wait.
	await expect
		.poll(async () => (await page.evaluate(() => window.__whipHarness.phases())).join(','), {
			timeout: 90_000
		})
		.toContain('reconnecting');
	await expect.poll(() => harnessState(page), { timeout: 90_000 }).toBe('live');

	// And the new session is really ingesting again.
	await expect
		.poll(async () => (await ingestPath(request))?.bytesReceived ?? 0, { timeout: 30_000 })
		.toBeGreaterThan(0);

	await page.evaluate(() => window.__whipHarness.stop());
});
