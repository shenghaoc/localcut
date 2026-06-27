import { describe, expect, it } from 'vite-plus/test';
import { createBudgetCounter, createBudgetCounterRegistry } from './budget-counters';

describe('BudgetCounter', () => {
	it('starts with no samples', () => {
		const counter = createBudgetCounter('gpu-submissions-per-frame');
		expect(counter.latest()).toBeNull();
		expect(counter.sampleCount()).toBe(0);
	});

	it('records and retrieves latest', () => {
		const counter = createBudgetCounter('gpu-submissions-per-frame');
		counter.record(1);
		counter.record(2);
		expect(counter.latest()?.value).toBe(2);
		expect(counter.sampleCount()).toBe(2);
	});

	it('computes windowed average', () => {
		let nowMs = 1000;
		const counter = createBudgetCounter('dropped-preview-frame-rate', () => nowMs);
		counter.record(10);
		nowMs = 2000;
		counter.record(20);
		nowMs = 3000;
		counter.record(30);
		const avg = counter.average(1500);
		expect(avg).toBeCloseTo(25);
	});

	it('returns null average with no samples in window', () => {
		let nowMs = 0;
		const counter = createBudgetCounter('export-throughput-fps', () => nowMs);
		counter.record(5);
		nowMs = 10_000;
		expect(counter.average(1000)).toBeNull();
	});

	it('caps samples at max', () => {
		const counter = createBudgetCounter('audio-underruns-per-minute');
		for (let i = 0; i < 200; i++) {
			counter.record(i);
		}
		expect(counter.sampleCount()).toBe(120);
		expect(counter.latest()?.value).toBe(199);
	});

	it('reset clears all samples', () => {
		const counter = createBudgetCounter('memory-usage-bytes');
		counter.record(100);
		counter.record(200);
		counter.reset();
		expect(counter.sampleCount()).toBe(0);
		expect(counter.latest()).toBeNull();
	});
});

describe('BudgetCounterRegistry', () => {
	it('creates counters on demand', () => {
		const reg = createBudgetCounterRegistry();
		reg.record('gpu-submissions-per-frame', 1);
		expect(reg.get('gpu-submissions-per-frame').sampleCount()).toBe(1);
	});

	it('returns same counter for same metric', () => {
		const reg = createBudgetCounterRegistry();
		const a = reg.get('gpu-submissions-per-frame');
		const b = reg.get('gpu-submissions-per-frame');
		expect(a).toBe(b);
	});

	it('snapshot captures all registered metrics', () => {
		const reg = createBudgetCounterRegistry();
		reg.record('gpu-submissions-per-frame', 1);
		reg.record('dropped-preview-frame-rate', 2.5);
		const snap = reg.snapshot();
		expect(snap.get('gpu-submissions-per-frame')?.observed).toBe(1);
		expect(snap.get('dropped-preview-frame-rate')?.observed).toBe(2.5);
		expect(snap.size).toBe(2);
	});

	it('snapshot shows null for empty counter', () => {
		const reg = createBudgetCounterRegistry();
		reg.get('cache-usage-bytes');
		const snap = reg.snapshot();
		expect(snap.get('cache-usage-bytes')?.observed).toBeNull();
		expect(snap.get('cache-usage-bytes')?.sampleCount).toBe(0);
	});

	it('proves one GPU submit per frame assertion', () => {
		const reg = createBudgetCounterRegistry();
		for (let i = 0; i < 60; i++) {
			reg.record('gpu-submissions-per-frame', 1);
		}
		const snap = reg.snapshot();
		expect(snap.get('gpu-submissions-per-frame')?.observed).toBe(1);
		expect(snap.get('gpu-submissions-per-frame')?.sampleCount).toBe(60);
	});

	it('detects submission count violation', () => {
		const reg = createBudgetCounterRegistry();
		reg.record('gpu-submissions-per-frame', 1);
		reg.record('gpu-submissions-per-frame', 2);
		const counter = reg.get('gpu-submissions-per-frame');
		expect(counter.latest()?.value).toBe(2);
	});
});
