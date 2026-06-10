/**
 * Phase 47 (T2.3): reconnect policy for the WHIP session (R5.2) as a pure
 * state machine over injected timers, so every branch unit-tests with fake
 * clocks. The session owns the actual network work; this controller only
 * decides *when* to attempt *what*.
 *
 * Policy: 3 s grace on `disconnected` (the ICE layer often self-heals); on
 * `failed` (or grace expiry) retry with backoff 2/4/8/16/16 s, max 5 attempts.
 * The first attempt is an ICE restart (PATCH); once the server reports PATCH
 * unsupported the controller permanently falls back to full re-POSTs, retrying
 * the same attempt immediately — the rejected PATCH never reached the media
 * path, so it does not consume an attempt or add backoff.
 */

export type ReconnectAction = 'ice-restart' | 're-post';

export interface ReconnectPolicy {
	graceMs: number;
	/** Delay before attempt n is `backoffMs[n - 1]`; length caps the attempts. */
	backoffMs: readonly number[];
}

export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
	graceMs: 3_000,
	backoffMs: [2_000, 4_000, 8_000, 16_000, 16_000]
};

export interface ReconnectSchedule {
	set(callback: () => void, ms: number): unknown;
	clear(handle: unknown): void;
}

export interface ReconnectControllerDeps {
	schedule: ReconnectSchedule;
	/** Perform attempt `attempt` (1-based) using `action`. */
	onAttempt(action: ReconnectAction, attempt: number): void;
	/** All attempts exhausted — the session must become `failed` (R5.1). */
	onGiveUp(): void;
	/** A retry wait started: `attempt` will fire in `delayMs` (drives the UI). */
	onWaiting?(attempt: number, delayMs: number): void;
}

export interface ReconnectController {
	/** ICE went `disconnected`: start the grace timer unless already recovering. */
	noticeDisconnected(): void;
	/** ICE went `failed`: skip the grace period and start retrying. */
	noticeFailed(): void;
	/** Connection is healthy again: reset attempts, cancel pending work. */
	noticeRecovered(): void;
	/** The in-flight attempt failed; schedules the next one or gives up. */
	attemptFailed(): void;
	/** The PATCH was rejected as unsupported: re-POST now, same attempt. */
	attemptPatchUnsupported(): void;
	attemptSucceeded(): void;
	/** User stop / teardown: cancel everything; the controller becomes inert. */
	stop(): void;
	readonly attempt: number;
}

type Phase = 'idle' | 'grace' | 'waiting' | 'attempting' | 'stopped';

export function createReconnectController(
	deps: ReconnectControllerDeps,
	policy: ReconnectPolicy = DEFAULT_RECONNECT_POLICY
): ReconnectController {
	let phase: Phase = 'idle';
	let attempt = 0;
	let patchUnsupported = false;
	let timer: unknown = null;

	function clearTimer() {
		if (timer !== null) {
			deps.schedule.clear(timer);
			timer = null;
		}
	}

	function action(): ReconnectAction {
		return patchUnsupported ? 're-post' : 'ice-restart';
	}

	function scheduleAttempt() {
		attempt += 1;
		if (attempt > policy.backoffMs.length) {
			phase = 'stopped';
			deps.onGiveUp();
			return;
		}
		const delayMs = policy.backoffMs[attempt - 1];
		phase = 'waiting';
		deps.onWaiting?.(attempt, delayMs);
		const firing = attempt;
		timer = deps.schedule.set(() => {
			timer = null;
			phase = 'attempting';
			deps.onAttempt(action(), firing);
		}, delayMs);
	}

	function beginRetrying() {
		clearTimer();
		attempt = 0;
		scheduleAttempt();
	}

	return {
		noticeDisconnected() {
			if (phase !== 'idle') return;
			phase = 'grace';
			timer = deps.schedule.set(() => {
				timer = null;
				beginRetrying();
			}, policy.graceMs);
		},
		noticeFailed() {
			if (phase === 'stopped' || phase === 'waiting' || phase === 'attempting') return;
			beginRetrying();
		},
		noticeRecovered() {
			if (phase !== 'grace') return;
			clearTimer();
			phase = 'idle';
		},
		attemptFailed() {
			if (phase !== 'attempting') return;
			scheduleAttempt();
		},
		attemptPatchUnsupported() {
			if (phase !== 'attempting') return;
			patchUnsupported = true;
			deps.onAttempt('re-post', attempt);
		},
		attemptSucceeded() {
			if (phase !== 'attempting') return;
			phase = 'idle';
			attempt = 0;
		},
		stop() {
			clearTimer();
			phase = 'stopped';
		},
		get attempt() {
			return attempt;
		}
	};
}
