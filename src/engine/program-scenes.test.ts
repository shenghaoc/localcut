/**
 * Phase 45: Program Scenes — unit tests for validation, hotkey conflict
 * detection, and scene resolution.
 */

import { describe, it, expect } from 'vite-plus/test';
import {
	validateSceneDoc,
	hotkeyConflict,
	resolveSceneAt,
	type SceneDefinition,
	type SceneDoc
} from './program-scenes';

// ── Validation ──

describe('validateSceneDoc', () => {
	it('accepts a valid SceneDoc', () => {
		const doc: SceneDoc = {
			sceneSchemaVersion: 1,
			scenes: [
				{
					id: 'scene-1',
					name: 'Wide shot',
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
				}
			]
		};
		expect(validateSceneDoc(doc)).toEqual(doc);
	});

	it('rejects non-object', () => {
		expect(validateSceneDoc(null)).toBeNull();
		expect(validateSceneDoc(42)).toBeNull();
		expect(validateSceneDoc('string')).toBeNull();
	});

	it('rejects wrong schema version', () => {
		expect(validateSceneDoc({ sceneSchemaVersion: 2, scenes: [] })).toBeNull();
		expect(validateSceneDoc({ sceneSchemaVersion: 0, scenes: [] })).toBeNull();
	});

	it('rejects missing scenes array', () => {
		expect(validateSceneDoc({ sceneSchemaVersion: 1 })).toBeNull();
		expect(validateSceneDoc({ sceneSchemaVersion: 1, scenes: 'not-array' })).toBeNull();
	});

	it('rejects more than 9 scenes', () => {
		const scenes = Array.from({ length: 10 }, (_, i) => ({
			id: `scene-${i}`,
			name: `Scene ${i}`,
			hotkey: null,
			layers: []
		}));
		expect(validateSceneDoc({ sceneSchemaVersion: 1, scenes })).toBeNull();
	});

	it('rejects scene with missing id', () => {
		const doc = {
			sceneSchemaVersion: 1,
			scenes: [{ name: 'Scene', hotkey: null, layers: [] }]
		};
		expect(validateSceneDoc(doc)).toBeNull();
	});

	it('rejects scene with missing name', () => {
		const doc = {
			sceneSchemaVersion: 1,
			scenes: [{ id: 's1', hotkey: null, layers: [] }]
		};
		expect(validateSceneDoc(doc)).toBeNull();
	});

	it('accepts invalid hotkey as null (coerced)', () => {
		const doc = {
			sceneSchemaVersion: 1,
			scenes: [{ id: 's1', name: 'Scene', hotkey: 'a', layers: [] }]
		};
		const result = validateSceneDoc(doc);
		expect(result).not.toBeNull();
		expect(result!.scenes[0].hotkey).toBeNull();
	});

	it('accepts null hotkey', () => {
		const doc = {
			sceneSchemaVersion: 1,
			scenes: [{ id: 's1', name: 'Scene', hotkey: null, layers: [] }]
		};
		expect(validateSceneDoc(doc)).not.toBeNull();
	});

	it('rejects layer with missing sourceRef', () => {
		const doc = {
			sceneSchemaVersion: 1,
			scenes: [
				{
					id: 's1',
					name: 'Scene',
					hotkey: null,
					layers: [
						{
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
				}
			]
		};
		expect(validateSceneDoc(doc)).toBeNull();
	});

	it('rejects layer with negative zIndex', () => {
		const doc = {
			sceneSchemaVersion: 1,
			scenes: [
				{
					id: 's1',
					name: 'Scene',
					hotkey: null,
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
							zIndex: -1
						}
					]
				}
			]
		};
		expect(validateSceneDoc(doc)).toBeNull();
	});

	it('accepts layer with missing visible (defaults to true)', () => {
		const doc = {
			sceneSchemaVersion: 1,
			scenes: [
				{
					id: 's1',
					name: 'Scene',
					hotkey: null,
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
							zIndex: 0
						}
					]
				}
			]
		};
		const result = validateSceneDoc(doc);
		expect(result).not.toBeNull();
		expect(result!.scenes[0].layers[0].visible).toBe(true);
	});
});

// ── Hotkey conflict ──

