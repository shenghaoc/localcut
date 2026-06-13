import { defineConfig } from 'vite-plus';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		exclude: ['src/**/*.browser.test.{ts,tsx}']
	}
});
