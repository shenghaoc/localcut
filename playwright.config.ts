import { defineConfig, devices } from '@playwright/test';

const parsedE2ePort = Number.parseInt(process.env.LOCALCUT_E2E_PORT ?? '5173', 10);
const e2ePort =
	Number.isInteger(parsedE2ePort) && parsedE2ePort > 0 && parsedE2ePort <= 65_535
		? parsedE2ePort
		: 5173;
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

/**
 * Phase 47: WHIP integration tests only (R8.5) — everything else is Vitest.
 * Requires a MediaMTX instance on localhost (see
 * .github/workflows/whip-integration.yml); run locally with:
 *   docker run --rm -d --name whip-mediamtx --network host -e MTX_API=yes bluenviron/mediamtx
 *   vp run test:e2e
 */
export default defineConfig({
	testDir: 'tests/e2e',
	timeout: 120_000,
	expect: { timeout: 30_000 },
	// The reconnect test restarts the shared MediaMTX container; never parallel.
	fullyParallel: false,
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	// In CI, emit `list` for log readability plus `github` for PR-inline
	// annotations and `junit` so failures show up in any test-report
	// uploader (e.g. dorny/test-reporter).
	reporter: process.env.CI
		? [['list'], ['github'], ['junit', { outputFile: 'test-results/junit-e2e.xml' }]]
		: 'list',
	use: {
		baseURL: e2eBaseUrl,
		...devices['Desktop Chrome'],
		trace: 'retain-on-failure',
		// Sandboxed environments without access to the Playwright CDN can point
		// WHIP_CHROME at any Chrome/Chromium binary instead.
		...(process.env.WHIP_CHROME
			? {
					launchOptions: { executablePath: process.env.WHIP_CHROME },
					chromiumSandbox: false
				}
			: {})
	},
	webServer: {
		command: `./node_modules/.bin/vp dev -- --host 127.0.0.1 --port ${e2ePort} --strictPort`,
		url: e2eBaseUrl,
		// Reusing an arbitrary process on the port can produce plausible but
		// meaningless failures against another worktree's app. Use
		// LOCALCUT_E2E_PORT when the default port is occupied instead.
		reuseExistingServer: false,
		timeout: 60_000
	}
});
