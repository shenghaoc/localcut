import { describe, expect, it } from 'vite-plus/test';
import {
	budgetSessionsForProbe,
	canRecordWhileStreaming,
	createEncoderBudget
} from './encoder-budget';

describe('budgetSessionsForProbe', () => {
	it('grants 2 sessions with hardware encode, 1 without', () => {
		expect(budgetSessionsForProbe(true)).toBe(2);
		expect(budgetSessionsForProbe(false)).toBe(1);
	});
});

describe('createEncoderBudget', () => {
	it('rejects budgets below one session', () => {
		expect(() => createEncoderBudget(0)).toThrow();
		expect(() => createEncoderBudget(1.5)).toThrow();
	});

	it('hands out leases until the budget is exhausted', () => {
		const budget = createEncoderBudget(2);
		const publish = budget.acquire('whip-publish');
		const record = budget.acquire('iso-record');
		expect(publish).not.toBeNull();
		expect(record).not.toBeNull();
		expect(budget.acquire('export')).toBeNull();
		expect(budget.available()).toBe(0);
		expect(budget.activeConsumers()).toEqual(['whip-publish', 'iso-record']);
	});

	it('release frees the slot for the next consumer', () => {
		const budget = createEncoderBudget(1);
		const publish = budget.acquire('whip-publish');
		expect(budget.acquire('export')).toBeNull();
		publish?.release();
		expect(budget.available()).toBe(1);
		expect(budget.acquire('export')).not.toBeNull();
	});

	it('double release is a no-op, not a double-free', () => {
		const budget = createEncoderBudget(2);
		const lease = budget.acquire('export');
		budget.acquire('whip-publish');
		lease?.release();
		lease?.release();
		expect(budget.available()).toBe(1);
		expect(budget.activeConsumers()).toEqual(['whip-publish']);
	});
});

describe('canRecordWhileStreaming', () => {
	it('requires two free sessions before offering record+stream', () => {
		const hardware = createEncoderBudget(2);
		expect(canRecordWhileStreaming(hardware)).toBe(true);
		hardware.acquire('export');
		expect(canRecordWhileStreaming(hardware)).toBe(false);

		const software = createEncoderBudget(1);
		expect(canRecordWhileStreaming(software)).toBe(false);
	});
});