describe('hotkeyConflict', () => {
	it('returns null for no conflicts', () => {
		const scenes: SceneDefinition[] = [
			{ id: 's1', name: 'Scene 1', hotkey: '1', layers: [] },
			{ id: 's2', name: 'Scene 2', hotkey: '2', layers: [] },
			{ id: 's3', name: 'Scene 3', hotkey: null, layers: [] }
		];
		expect(hotkeyConflict(scenes)).toBeNull();
	});

	it('returns the conflicting hotkey', () => {
		const scenes: SceneDefinition[] = [
			{ id: 's1', name: 'Scene 1', hotkey: '1', layers: [] },
			{ id: 's2', name: 'Scene 2', hotkey: '1', layers: [] }
		];
		expect(hotkeyConflict(scenes)).toBe('1');
	});

	it('ignores null hotkeys', () => {
		const scenes: SceneDefinition[] = [
			{ id: 's1', name: 'Scene 1', hotkey: null, layers: [] },
			{ id: 's2', name: 'Scene 2', hotkey: null, layers: [] }
		];
		expect(hotkeyConflict(scenes)).toBeNull();
	});
});

// ── Resolve scene ──

describe('resolveSceneAt', () => {
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
				},
				{
					sourceRef: 'cam-2',
					transform: {
						x: 0.5,
						y: 0,
						scale: 0.5,
						rotation: 0,
						opacity: 1,
						anchorX: 0.5,
						anchorY: 0.5,
						fit: 'fill'
					},
					visible: true,
					zIndex: 1
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
				},
				{
					sourceRef: 'cam-2',
					transform: {
						x: 0,
						y: 0,
						scale: 1,
						rotation: 0,
						opacity: 0,
						anchorX: 0.5,
						anchorY: 0.5,
						fit: 'fill'
					},
					visible: false,
					zIndex: 1
				}
			]
		}
	];

	it('returns empty array for unknown scene', () => {
		const frames = new Map<string, VideoFrame | null>();
		const stills = new Map<string, GPUTextureView>();
		expect(resolveSceneAt(scenes, 'unknown', frames, stills, 1920, 1080)).toEqual([]);
	});

	it('skips layers with missing frames', () => {
		const frames = new Map<string, VideoFrame | null>();
		const stills = new Map<string, GPUTextureView>();
		// cam-1 has a frame, cam-2 does not
		frames.set('cam-1', {} as VideoFrame);
		const layers = resolveSceneAt(scenes, 'scene-1', frames, stills, 1920, 1080);
		expect(layers).toHaveLength(1);
		expect(layers[0].transform.x).toBe(0);
	});

	it('skips invisible layers', () => {
		const frames = new Map<string, VideoFrame | null>();
		const stills = new Map<string, GPUTextureView>();
		frames.set('cam-1', {} as VideoFrame);
		frames.set('cam-2', {} as VideoFrame);
		// scene-2 has cam-2 as invisible
		const layers = resolveSceneAt(scenes, 'scene-2', frames, stills, 1920, 1080);
		expect(layers).toHaveLength(1);
		expect(layers[0].transform.scale).toBe(2);
	});

	it('sorts layers by zIndex ascending', () => {
		const frames = new Map<string, VideoFrame | null>();
		const stills = new Map<string, GPUTextureView>();
		frames.set('cam-1', {} as VideoFrame);
		frames.set('cam-2', {} as VideoFrame);
		const layers = resolveSceneAt(scenes, 'scene-1', frames, stills, 1920, 1080);
		expect(layers).toHaveLength(2);
		// zIndex 0 = cam-1, zIndex 1 = cam-2
		expect(layers[0].transform.x).toBe(0);
		expect(layers[1].transform.x).toBe(0.5);
	});

	it('handles still/title sources', () => {
		const frames = new Map<string, VideoFrame | null>();
		const stills = new Map<string, GPUTextureView>();
		stills.set('still-1', {} as GPUTextureView);
		const scenesWithStill: SceneDefinition[] = [
			{
				id: 'scene-still',
				name: 'Still',
				hotkey: null,
				layers: [
					{
						sourceRef: 'still-1',
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
			}
		];
		const layers = resolveSceneAt(scenesWithStill, 'scene-still', frames, stills, 1920, 1080);
		expect(layers).toHaveLength(1);
		expect(layers[0].kind).toBe('texture');
	});
});
