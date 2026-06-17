/**
 * Phase 45: Program Landing — materialises the layout track from a completed
 * program session's manifest.
 *
 * Reads scene-switch records from the parsed manifest, builds contiguous
 * LayoutClip segments, and creates a new TimelineTrack of type 'layout'.
 */

import type { SceneDefinition } from '../protocol';
import type { CaptureManifestRecord } from './capture/chunk-manifest';
import type { LayoutClip, TimelineTrack } from './timeline';
import { defaultTimelineClip } from './timeline';
import { cloneSceneDefinition } from './project';

export interface ProgramLandingConfig {
	sessionId: string;
	scenes: SceneDefinition[];
	initialSceneId: string | undefined;
	initialSceneSnapshot?: SceneDefinition;
	epochUs: number;
	endUs: number;
}

export type ProgramSceneSwitchRecord = Extract<CaptureManifestRecord, { kind: 'scene-switch' }> & {
	sceneSnapshot?: SceneDefinition;
};

/**
 * Builds contiguous LayoutClip segments from scene-switch manifest records.
 *
 * Algorithm:
 * 1. Start with the initialSceneId at epochUs → first segment.
 * 2. For each scene-switch record: close the previous segment at
 *    atUs − epochUs, open a new one with sceneId.
 * 3. Close the last segment at endUs − epochUs.
 * 4. For each segment, create a LayoutClip with the SceneDefinition snapshot.
 */
export function buildLayoutClips(
	records: readonly (CaptureManifestRecord | ProgramSceneSwitchRecord)[],
	config: ProgramLandingConfig
): LayoutClip[] {
	const { scenes, initialSceneId, initialSceneSnapshot, epochUs, endUs } = config;

	// Extract scene-switch records in order
	const switches = records
		.filter((r): r is ProgramSceneSwitchRecord => r.kind === 'scene-switch')
		.sort((a, b) => a.atUs - b.atUs);

	// If no initial scene and no switches, no layout track
	if (!initialSceneId && switches.length === 0) return [];

	// Build segments
	const segments: {
		sceneId: string;
		startUs: number;
		endUs: number;
		sceneSnapshot?: SceneDefinition;
	}[] = [];
	let currentSceneId = initialSceneId ?? switches[0]?.sceneId ?? '';
	let currentSceneSnapshot =
		initialSceneSnapshot ?? scenes.find((scene) => scene.id === currentSceneId);
	let segmentStartUs = 0;

	for (const sw of switches) {
		const switchOffsetUs = Math.max(0, sw.atUs - epochUs);
		if (switchOffsetUs > segmentStartUs) {
			segments.push({
				sceneId: currentSceneId,
				startUs: segmentStartUs,
				endUs: switchOffsetUs,
				sceneSnapshot: currentSceneSnapshot
			});
		}
		currentSceneId = sw.sceneId;
		currentSceneSnapshot = sw.sceneSnapshot ?? scenes.find((scene) => scene.id === sw.sceneId);
		segmentStartUs = switchOffsetUs;
	}

	// Close the last segment
	const sessionEndUs = Math.max(0, endUs - epochUs);
	if (sessionEndUs > segmentStartUs) {
		segments.push({
			sceneId: currentSceneId,
			startUs: segmentStartUs,
			endUs: sessionEndUs,
			sceneSnapshot: currentSceneSnapshot
		});
	}

	// Convert to LayoutClip objects
	let clipIdCounter = 0;
	return segments
		.map((seg) => {
			const scene = seg.sceneSnapshot ?? scenes.find((s) => s.id === seg.sceneId);
			if (!scene || seg.endUs <= seg.startUs) return null;
			return {
				id: `layout-clip-${clipIdCounter++}`,
				kind: 'layout' as const,
				startTime: seg.startUs / 1_000_000,
				duration: (seg.endUs - seg.startUs) / 1_000_000,
				sceneId: seg.sceneId,
				sceneSnapshot: cloneSceneDefinition(scene)
			};
		})
		.filter((c): c is LayoutClip => c !== null);
}

/**
 * Creates a layout track from the built LayoutClips.
 * Returns the track, or null if no clips were built.
 */
export function createLayoutTrack(clips: LayoutClip[], trackId: string): TimelineTrack | null {
	if (clips.length === 0) return null;
	return {
		id: trackId,
		type: 'layout',
		clips: clips.map((clip) =>
			defaultTimelineClip({
				id: clip.id,
				sourceId: clip.sceneId,
				start: clip.startTime,
				duration: clip.duration,
				inPoint: 0
			})
		),
		gain: 1,
		pan: 0,
		muted: false,
		solo: false,
		locked: false,
		visible: true,
		syncLocked: false,
		editTarget: false,
		layoutClips: clips
	};
}

/**
 * Landing entry point: reads scene-switch records from the parsed manifest,
 * builds LayoutClip segments, and returns the layout track plus sidecar clips.
 */
export function landProgramSession(
	records: CaptureManifestRecord[],
	config: ProgramLandingConfig
): { layoutTrack: TimelineTrack | null; clips: LayoutClip[] } {
	const clips = buildLayoutClips(records, config);
	const layoutTrack = createLayoutTrack(clips, `layout-${config.sessionId}`);
	return { layoutTrack, clips };
}
