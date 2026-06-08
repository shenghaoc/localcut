import type { BudgetMetric } from './types';

export interface BudgetSample {
	readonly value: number;
	readonly timestamp: number;
}

export interface BudgetCounter {
	readonly metric: BudgetMetric;
	record(value: number): void;
	latest(): BudgetSample | null;
	average(windowMs: number): number | null;
	sampleCount(): number;
	reset(): void;
}

const MAX_SAMPLES = 120;

export function createBudgetCounter(metric: BudgetMetric): BudgetCounter {
	const samples: BudgetSample[] = [];

	return {
		metric,

		record(value: number): void {
			samples.push({ value, timestamp: Date.now() });
			if (samples.length > MAX_SAMPLES) {
				samples.splice(0, samples.length - MAX_SAMPLES);
			}
		},

		latest(): BudgetSample | null {
			return samples.length > 0 ? samples[samples.length - 1]! : null;
		},

		average(windowMs: number): number | null {
			const cutoff = Date.now() - windowMs;
			const recent = samples.filter((s) => s.timestamp >= cutoff);
			if (recent.length === 0) return null;
			return recent.reduce((sum, s) => sum + s.value, 0) / recent.length;
		},

		sampleCount(): number {
			return samples.length;
		},

		reset(): void {
			samples.length = 0;
		}
	};
}

export interface BudgetCounterRegistry {
	readonly counters: ReadonlyMap<BudgetMetric, BudgetCounter>;
	get(metric: BudgetMetric): BudgetCounter;
	record(metric: BudgetMetric, value: number): void;
	snapshot(): ReadonlyMap<BudgetMetric, { observed: number | null; sampleCount: number }>;
}

export function createBudgetCounterRegistry(): BudgetCounterRegistry {
	const counters = new Map<BudgetMetric, BudgetCounter>();

	function get(metric: BudgetMetric): BudgetCounter {
		let counter = counters.get(metric);
		if (!counter) {
			counter = createBudgetCounter(metric);
			counters.set(metric, counter);
		}
		return counter;
	}

	return {
		counters,

		get,

		record(metric: BudgetMetric, value: number): void {
			get(metric).record(value);
		},

		snapshot(): ReadonlyMap<BudgetMetric, { observed: number | null; sampleCount: number }> {
			const result = new Map<BudgetMetric, { observed: number | null; sampleCount: number }>();
			for (const [metric, counter] of counters) {
				const latest = counter.latest();
				result.set(metric, {
					observed: latest?.value ?? null,
					sampleCount: counter.sampleCount()
				});
			}
			return result;
		}
	};
}
