import { describe, expect, it, vi, beforeEach, afterEach } from 'vite-plus/test';
import { createRecoveryMachine } from './recovery';

describe('WorkerRecoveryMachine', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('starts in running state', () => {
		const machine = createRecoveryMachine();
		expect(machine.state).toBe('running');
		expect(machine.restartAttempts).toBe(0);
		expect(machine.lastCrashAt).toBeNull();
		expect(machine.lastCheckpoint).toBeNull();
	});

	it('transitions to crashed on crash', () => {
		const machine = createRecoveryMachine();
		const next = machine.recordCrash();
		expect(next).toBe('crashed');
		expect(machine.state).toBe('crashed');
		expect(machine.lastCrashAt).toBeTruthy();
	});

	it('canRestart returns true before first attempt', () => {
		const machine = createRecoveryMachine();
		machine.recordCrash();
		expect(machine.canRestart()).toBe(true);
	});

	it('transitions to running on restart success', () => {
		const machine = createRecoveryMachine();
		machine.recordCrash();
		machine.recordRestartSuccess();
		expect(machine.state).toBe('running');
	});

	it('increments attempts on restart failure', () => {
		const machine = createRecoveryMachine();
		machine.recordCrash();
		machine.recordRestartFailure();
		expect(machine.restartAttempts).toBe(1);
		expect(machine.state).toBe('restart-failed');
	});

	it('throttles after max restart attempts', () => {
		const machine = createRecoveryMachine();
		machine.recordCrash();
		machine.recordRestartFailure();
		vi.advanceTimersByTime(5_000);
		machine.recordRestartFailure();
		vi.advanceTimersByTime(5_000);
		machine.recordRestartFailure();
		expect(machine.state).toBe('throttled');
		expect(machine.canRestart()).toBe(false);
	});

	it('respects cooldown between restart attempts', () => {
		const machine = createRecoveryMachine();
		machine.recordCrash();
		machine.recordRestartFailure();
		expect(machine.canRestart()).toBe(false);
		vi.advanceTimersByTime(5_000);
		expect(machine.canRestart()).toBe(true);
	});

	it('crash before ack transitions to crashed', () => {
		const machine = createRecoveryMachine();
		const state = machine.recordCrash();
		expect(state).toBe('crashed');
	});

	it('crash after committed edit preserves checkpoint', () => {
		const machine = createRecoveryMachine();
		const checkpoint = {
			projectDoc: {
				schemaVersion: 12 as const,
				projectId: 'test',
				savedAt: '',
				timeline: [],
				captionTracks: [],
				transitions: [],
				markers: [],
				sources: [],
				masterGain: 1
			},
			sourceStatuses: new Map([['source-1', 'ready' as const]]),
			revision: 1,
			activeExportSettings: null,
			createdAt: new Date().toISOString()
		};
		machine.setCheckpoint(checkpoint);
		machine.recordCrash();
		expect(machine.lastCheckpoint).toBe(checkpoint);
		expect(machine.lastCheckpoint?.revision).toBe(1);
	});

	it('reset clears all state', () => {
		const machine = createRecoveryMachine();
		machine.recordCrash();
		machine.recordRestartFailure();
		machine.reset();
		expect(machine.state).toBe('running');
		expect(machine.restartAttempts).toBe(0);
		expect(machine.lastCrashAt).toBeNull();
		expect(machine.lastCheckpoint).toBeNull();
	});

	it('repeated restart throttling stops at max', () => {
		const machine = createRecoveryMachine();
		for (let i = 0; i < 5; i++) {
			machine.recordCrash();
			machine.recordRestartFailure();
			vi.advanceTimersByTime(5_000);
		}
		expect(machine.state).toBe('throttled');
		expect(machine.restartAttempts).toBe(5);
		expect(machine.canRestart()).toBe(false);
	});

	it('init failure tracks as restart failure', () => {
		const machine = createRecoveryMachine();
		machine.recordCrash();
		const state = machine.recordRestartFailure();
		expect(state).toBe('restart-failed');
		expect(machine.restartAttempts).toBe(1);
	});
});
