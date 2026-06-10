/**
 * Phase 47 (T4.2/T4.3): encoder-session budget shared by every hardware
 * encoder consumer — WHIP publish (WebRTC's internal encoder), ISO recording,
 * and export. Hardware encoders cap concurrent sessions at the driver (NVENC
 * famously at 2–3); exceeding the cap fails opaquely mid-stream, so the budget
 * is a conservative gate checked out *before* any session is created (R3.4),
 * never a measurement after the fact.
 */

export type EncoderConsumer = 'export' | 'iso-record' | 'whip-publish';

export interface EncoderLease {
	readonly consumer: EncoderConsumer;
	/** Idempotent: releasing twice is a no-op, never a double-free. */
	release(): void;
}

export interface EncoderBudget {
	readonly maxSessions: number;
	acquire(consumer: EncoderConsumer): EncoderLease | null;
	available(): number;
	activeConsumers(): readonly EncoderConsumer[];
}

/**
 * Hardware encode confirmed → 2 concurrent sessions (the floor across NVENC /
 * VideoToolbox / VA-API class hardware); software-only or unknown → 1, because
 * two software encodes contend for the same cores the editor needs (R3.2).
 */
export function budgetSessionsForProbe(hardwareEncode: boolean): number {
	return hardwareEncode ? 2 : 1;
}

export function createEncoderBudget(maxSessions: number): EncoderBudget {
	if (!Number.isInteger(maxSessions) || maxSessions < 1) {
		throw new Error(`Encoder budget needs at least one session, got ${maxSessions}.`);
	}
	const active: EncoderLease[] = [];

	return {
		maxSessions,
		acquire(consumer) {
			if (active.length >= maxSessions) return null;
			let released = false;
			const lease: EncoderLease = {
				consumer,
				release() {
					if (released) return;
					released = true;
					const index = active.indexOf(lease);
					if (index !== -1) active.splice(index, 1);
				}
			};
			active.push(lease);
			return lease;
		},
		available() {
			return maxSessions - active.length;
		},
		activeConsumers() {
			return active.map((lease) => lease.consumer);
		}
	};
}

/**
 * R3.3: simultaneous record + stream is offered only when the budget can hold
 * both sessions — the publish lease plus one for the recorder — over and above
 * whatever is already running.
 */
export function canRecordWhileStreaming(budget: EncoderBudget): boolean {
	return budget.available() >= 2;
}
