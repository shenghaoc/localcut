import { defineConfig } from 'vite-plus';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		exclude: ['src/**/*.browser.test.{ts,tsx}'],
		// JUnit XML is emitted alongside the default reporter in CI so that
		// any GitHub Actions test reporter (e.g. dorny/test-reporter) can
		// surface failures inline on the PR.
		reporters: process.env.CI ? ['default', 'junit'] : 'default',
		outputFile: { junit: 'test-results/junit-node.xml' }
	}
});
