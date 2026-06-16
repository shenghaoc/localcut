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
import { landProgramSession } from './program-landing';
import type { CaptureManifestRecord } from './capture/chunk-manifest';
import { DEFAULT_TRACK_MIX, defaultTimelineClip, type TimelineTrack } from './timeline';

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
	/** Starts ISO capture and live composition. */
	start(): Promise<void>;

	/** Switches the active scene. */
	switchScene(sceneId: string, transitionMs?: 0 | 200): void;

	/** Updates scene definitions mid-session. */
	updateScenes(scenes: SceneDefinition[]): void;

	/** Stops the session and lands the project. */
	stop(): Promise<ProgramStopResult>;

	/** Returns the current session state. */
	getState(): 'idle' | 'armed' | 'running' | 'stopping';

	/** Returns the current scene ID. */
	getCurrentSceneId(): string;

	/** Returns the current scene definitions. */
	getScenes(): readonly SceneDefinition[];
}

export interface ProgramStopResult extends ProgramLandedResult {
	isoTracks: TimelineTrack[];
	layoutTrack: TimelineTrack | null;
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
	captureSession: CaptureSession,
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
	const activeLeases: EncoderLease[] = leases;

	let state: 'idle' | 'armed' | 'running' | 'stopping' = 'armed';
	let currentSceneId = config.initialSceneId;
	let scenes = [...config.scenes];
	let startUs: number | null = null;
	let leasesReleased = false;
	let disposed = false;

	// Scene switch manifest records (appended on stop)
	const sceneSwitches: Array<{ kind: 'scene-switch'; sceneId: string; atUs: number }> = [];

	function releaseLeases(): void {
		if (leasesReleased) return;
		leasesReleased = true;
		for (const lease of activeLeases) {
			lease.release();
		}
	}

	function disposeLivePipeline(): void {
		if (disposed) return;
		disposed = true;
		compositor.dispose();
		tap.dispose();
	}

	return {
		async start(): Promise<void> {
			if (state !== 'armed') {
				throw new Error('Program session is not armed.');
			}
			startUs = Math.round(performance.now() * 1000);
			compositor.switchScene(config.initialSceneId, 0);
			await captureSession.start(config.chunkTargetS);
			state = 'running';
		},

		switchScene(sceneId: string, transitionMs: 0 | 200 = config.transitionMs): void {
			if (state !== 'running' && state !== 'armed') return;
			compositor.switchScene(sceneId, transitionMs);
			currentSceneId = sceneId;
			// Record the switch for the manifest (relative to session start)
			if (state === 'running') {
				const atUs = Math.round(performance.now() * 1000);
				const record = {
					kind: 'scene-switch' as const,
					sceneId,
					atUs
				};
				sceneSwitches.push(record);
				captureSession.appendSceneSwitch(sceneId, atUs);
			}
		},

		updateScenes(nextScenes: SceneDefinition[]): void {
			const next = [...nextScenes];
			compositor.updateScenes(next);
			scenes = next;
		},

		async stop(): Promise<ProgramStopResult> {
			if (state === 'stopping' || state === 'idle') {
				throw new Error('Program session is not running.');
			}
			state = 'stopping';
			const endUs = Math.max(Math.round(performance.now() * 1000), startUs ?? 0);

			try {
				await captureSession.stop('user-stop');
			} finally {
				releaseLeases();
				disposeLivePipeline();
				state = 'idle';
			}

			const epochUs = startUs ?? endUs;
			const durationS = Math.max(0.001, (endUs - epochUs) / 1_000_000);
			const sourceSnapshots = captureSession.getSourceSnapshots();
			const isoTracks = sourceSnapshots.map((source) => ({
				id: `iso-${captureSession.sessionId}-${source.sourceId}`,
				type:
					source.kind === 'screen' || source.kind === 'webcam'
						? ('video' as const)
						: ('audio' as const),
				clips: [
					defaultTimelineClip({
						id: `clip-${captureSession.sessionId}-${source.sourceId}`,
						sourceId: source.sourceId,
						start: 0,
						duration: durationS,
						inPoint: 0
					})
				],
				...DEFAULT_TRACK_MIX,
				editTarget: false
			}));
			const { layoutTrack } = landProgramSession(sceneSwitches as CaptureManifestRecord[], {
				sessionId: captureSession.sessionId,
				scenes,
				initialSceneId: config.initialSceneId,
				epochUs,
				endUs
			});

			return {
				sessionId: captureSession.sessionId,
				isoTrackIds: isoTracks.map((track) => track.id),
				layoutTrackId: layoutTrack?.id ?? '',
				isoTracks,
				layoutTrack
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
