import { defineConfig } from 'vite-plus';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		exclude: ['src/**/*.browser.test.{ts,tsx}'],
		// JUnit XML is emitted alongside the default reporter in CI so the
		// `store_test_results` step in .circleci/config.yml can feed
		// CircleCI Insights (test history, flaky-test detection).
		reporters: process.env.CI ? ['default', 'junit'] : 'default',
		outputFile: { junit: 'test-results/junit-node.xml' }
	}
});
