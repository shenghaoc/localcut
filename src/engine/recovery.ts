import { currentIsoTimestamp, monotonicNowMs } from '../time';
import type { ProjectDoc } from './project';
import type { ExportSettings } from '../protocol';

export type WorkerRecoveryState =
	| 'running'
	| 'crashed'
	| 'restarting'
	| 'restart-failed'
	| 'throttled';

export interface RecoveryCheckpoint {
	readonly projectDoc: ProjectDoc;
	readonly sourceStatuses: ReadonlyMap<string, 'ready' | 'offline' | 'restoring'>;
	readonly revision: number;
	readonly activeExportSettings: ExportSettings | null;
	readonly createdAt: string;
}

const MAX_RESTART_ATTEMPTS = 3;
const RESTART_COOLDOWN_MS = 5_000;

export interface WorkerRecoveryMachine {
	readonly state: WorkerRecoveryState;
	readonly restartAttempts: number;
	readonly lastCrashAt: string | null;
	readonly lastCheckpoint: RecoveryCheckpoint | null;
	canRestart(): boolean;
	recordCrash(): WorkerRecoveryState;
	recordRestartSuccess(): void;
	recordRestartFailure(): WorkerRecoveryState;
	setCheckpoint(checkpoint: RecoveryCheckpoint): void;
	reset(): void;
}

export function createRecoveryMachine(nowMs: () => number = monotonicNowMs): WorkerRecoveryMachine {
	let state: WorkerRecoveryState = 'running';
	let restartAttempts = 0;
	let lastCrashAt: string | null = null;
	let lastCheckpoint: RecoveryCheckpoint | null = null;
	let lastRestartTimestamp = Number.NEGATIVE_INFINITY;

	const machine: WorkerRecoveryMachine = {
		get state() {
			return state;
		},
		get restartAttempts() {
			return restartAttempts;
		},
		get lastCrashAt() {
			return lastCrashAt;
		},
		get lastCheckpoint() {
			return lastCheckpoint;
		},

		canRestart(): boolean {
			if (restartAttempts >= MAX_RESTART_ATTEMPTS) return false;
			const elapsed = nowMs() - lastRestartTimestamp;
			return elapsed >= RESTART_COOLDOWN_MS;
		},

		recordCrash(): WorkerRecoveryState {
			lastCrashAt = currentIsoTimestamp();
			if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
				state = 'throttled';
			} else {
				state = 'crashed';
			}
			return state;
		},

		recordRestartSuccess(): void {
			state = 'running';
		},

		recordRestartFailure(): WorkerRecoveryState {
			restartAttempts++;
			lastRestartTimestamp = nowMs();
			if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
				state = 'throttled';
			} else {
				state = 'restart-failed';
			}
			return state;
		},

		setCheckpoint(checkpoint: RecoveryCheckpoint): void {
			lastCheckpoint = checkpoint;
		},

		reset(): void {
			state = 'running';
			restartAttempts = 0;
			lastCrashAt = null;
			lastCheckpoint = null;
			lastRestartTimestamp = Number.NEGATIVE_INFINITY;
		}
	};

	return machine;
}
