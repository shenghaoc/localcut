import { defineConfig } from 'vite-plus';
import { playwright } from 'vite-plus/test/browser-playwright';
import solid from 'vite-plugin-solid';

export default defineConfig({
	plugins: [solid()],
	test: {
		browser: {
			enabled: true,
			provider: playwright(),
			headless: true,
			instances: [{ browser: 'chromium' }]
		},
		include: ['src/**/*.browser.test.{ts,tsx}'],
		exclude: [
			'**/*.e2e.*',
			'tests/e2e/**',
			'dist/**',
			'dev-dist/**',
			'playwright-report/**',
			'test-results/**'
		]
	}
});
