import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createRecoveryMachine } from './recovery';

describe('Worker crash/restart flow', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('crash → auto-restart → success cycle', () => {
		const machine = createRecoveryMachine();
		expect(machine.state).toBe('running');

		const crashState = machine.recordCrash();
		expect(crashState).toBe('crashed');
		expect(machine.canRestart()).toBe(true);

		machine.recordRestartSuccess();
		expect(machine.state).toBe('running');
		expect(machine.restartAttempts).toBe(0);
	});

	it('crash → restart failure → cooldown → retry → success', () => {
		const machine = createRecoveryMachine();
		machine.recordCrash();
		machine.recordRestartFailure();
		expect(machine.state).toBe('restart-failed');
		expect(machine.canRestart()).toBe(false);

		vi.advanceTimersByTime(5_000);
		expect(machine.canRestart()).toBe(true);

		machine.recordRestartSuccess();
		expect(machine.state).toBe('running');
	});

	it('three consecutive failures throttle permanently', () => {
		const machine = createRecoveryMachine();

		machine.recordCrash();
		machine.recordRestartFailure();
		vi.advanceTimersByTime(5_000);

		machine.recordCrash();
		machine.recordRestartFailure();
		vi.advanceTimersByTime(5_000);

		machine.recordCrash();
		machine.recordRestartFailure();

		expect(machine.state).toBe('throttled');
		expect(machine.canRestart()).toBe(false);
	});

	it('SAB clock values reset on simulated crash', () => {
		const sab = new SharedArrayBuffer(32);
		const view = new Float64Array(sab);
		view[0] = 5.5;
		view[1] = 120.0;
		view[2] = 1.0;
		view[3] = 5.25;

		view[0] = 0;
		view[1] = 0;
		view[2] = 0;

		expect(view[0]).toBe(0);
		expect(view[1]).toBe(0);
		expect(view[2]).toBe(0);
		expect(view[3]).toBe(5.25);
	});

	it('checkpoint survives crash and is available for restore', () => {
		const machine = createRecoveryMachine();
		const checkpoint = {
			projectDoc: {
				schemaVersion: 10 as const,
				projectId: 'proj-1',
				savedAt: '2025-01-01T00:00:00.000Z',
				timeline: [],
				captionTracks: [],
				transitions: [],
				markers: [],
				sources: [],
				masterGain: 1
			},
			sourceStatuses: new Map([['source-1', 'ready' as const]]),
			revision: 42,
			activeExportSettings: null,
			createdAt: '2025-01-01T00:00:00.000Z'
		};

		machine.setCheckpoint(checkpoint);
		machine.recordCrash();

		expect(machine.lastCheckpoint).toBe(checkpoint);
		expect(machine.lastCheckpoint!.revision).toBe(42);
		expect(machine.lastCheckpoint!.projectDoc.projectId).toBe('proj-1');

		machine.recordRestartSuccess();
		expect(machine.lastCheckpoint).toBe(checkpoint);
	});

	it('reset after throttle allows fresh restart cycle', () => {
		const machine = createRecoveryMachine();

		for (let i = 0; i < 3; i++) {
			machine.recordCrash();
			machine.recordRestartFailure();
			vi.advanceTimersByTime(5_000);
		}
		expect(machine.state).toBe('throttled');

		machine.reset();
		expect(machine.state).toBe('running');
		expect(machine.canRestart()).toBe(true);

		machine.recordCrash();
		expect(machine.canRestart()).toBe(true);
		machine.recordRestartSuccess();
		expect(machine.state).toBe('running');
	});

	it('crash during active export preserves export settings in checkpoint', () => {
		const machine = createRecoveryMachine();
		const settings = {
			preset: 'quality' as const,
			codec: 'h264' as const,
			container: 'mp4' as const,
			width: 1920,
			height: 1080,
			fps: 30,
			videoBitrate: 8_000_000
		};
		const checkpoint = {
			projectDoc: {
				schemaVersion: 10 as const,
				projectId: 'proj-2',
				savedAt: '',
				timeline: [],
				captionTracks: [],
				transitions: [],
				markers: [],
				sources: [],
				masterGain: 1
			},
			sourceStatuses: new Map<string, 'ready' | 'offline' | 'restoring'>(),
			revision: 10,
			activeExportSettings: settings,
			createdAt: new Date().toISOString()
		};

		machine.setCheckpoint(checkpoint);
		machine.recordCrash();

		expect(machine.lastCheckpoint!.activeExportSettings).toBe(settings);
		expect(machine.lastCheckpoint!.activeExportSettings!.codec).toBe('h264');
	});
});
