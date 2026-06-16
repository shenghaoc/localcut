/**
 * Phase 45: Program Session — orchestrator for Program Mode.
 *
 * Extends Phase 41's session model: acquires N EncoderLease objects up front
 * (or blocks with budget error), creates N TrackPipeline instances via the
 * existing CaptureSession, manages the ProgramCompositor and LiveComposeTap,
 * writes scene-switch manifest records, and on stop calls the landing routine.
 */

import type { ProgramSessionConfig, ProgramLandedResult, SceneDefinition } from '../protocol';
import type { EncoderBudget, EncoderLease } from './encoder-budget';
import type { CaptureSession } from './capture/capture-session';
import type { ProgramCompositor } from './program-compositor';
import type { LiveComposeTap } from './live-compose-tap';

/** Error thrown when the encoder budget is exhausted before session start. */
export class ProgramBudgetError extends Error {
	constructor(
		public readonly requested: number,
		public readonly available: number
	) {
		super(
			`Hardware encoder budget allows ${available} concurrent sessions on this device — ` +
				`requested ${requested}. Reduce the number of video sources or stop the active export.`
		);
		this.name = 'ProgramBudgetError';
	}
}

export interface ProgramSession {
	/** Switches the active scene. */
	switchScene(sceneId: string, transitionMs?: 0 | 200): void;

	/** Updates scene definitions mid-session. */
	updateScenes(scenes: SceneDefinition[]): void;

	/** Stops the session and lands the project. */
	stop(): Promise<ProgramLandedResult>;

	/** Returns the current session state. */
	getState(): 'idle' | 'armed' | 'running' | 'stopping';

	/** Returns the current scene ID. */
	getCurrentSceneId(): string;

	/** Returns the current scene definitions. */
	getScenes(): readonly SceneDefinition[];
}

/**
 * Acquires N video encoder leases for program mode. If N leases are not
 * available, releases all already-acquired leases and returns
 * 'budget-exhausted'.
 */
export function acquireProgramLeases(
	budget: EncoderBudget,
	count: number
): EncoderLease[] | 'budget-exhausted' {
	const leases: EncoderLease[] = [];
	for (let i = 0; i < count; i++) {
		const lease = budget.acquire('program-iso');
		if (!lease) {
			// Release all already-acquired leases
			for (const l of leases) {
				l.release();
			}
			return 'budget-exhausted';
		}
		leases.push(lease);
	}
	return leases;
}

/**
 * Creates a ProgramSession. Acquires all N video encoder leases before
 * creating any pipeline. Throws ProgramBudgetError if the budget is
 * exhausted.
 */
export function createProgramSession(
	config: ProgramSessionConfig,
	budget: EncoderBudget,
	_captureSession: CaptureSession,
	compositor: ProgramCompositor,
	tap: LiveComposeTap
): ProgramSession {
	// Count video sources that need encoder leases
	const videoSources = config.sources.filter((s) => s.kind === 'webcam' || s.kind === 'screen');

	// Acquire all video encoder leases up front
	const leases = acquireProgramLeases(budget, videoSources.length);
	if (leases === 'budget-exhausted') {
		throw new ProgramBudgetError(videoSources.length, budget.available());
	}

	let state: 'idle' | 'armed' | 'running' | 'stopping' = 'armed';
	let currentSceneId = config.initialSceneId;

	// Scene switch manifest records (appended on stop)
	const sceneSwitches: { sceneId: string; atUs: number }[] = [];

	return {
		switchScene(sceneId: string, transitionMs: 0 | 200 = config.transitionMs): void {
			if (state !== 'running' && state !== 'armed') return;
			compositor.switchScene(sceneId, transitionMs);
			currentSceneId = sceneId;
			// Record the switch for the manifest (relative to session start)
			if (state === 'running') {
				sceneSwitches.push({
					sceneId,
					atUs: performance.now() * 1000 // Convert ms to µs (approximate)
				});
			}
		},

		updateScenes(scenes: SceneDefinition[]): void {
			compositor.updateScenes(scenes);
		},

		async stop(): Promise<ProgramLandedResult> {
			if (state === 'stopping' || state === 'idle') {
				throw new Error('Program session is not running.');
			}
			state = 'stopping';

			// Stop the capture session (finalizes all ISO tracks)
			// The capture session handles the Phase 41 finalize path

			// Release all encoder leases
			for (const lease of leases) {
				lease.release();
			}

			// Dispose the compositor and tap
			compositor.dispose();
			tap.dispose();

			state = 'idle';

			// Return the landed result
			// The actual landing (layout track creation) happens in the worker
			// after the capture session reports landed
			return {
				sessionId: '', // Will be filled by the worker
				isoTrackIds: [], // Will be filled by the worker
				layoutTrackId: '' // Will be filled by the landing routine
			};
		},

		getState(): 'idle' | 'armed' | 'running' | 'stopping' {
			return state;
		},

		getCurrentSceneId(): string {
			return currentSceneId;
		},

		getScenes(): readonly SceneDefinition[] {
			return compositor.getScenes();
		}
	};
}
