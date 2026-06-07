import { describe, expect, it } from 'vitest';
import {
  buildDefaultPerformanceBudgets,
  buildPerformanceBudget,
  classifyBudgetStatus,
  type PerformanceBudgetDefinition,
} from './performance-budgets';

const maxDefinition: PerformanceBudgetDefinition = {
  metric: 'gpu-submissions-per-frame',
  label: 'GPU submissions',
  unit: 'frames',
  window: 'playback-60s',
  target: 1,
  warningAt: 1.01,
  breachAt: 1.01,
  direction: 'max',
};

const minDefinition: PerformanceBudgetDefinition = {
  metric: 'export-throughput-fps',
  label: 'Export throughput',
  unit: 'fps',
  window: 'export-job',
  target: 24,
  warningAt: 18,
  breachAt: 12,
  direction: 'min',
};

describe('performance budgets', () => {
  it('classifies max-threshold budgets', () => {
    expect(classifyBudgetStatus(null, maxDefinition)).toBe('not-measured');
    expect(classifyBudgetStatus(1, maxDefinition)).toBe('ok');
    expect(classifyBudgetStatus(1.01, maxDefinition)).toBe('breach');
    expect(classifyBudgetStatus(2, maxDefinition)).toBe('breach');
  });

  it('classifies min-threshold budgets', () => {
    expect(classifyBudgetStatus(30, minDefinition)).toBe('ok');
    expect(classifyBudgetStatus(18, minDefinition)).toBe('warning');
    expect(classifyBudgetStatus(12, minDefinition)).toBe('breach');
  });

  it('builds default budgets with observations', () => {
    const budgets = buildDefaultPerformanceBudgets({
      'gpu-submissions-per-frame': { observed: 1, sampleCount: 10 },
      'audio-underruns-per-minute': { observed: 11, sampleCount: 1 },
    });
    expect(budgets.find((budget) => budget.metric === 'gpu-submissions-per-frame')?.status).toBe('ok');
    expect(budgets.find((budget) => budget.metric === 'audio-underruns-per-minute')?.status).toBe('breach');
    expect(budgets.find((budget) => budget.metric === 'gpu-submissions-per-frame')?.sampleCount).toBe(10);
  });

  it('preserves budget metadata', () => {
    const budget = buildPerformanceBudget(maxDefinition, 1, 3);
    expect(budget.metric).toBe('gpu-submissions-per-frame');
    expect(budget.target).toBe(1);
    expect(budget.sampleCount).toBe(3);
  });
});
