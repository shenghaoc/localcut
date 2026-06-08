import type { BudgetMetric, PerformanceBudget } from './types';

export type BudgetDirection = 'max' | 'min';

export interface PerformanceBudgetDefinition {
	readonly metric: BudgetMetric;
	readonly label: string;
	readonly unit: PerformanceBudget['unit'];
	readonly window: PerformanceBudget['window'];
	readonly target: number;
	readonly warningAt: number;
	readonly breachAt: number;
	readonly direction: BudgetDirection;
	readonly notes?: string;
}

export const DEFAULT_PERFORMANCE_BUDGET_DEFINITIONS: readonly PerformanceBudgetDefinition[] = [
	{
		metric: 'main-thread-blocking-ms',
		label: 'Main-thread blocking',
		unit: 'ms',
		window: 'session',
		target: 50,
		warningAt: 75,
		breachAt: 100,
		direction: 'max',
		notes: 'Sustained media work must stay off the main thread.'
	},
	{
		metric: 'worker-decode-queue-frames',
		label: 'Worker decode queue',
		unit: 'frames',
		window: 'playback-60s',
		target: 5,
		warningAt: 6,
		breachAt: 10,
		direction: 'max'
	},
	{
		metric: 'worker-decode-queue-ms',
		label: 'Worker decode queue latency',
		unit: 'ms',
		window: 'playback-60s',
		target: 250,
		warningAt: 300,
		breachAt: 500,
		direction: 'max'
	},
	{
		metric: 'gpu-submissions-per-frame',
		label: 'GPU submissions per accelerated frame',
		unit: 'frames',
		window: 'playback-60s',
		target: 1,
		warningAt: 1.01,
		breachAt: 1.01,
		direction: 'max',
		notes: 'Accelerated preview/export must submit once per rendered frame.'
	},
	{
		metric: 'dropped-preview-frame-rate',
		label: 'Dropped preview frames',
		unit: 'percent',
		window: 'playback-60s',
		target: 5,
		warningAt: 10,
		breachAt: 20,
		direction: 'max'
	},
	{
		metric: 'export-throughput-fps',
		label: 'Export throughput',
		unit: 'fps',
		window: 'export-job',
		target: 24,
		warningAt: 18,
		breachAt: 12,
		direction: 'min'
	},
	{
		metric: 'memory-usage-bytes',
		label: 'Memory usage',
		unit: 'bytes',
		window: 'session',
		target: 1_500_000_000,
		warningAt: 2_000_000_000,
		breachAt: 3_000_000_000,
		direction: 'max'
	},
	{
		metric: 'cache-usage-bytes',
		label: 'Cache usage',
		unit: 'bytes',
		window: 'session',
		target: 6_000_000_000,
		warningAt: 7_000_000_000,
		breachAt: 8_000_000_000,
		direction: 'max'
	},
	{
		metric: 'audio-underruns-per-minute',
		label: 'Audio underruns',
		unit: 'count-per-minute',
		window: 'playback-60s',
		target: 0,
		warningAt: 2,
		breachAt: 10,
		direction: 'max'
	}
];

export function classifyBudgetStatus(
	observed: number | null,
	definition: PerformanceBudgetDefinition
): PerformanceBudget['status'] {
	if (observed === null || !Number.isFinite(observed)) return 'not-measured';
	if (definition.direction === 'max') {
		if (observed >= definition.breachAt) return 'breach';
		if (observed >= definition.warningAt) return 'warning';
		return 'ok';
	}
	if (observed <= definition.breachAt) return 'breach';
	if (observed <= definition.warningAt) return 'warning';
	return 'ok';
}

export function buildPerformanceBudget(
	definition: PerformanceBudgetDefinition,
	observed: number | null,
	sampleCount = observed === null ? 0 : 1
): PerformanceBudget {
	return {
		metric: definition.metric,
		label: definition.label,
		unit: definition.unit,
		window: definition.window,
		target: definition.target,
		warningAt: definition.warningAt,
		breachAt: definition.breachAt,
		observed,
		status: classifyBudgetStatus(observed, definition),
		sampleCount,
		notes: definition.notes
	};
}

export function buildDefaultPerformanceBudgets(
	observations: Partial<
		Record<BudgetMetric, { readonly observed: number | null; readonly sampleCount?: number }>
	> = {}
): PerformanceBudget[] {
	return DEFAULT_PERFORMANCE_BUDGET_DEFINITIONS.map((definition) => {
		const observation = observations[definition.metric];
		return buildPerformanceBudget(
			definition,
			observation?.observed ?? null,
			observation?.sampleCount ?? 0
		);
	});
}
