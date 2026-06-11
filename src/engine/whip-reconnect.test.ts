import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
	createReconnectController,
	DEFAULT_RECONNECT_POLICY,
	type ReconnectControllerDeps
} from './whip-reconnect';

const schedule = {
	set: (callback: () => void, ms: number) => setTimeout(callback, ms),
	clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

function makeDeps() {
	return {
		schedule,
		onAttempt: vi.fn(),
		onGiveUp: vi.fn(),
		onWaiting: vi.fn()
	} satisfies ReconnectControllerDeps;
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('grace period', () => {
	it('waits 3 s after disconnected before the first attempt', () => {
		const deps = makeDeps();
		const controller = createReconnectController(deps);
		controller.noticeDisconnected();

		vi.advanceTimersByTime(2_999);
		expect(deps.onAttempt).not.toHaveBeenCalled();

		// Grace expiry begins retrying: attempt 1 fires after its own 2 s backoff.
		vi.advanceTimersByTime(1);
		expect(deps.onWaiting).toHaveBeenCalledWith(1, 2_000);
		vi.advanceTimersByTime(2_000);
		expect(deps.onAttempt).toHaveBeenCalledWith('ice-restart', 1);
	});

	it('a recovery during grace cancels retrying entirely', () => {
		const deps = makeDeps();
		const controller = createReconnectController(deps);
		controller.noticeDisconnected();
		vi.advanceTimersByTime(1_000);
		controller.noticeRecovered();

		vi.advanceTimersByTime(60_000);
		expect(deps.onAttempt).not.toHaveBeenCalled();
		expect(deps.onGiveUp).not.toHaveBeenCalled();
	});

	it('failed skips the grace period', () => {
		const deps = makeDeps();
		const controller = createReconnectController(deps);
		controller.noticeFailed();
		vi.advanceTimersByTime(2_000);
		expect(deps.onAttempt).toHaveBeenCalledWith('ice-restart', 1);
	});
});

describe('backoff ladder', () => {
	it('runs 2/4/8/16/16 s delays then gives up after 5 attempts', () => {
		const deps = makeDeps();
		const controller = createReconnectController(deps);
		controller.noticeFailed();

		const expectedDelays = [2_000, 4_000, 8_000, 16_000, 16_000];
		for (let attempt = 1; attempt <= 5; attempt++) {
			vi.advanceTimersByTime(expectedDelays[attempt - 1]);
			expect(deps.onAttempt).toHaveBeenNthCalledWith(attempt, 'ice-restart', attempt);
			controller.attemptFailed();
		}
		expect(deps.onGiveUp).toHaveBeenCalledTimes(1);

		// Inert after giving up — nothing further fires.
		vi.advanceTimersByTime(120_000);
		expect(deps.onAttempt).toHaveBeenCalledTimes(5);
	});

	it('reports each wait so the UI can show the countdown', () => {
		const deps = makeDeps();
		const controller = createReconnectController(deps);
		controller.noticeFailed();
		vi.advanceTimersByTime(2_000);
		controller.attemptFailed();
		expect(deps.onWaiting).toHaveBeenLastCalledWith(2, 4_000);
	});

	it('a successful attempt resets the ladder for the next outage', () => {
		const deps = makeDeps();
		const controller = createReconnectController(deps);
		controller.noticeFailed();
		vi.advanceTimersByTime(2_000);
		controller.attemptFailed();
		vi.advanceTimersByTime(4_000);
		controller.attemptSucceeded();
		expect(controller.attempt).toBe(0);

		controller.noticeFailed();
		vi.advanceTimersByTime(2_000);
		expect(deps.onAttempt).toHaveBeenLastCalledWith('ice-restart', 1);
	});
});

describe('PATCH-unsupported fallback', () => {
	it('re-POSTs immediately on the same attempt, then stays on re-post', () => {
		const deps = makeDeps();
		const controller = createReconnectController(deps);
		controller.noticeFailed();
		vi.advanceTimersByTime(2_000);
		expect(deps.onAttempt).toHaveBeenNthCalledWith(1, 'ice-restart', 1);

		controller.attemptPatchUnsupported();
		// Same attempt number, no backoff consumed.
		expect(deps.onAttempt).toHaveBeenNthCalledWith(2, 're-post', 1);

		controller.attemptFailed();
		vi.advanceTimersByTime(4_000);
		expect(deps.onAttempt).toHaveBeenNthCalledWith(3, 're-post', 2);
	});
});

describe('stop', () => {
	it('cancels pending timers and ignores later events', () => {
		const deps = makeDeps();
		const controller = createReconnectController(deps);
		controller.noticeFailed();
		controller.stop();
		controller.noticeFailed();
		controller.attemptFailed();

		vi.advanceTimersByTime(120_000);
		expect(deps.onAttempt).not.toHaveBeenCalled();
		expect(deps.onGiveUp).not.toHaveBeenCalled();
	});
});

describe('policy shape', () => {
	it('default policy matches the documented R5.2 numbers', () => {
		expect(DEFAULT_RECONNECT_POLICY.graceMs).toBe(3_000);
		expect(DEFAULT_RECONNECT_POLICY.backoffMs).toEqual([2_000, 4_000, 8_000, 16_000, 16_000]);
	});
});
