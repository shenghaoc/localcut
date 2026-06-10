import { defineConfig, devices } from '@playwright/test';

/**
 * Phase 47: WHIP integration tests only (R8.5) — everything else is Vitest.
 * Requires a MediaMTX instance on localhost (see
 * .github/workflows/whip-integration.yml); run locally with:
 *   docker run --rm -d --name whip-mediamtx --network host -e MTX_API=yes bluenviron/mediamtx
 *   npm run test:e2e
 */
export default defineConfig({
	testDir: 'tests/e2e',
	timeout: 120_000,
	expect: { timeout: 30_000 },
	// The reconnect test restarts the shared MediaMTX container; never parallel.
	fullyParallel: false,
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['list'], ['github']] : 'list',
	use: {
		baseURL: 'http://127.0.0.1:5173',
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
		command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
		url: 'http://127.0.0.1:5173',
		reuseExistingServer: !process.env.CI,
		timeout: 60_000
	}
});
