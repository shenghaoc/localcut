import { currentIsoTimestamp } from '../time';
import { describe, expect, it } from 'vite-plus/test';
import { createRecoveryMachine, type WorkerRecoveryMachine } from './recovery';

describe('GPU unavailable / device-lost recovery paths', () => {
	let machine: WorkerRecoveryMachine;

	function setupMachine() {
		machine = createRecoveryMachine();
	}

	it('no adapter: machine stays running (failure recorded elsewhere)', () => {
		setupMachine();
		expect(machine.state).toBe('running');
	});

	it('requestDevice rejection: can record crash and attempt restart', () => {
		setupMachine();
		const state = machine.recordCrash();
		expect(state).toBe('crashed');
		expect(machine.canRestart()).toBe(true);
	});

	it('device lost during preview: transitions to crashed', () => {
		setupMachine();
		machine.setCheckpoint({
			projectDoc: {
				schemaVersion: 20 as const,
				projectId: 'test-preview',
				savedAt: currentIsoTimestamp(),
				timeline: [],
				captionTracks: [],
				transitions: [],
				markers: [],
				sources: [],
				masterGain: 1
			},
			sourceStatuses: new Map(),
			revision: 5,
			activeExportSettings: null,
			createdAt: currentIsoTimestamp()
		});
		machine.recordCrash();
		expect(machine.state).toBe('crashed');
		expect(machine.lastCheckpoint?.revision).toBe(5);
	});

	it('device lost during export: checkpoint preserved for retry', () => {
		setupMachine();
		const exportSettings = {
			preset: 'quality' as const,
			codec: 'h264' as const,
			container: 'mp4' as const,
			width: 1920,
			height: 1080,
			fps: 30,
			videoBitrate: 5_000_000
		};
		machine.setCheckpoint({
			projectDoc: {
				schemaVersion: 20 as const,
				projectId: 'test-export',
				savedAt: currentIsoTimestamp(),
				timeline: [],
				captionTracks: [],
				transitions: [],
				markers: [],
				sources: [],
				masterGain: 1
			},
			sourceStatuses: new Map([['source-1', 'ready']]),
			revision: 3,
			activeExportSettings: exportSettings,
			createdAt: currentIsoTimestamp()
		});
		machine.recordCrash();
		expect(machine.lastCheckpoint?.activeExportSettings).toBe(exportSettings);
	});

	it('retry success after device lost restores running state', () => {
		setupMachine();
		machine.recordCrash();
		machine.recordRestartSuccess();
		expect(machine.state).toBe('running');
	});

	it('retry failure after device lost increments attempts', () => {
		setupMachine();
		machine.recordCrash();
		machine.recordRestartFailure();
		expect(machine.restartAttempts).toBe(1);
		expect(machine.state).toBe('restart-failed');
	});

	it('export item failed is retryable after recovery', () => {
		let now = 0;
		machine = createRecoveryMachine(() => now);
		machine.recordCrash();
		machine.recordRestartFailure();
		now = 5_000;
		expect(machine.canRestart()).toBe(true);
	});
});
