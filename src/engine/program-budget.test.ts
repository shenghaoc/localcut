/**
 * Phase 45: Program Budget — unit tests for acquireProgramLeases.
 */

import { describe, it, expect } from 'vite-plus/test';
import { createEncoderBudget } from './encoder-budget';
import { acquireProgramLeases, ProgramBudgetError } from './program-session';

describe('acquireProgramLeases', () => {
	it('acquires exact count successfully', () => {
		const budget = createEncoderBudget(2);
		const leases = acquireProgramLeases(budget, 2);
		expect(leases).not.toBe('budget-exhausted');
		expect(Array.isArray(leases)).toBe(true);
		expect(leases).toHaveLength(2);
		expect(budget.available()).toBe(0);

		// Release all
		if (Array.isArray(leases)) {
			for (const lease of leases) {
				lease.release();
			}
		}
		expect(budget.available()).toBe(2);
	});

	it('returns budget-exhausted when count exceeds available', () => {
		const budget = createEncoderBudget(2);
		const result = acquireProgramLeases(budget, 3);
		expect(result).toBe('budget-exhausted');
		// No leases should be held
		expect(budget.available()).toBe(2);
	});

	it('releases already-acquired leases on failure', () => {
		const budget = createEncoderBudget(2);
		// Acquire 1 first
		budget.acquire('export');
		expect(budget.available()).toBe(1);

		// Try to acquire 2 (should fail and release the one it got)
		const result = acquireProgramLeases(budget, 2);
		expect(result).toBe('budget-exhausted');
		// The budget should have the original export lease still
		expect(budget.available()).toBe(1);
	});

	it('handles zero count', () => {
		const budget = createEncoderBudget(2);
		const leases = acquireProgramLeases(budget, 0);
		expect(leases).not.toBe('budget-exhausted');
		expect(leases).toHaveLength(0);
		expect(budget.available()).toBe(2);
	});

	it('simultaneous WHIP publish lease reduces available count', () => {
		const budget = createEncoderBudget(2);
		// WHIP publish takes one lease
		budget.acquire('whip-publish');
		expect(budget.available()).toBe(1);

		// Program mode tries to acquire 2
		const result = acquireProgramLeases(budget, 2);
		expect(result).toBe('budget-exhausted');

		// Program mode tries to acquire 1
		const leases = acquireProgramLeases(budget, 1);
		expect(leases).not.toBe('budget-exhausted');
		expect(leases).toHaveLength(1);
	});

	it('release is idempotent', () => {
		const budget = createEncoderBudget(2);
		const leases = acquireProgramLeases(budget, 2);
		expect(leases).not.toBe('budget-exhausted');

		// Release twice
		if (Array.isArray(leases)) {
			for (const lease of leases) {
				lease.release();
				lease.release(); // Should not throw
			}
		}
		expect(budget.available()).toBe(2);
	});
});

describe('ProgramBudgetError', () => {
	it('has correct message', () => {
		const error = new ProgramBudgetError(3, 2);
		expect(error.name).toBe('ProgramBudgetError');
		expect(error.message).toContain('3');
		expect(error.message).toContain('2');
		expect(error.requested).toBe(3);
		expect(error.available).toBe(2);
	});
});
