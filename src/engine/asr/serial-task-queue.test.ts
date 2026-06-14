import { describe, expect, it, vi } from 'vite-plus/test';
import { appendSerialTask } from './serial-task-queue';

describe('appendSerialTask', () => {
	it('routes rejections through the supplied handler and keeps the queue alive', async () => {
		const steps: string[] = [];
		const onError = vi.fn((error: unknown) => {
			steps.push(`error:${error instanceof Error ? error.message : String(error)}`);
		});

		let chain = Promise.resolve();
		chain = appendSerialTask(
			chain,
			async () => {
				steps.push('first');
				throw new Error('boom');
			},
			onError
		);
		chain = appendSerialTask(
			chain,
			async () => {
				steps.push('second');
			},
			onError
		);

		await chain;

		expect(onError).toHaveBeenCalledTimes(1);
		expect(steps).toEqual(['first', 'error:boom', 'second']);
	});
});
