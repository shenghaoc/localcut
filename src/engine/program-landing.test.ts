/**
 * Phase 45: Program Landing — unit tests for layout track construction.
 */

import { describe, it, expect } from 'vite-plus/test';
import { buildLayoutClips, createLayoutTrack } from './program-landing';
import type { CaptureManifestRecord } from './capture/chunk-manifest';
import type { SceneDefinition } from '../protocol';

const scenes: SceneDefinition[] = [
	{
		id: 'scene-1',
		name: 'Wide',
		hotkey: '1',
		layers: [
			{
				sourceRef: 'cam-1',
				transform: {
					x: 0,
					y: 0,
					scale: 1,
					rotation: 0,
					opacity: 1,
					anchorX: 0.5,
					anchorY: 0.5,
					fit: 'fill'
				},
				visible: true,
				zIndex: 0
			}
		]
	},
	{
		id: 'scene-2',
		name: 'Close-up',
		hotkey: '2',
		layers: [
			{
				sourceRef: 'cam-1',
				transform: {
					x: 0,
					y: 0,
					scale: 2,
					rotation: 0,
					opacity: 1,
					anchorX: 0.5,
					anchorY: 0.5,
					fit: 'fill'
				},
				visible: true,
				zIndex: 0
			}
		]
	}
];

describe('buildLayoutClips', () => {
	it('builds clips from scene-switch records', () => {
		const records: CaptureManifestRecord[] = [
			{ kind: 'scene-switch', sceneId: 'scene-2', atUs: 5_300_000 },
			{ kind: 'scene-switch', sceneId: 'scene-1', atUs: 9_800_000 }
		];
		const config = {
			sessionId: 'test',
			scenes,
			initialSceneId: 'scene-1',
			epochUs: 0,
			endUs: 15_000_000
		};
		const clips = buildLayoutClips(records, config);

		// 4 segments: scene-1 (0-5.3s), scene-2 (5.3-9.8s), scene-1 (9.8-15s)
		// But with 2 switches we get 3 segments
		expect(clips).toHaveLength(3);

		expect(clips[0].sceneId).toBe('scene-1');
		expect(clips[0].startTime).toBe(0);
		expect(clips[0].duration).toBeCloseTo(5.3);

		expect(clips[1].sceneId).toBe('scene-2');
		expect(clips[1].startTime).toBeCloseTo(5.3);
		expect(clips[1].duration).toBeCloseTo(4.5);

		expect(clips[2].sceneId).toBe('scene-1');
		expect(clips[2].startTime).toBeCloseTo(9.8);
		expect(clips[2].duration).toBeCloseTo(5.2);
	});

	it('returns one clip when no switches', () => {
		const records: CaptureManifestRecord[] = [];
		const config = {
			sessionId: 'test',
			scenes,
			initialSceneId: 'scene-1',
			epochUs: 0,
			endUs: 10_000_000
		};
		const clips = buildLayoutClips(records, config);

		expect(clips).toHaveLength(1);
		expect(clips[0].sceneId).toBe('scene-1');
		expect(clips[0].startTime).toBe(0);
		expect(clips[0].duration).toBeCloseTo(10);
	});

	it('returns empty when no initial scene and no switches', () => {
		const records: CaptureManifestRecord[] = [];
		const config = {
			sessionId: 'test',
			scenes,
			initialSceneId: undefined,
			epochUs: 0,
			endUs: 10_000_000
		};
		const clips = buildLayoutClips(records, config);

		expect(clips).toHaveLength(0);
	});

	it('applies epoch offset correctly', () => {
		const records: CaptureManifestRecord[] = [
			{ kind: 'scene-switch', sceneId: 'scene-2', atUs: 5_344_000 }
		];
		const config = {
			sessionId: 'test',
			scenes,
			initialSceneId: 'scene-1',
			epochUs: 0,
			endUs: 10_000_000
		};
		const clips = buildLayoutClips(records, config);

		expect(clips).toHaveLength(2);
		expect(clips[0].duration).toBeCloseTo(5.344);
		expect(clips[1].startTime).toBeCloseTo(5.344);
	});

	it('skips clips for unknown scenes', () => {
		const records: CaptureManifestRecord[] = [
			{ kind: 'scene-switch', sceneId: 'unknown', atUs: 5_000_000 }
		];
		const config = {
			sessionId: 'test',
			scenes,
			initialSceneId: 'scene-1',
			epochUs: 0,
			endUs: 10_000_000
		};
		const clips = buildLayoutClips(records, config);

		// First clip (scene-1) is valid, second clip (unknown) is skipped
		expect(clips).toHaveLength(1);
		expect(clips[0].sceneId).toBe('scene-1');
	});

	it('preserves sceneSnapshot in clips', () => {
		const records: CaptureManifestRecord[] = [];
		const config = {
			sessionId: 'test',
			scenes,
			initialSceneId: 'scene-1',
			epochUs: 0,
			endUs: 10_000_000
		};
		const clips = buildLayoutClips(records, config);

		expect(clips).toHaveLength(1);
		expect(clips[0].sceneSnapshot).toEqual(scenes[0]);
	});
});

describe('createLayoutTrack', () => {
	it('creates a track from clips', () => {
		const clips = [
			{
				id: 'clip-0',
				kind: 'layout' as const,
				startTime: 0,
				duration: 10,
				sceneId: 'scene-1',
				sceneSnapshot: scenes[0]
			}
		];
		const track = createLayoutTrack(clips, 'layout-test');

		expect(track).not.toBeNull();
		expect(track!.type).toBe('layout');
		expect(track!.id).toBe('layout-test');
		expect(track!.layoutClips).toEqual(clips);
	});

	it('returns null for empty clips', () => {
		const track = createLayoutTrack([], 'layout-test');
		expect(track).toBeNull();
	});
});
