/**
 * Phase 45: Program Mode — scene model, validation, and compositor resolve.
 *
 * Pure data module: scene definitions, persistence/validation, and the
 * `resolveSceneAt` query that produces `CompositeLayer[]` for the GPU
 * compositor.
 */

import type { SceneDefinition, SceneDoc, SceneLayer, TransformParamsSnapshot } from '../protocol';
import type { CompositeLayer, FrameCompositeLayer, TextureCompositeLayer } from './gpu';
import { DEFAULT_TRANSFORM, normalizeTransform } from './transform';
import type { TransformParams, FitMode } from './transform';

export type { SceneDefinition, SceneDoc, SceneLayer };

/** Maximum number of scenes per project (hotkeys '1'–'9'). */
const MAX_SCENES = 9;

/** Valid hotkey values. */
const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

// ── Validation ──

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

function finiteNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeFitSnapshot(value: unknown): FitMode {
	return value === 'fit' || value === 'letterbox' || value === 'fill'
		? value
		: DEFAULT_TRANSFORM.fit;
}

function parseTransformParamsSnapshot(value: unknown): TransformParamsSnapshot | null {
	if (!isRecord(value)) return null;
	const x = finiteNumber(value.x);
	const y = finiteNumber(value.y);
	const scale = finiteNumber(value.scale);
	const rotation = finiteNumber(value.rotation);
	const opacity = finiteNumber(value.opacity);
	const anchorX = finiteNumber(value.anchorX);
	const anchorY = finiteNumber(value.anchorY);
	if (
		x === null ||
		y === null ||
		scale === null ||
		rotation === null ||
		opacity === null ||
		anchorX === null ||
		anchorY === null
	) {
		return null;
	}
	const fit = normalizeFitSnapshot(value.fit);
	return { x, y, scale, rotation, opacity, anchorX, anchorY, fit };
}

function parseSceneLayer(value: unknown): SceneLayer | null {
	if (!isRecord(value)) return null;
	const sourceRef = requiredString(value.sourceRef);
	if (sourceRef === null) return null;
	const transform = parseTransformParamsSnapshot(value.transform);
	if (transform === null) return null;
	const visible = typeof value.visible === 'boolean' ? value.visible : true;
	const zIndex = finiteNumber(value.zIndex);
	if (zIndex === null || zIndex < 0 || !Number.isInteger(zIndex)) return null;
	return { sourceRef, transform, visible, zIndex };
}

function parseSceneDefinition(value: unknown): SceneDefinition | null {
	if (!isRecord(value)) return null;
	const id = requiredString(value.id);
	if (id === null) return null;
	const name = requiredString(value.name);
	if (name === null) return null;
	const hotkey =
		value.hotkey === null
			? null
			: typeof value.hotkey === 'string' &&
				  HOTKEYS.includes(value.hotkey as (typeof HOTKEYS)[number])
				? (value.hotkey as (typeof HOTKEYS)[number])
				: null;
	if (!Array.isArray(value.layers)) return null;
	const layers: SceneLayer[] = [];
	for (const layer of value.layers) {
		const parsed = parseSceneLayer(layer);
		if (parsed === null) return null;
		layers.push(parsed);
	}
	return { id, name, hotkey, layers };
}

/**
 * Validates and returns a `SceneDoc` from an unknown value.
 * Returns `null` if the value is not a valid SceneDoc.
 */
export function validateSceneDoc(value: unknown): SceneDoc | null {
	if (!isRecord(value)) return null;
	const sceneSchemaVersion = finiteNumber(value.sceneSchemaVersion);
	if (sceneSchemaVersion !== 1) return null;
	if (!Array.isArray(value.scenes)) return null;
	if (value.scenes.length > MAX_SCENES) return null;
	const scenes: SceneDefinition[] = [];
	for (const scene of value.scenes) {
		const parsed = parseSceneDefinition(scene);
		if (parsed === null) return null;
		scenes.push(parsed);
	}
	return { sceneSchemaVersion: 1, scenes };
}

/**
 * Returns the first conflicting hotkey string if two scenes share the same
 * non-null hotkey, or `null` if no conflict exists.
 */
export function hotkeyConflict(scenes: SceneDefinition[]): string | null {
	const seen = new Map<string, string>();
	for (const scene of scenes) {
		if (scene.hotkey === null) continue;
		const existing = seen.get(scene.hotkey);
		if (existing !== undefined) return scene.hotkey;
		seen.set(scene.hotkey, scene.id);
	}
	return null;
}

// ── Scene resolve ──

/**
 * Converts a `TransformParamsSnapshot` (protocol type) to `TransformParams`
 * (engine type) with normalization.
 */
function snapshotToTransformParams(snapshot: TransformParamsSnapshot): TransformParams {
	return normalizeTransform({
		x: snapshot.x,
		y: snapshot.y,
		scale: snapshot.scale,
		rotation: snapshot.rotation,
		opacity: snapshot.opacity,
		anchorX: snapshot.anchorX,
		anchorY: snapshot.anchorY,
		fit: snapshot.fit
	});
}

/**
 * Resolves the ordered `CompositeLayer[]` for a scene at the current session
 * time. Layers are sorted ascending by `zIndex` (low = farther from viewer;
 * compositor renders low-to-high, so higher zIndex renders on top).
 *
 * Video-source layers produce `FrameCompositeLayer` entries using the frame
 * from the `frames` map. Still/title layers produce `TextureCompositeLayer`
 * entries using the view from the `stills` map. Layers with `visible: false`
 * or missing frames/stills are skipped.
 *
 * Identity `ClipEffectParams` (no colour grading on live sources in v1).
 */
export function resolveSceneAt(
	scenes: SceneDefinition[],
	sceneId: string,
	frames: ReadonlyMap<string, VideoFrame | null>,
	stills: ReadonlyMap<string, GPUTextureView>,
	sourceWidth: number,
	sourceHeight: number
): CompositeLayer[] {
	const scene = scenes.find((s) => s.id === sceneId);
	if (!scene) return [];

	// Sort by zIndex ascending (low zIndex = farther from viewer, rendered first)
	const sorted = [...scene.layers].filter((l) => l.visible).sort((a, b) => a.zIndex - b.zIndex);

	const layers: CompositeLayer[] = [];

	for (const layer of sorted) {
		const frame = frames.get(layer.sourceRef);
		if (frame != null) {
			// Video source — produce a FrameCompositeLayer
			const compositeLayer: FrameCompositeLayer = {
				kind: 'frame',
				frame,
				effects: {
					brightness: 0,
					contrast: 1,
					saturation: 1,
					temperature: 6500,
					temperatureStrength: 1,
					lutStrength: 0,
					skinSmoothStrength: 0,
					grainStrength: 0,
					grainSize: 0,
					halationThreshold: 0,
					halationRadius: 0,
					halationTintR: 0,
					halationTintG: 0,
					halationTintB: 0,
					vignetteAmount: 0,
					vignetteFeather: 0,
					vignetteRoundness: 0
				},
				transform: snapshotToTransformParams(layer.transform)
			};
			layers.push(compositeLayer);
			continue;
		}

		const view = stills.get(layer.sourceRef);
		if (view != null) {
			// Still/title source — produce a TextureCompositeLayer
			const compositeLayer: TextureCompositeLayer = {
				kind: 'texture',
				view,
				sourceWidth,
				sourceHeight,
				transform: snapshotToTransformParams(layer.transform)
			};
			layers.push(compositeLayer);
		}
		// If neither frame nor view exists, skip this layer
	}

	return layers;
}
