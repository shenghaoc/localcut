/**
 * Phase 45: Program Compositor — wraps the Phase 12 GPU compositor with
 * live-source frame management for Program Mode.
 *
 * Holds the most recent VideoFrame clone per source. On each compositor tick,
 * builds the CompositeLayer[] from the current scene definition and calls the
 * existing PreviewRenderer's present() method. Frames are NOT closed inside
 * renderTick — they are held open and reused across ticks until replaced by a
 * newer frame or until dispose().
 *
 * Scene switching updates only the currentSceneId; no pipeline rebuild, no
 * texture reallocation, no encoder restart occurs (R5.1).
 */

import type { SceneDefinition } from '../protocol';
import type { CompositeLayer, PreviewRenderer } from './gpu';
import { resolveSceneAt } from './program-scenes';

export interface ProgramCompositorConfig {
	/** The existing PreviewRenderer instance from the pipeline worker. */
	renderer: PreviewRenderer;
	/** Initial scene definitions. */
	scenes: SceneDefinition[];
	/** Default source dimensions for resolveSceneAt. */
	sourceWidth: number;
	sourceHeight: number;
}

export interface ProgramCompositor {
	/** Updates the held frame for a source (called by LiveComposeTap). */
	updateFrame(sourceId: string, frame: VideoFrame): void;

	/** Switches the active scene. */
	switchScene(sceneId: string, transitionMs: 0 | 200): void;

	/** Updates scene definitions mid-session. */
	updateScenes(scenes: SceneDefinition[]): void;

	/**
	 * Called once per render tick. Builds CompositeLayer[] from the current
	 * scene and calls the renderer's present() method. Frames are held open
	 * across ticks — they are NOT closed here.
	 */
	renderTick(): void;

	/** Returns the current scene ID. */
	getCurrentSceneId(): string;

	/** Returns the current scene definitions. */
	getScenes(): readonly SceneDefinition[];

	/** Whether a crossfade transition still needs render ticks. */
	hasActiveTransition(): boolean;

	/** Disposes the compositor, closing all held frames. */
	dispose(): void;
}

export function createProgramCompositor(config: ProgramCompositorConfig): ProgramCompositor {
	const { renderer, sourceWidth, sourceHeight } = config;
	let scenes = [...config.scenes];
	let currentSceneId = config.scenes[0]?.id ?? '';

	/** Most recent frame per source. Frames are held until replaced or dispose. */
	const frames = new Map<string, VideoFrame>();

	/** Still/title GPUTextureView per source. */
	const stills = new Map<string, GPUTextureView>();

	/** Transition state for eased opacity crossfade. */
	let transitionStart = 0;
	let outgoingSceneId = '';
	let transitionMs: 0 | 200 = 0;
	let nextLayerObjectKey = 0;
	let disposed = false;
	const layerObjectKeys = new WeakMap<object, string>();

	function layerObjectKey(object: object): string {
		let key = layerObjectKeys.get(object);
		if (!key) {
			key = String(nextLayerObjectKey++);
			layerObjectKeys.set(object, key);
		}
		return key;
	}

	function layerSourceKey(layer: CompositeLayer): string {
		if (layer.kind === 'frame') return `frame:${layerObjectKey(layer.frame)}`;
		if (layer.kind === 'texture') return `texture:${layerObjectKey(layer.view)}`;
		return `${layer.kind}:${layerObjectKey(layer)}`;
	}

	function withOpacity(layer: CompositeLayer, opacity: number): CompositeLayer {
		return {
			...layer,
			transform: {
				...layer.transform,
				opacity
			}
		};
	}

	function buildLayers(): CompositeLayer[] {
		// Apply eased opacity during transition window
		const layers = resolveSceneAt(
			scenes,
			currentSceneId,
			frames,
			stills,
			sourceWidth,
			sourceHeight
		);

		if (transitionMs === 200 && outgoingSceneId) {
			const elapsed = performance.now() - transitionStart;
			if (elapsed < 200) {
				// Lerp opacity between outgoing and incoming
				const t = elapsed / 200;
				const outgoingLayers = resolveSceneAt(
					scenes,
					outgoingSceneId,
					frames,
					stills,
					sourceWidth,
					sourceHeight
				);
				const incomingKeys = new Set(layers.map(layerSourceKey));
				const outgoingOnly = outgoingLayers
					.filter((layer) => !incomingKeys.has(layerSourceKey(layer)))
					.map((layer) => withOpacity(layer, layer.transform.opacity * (1 - t)));
				const blendedIncoming = layers.map((layer) => {
					const outgoing = outgoingLayers.find(
						(candidate) => layerSourceKey(candidate) === layerSourceKey(layer)
					);
					const opacity = outgoing
						? outgoing.transform.opacity * (1 - t) + layer.transform.opacity * t
						: layer.transform.opacity * t;
					return withOpacity(layer, opacity);
				});
				return [...outgoingOnly, ...blendedIncoming];
			} else {
				// Transition complete
				transitionMs = 0;
				outgoingSceneId = '';
			}
		}

		return layers;
	}

	function hasActiveTransition(): boolean {
		return (
			transitionMs === 200 &&
			outgoingSceneId.length > 0 &&
			performance.now() - transitionStart < 200
		);
	}

	return {
		updateFrame(sourceId: string, frame: VideoFrame): void {
			if (disposed) {
				frame.close();
				return;
			}
			// Close the previous held frame for this source (latest-frame-wins)
			const prev = frames.get(sourceId);
			if (prev) {
				prev.close();
			}
			frames.set(sourceId, frame);
		},

		switchScene(sceneId: string, ms: 0 | 200): void {
			if (disposed) return;
			if (sceneId === currentSceneId) return;
			if (ms === 200) {
				transitionStart = performance.now();
				outgoingSceneId = currentSceneId;
				transitionMs = 200;
			} else {
				transitionMs = 0;
				outgoingSceneId = '';
			}
			currentSceneId = sceneId;
		},

		updateScenes(newScenes: SceneDefinition[]): void {
			if (disposed) return;
			scenes = [...newScenes];
		},

		renderTick(): void {
			if (disposed) return;
			const layers = buildLayers();
			// Use the existing PreviewRenderer's present() method.
			// This handles the single queue.submit per frame.
			// Frames are NOT closed here — they are held across ticks.
			renderer.present(layers);
		},

		getCurrentSceneId(): string {
			return currentSceneId;
		},

		getScenes(): readonly SceneDefinition[] {
			return scenes;
		},

		hasActiveTransition,

		dispose(): void {
			if (disposed) return;
			disposed = true;
			// Close all held frames
			for (const frame of frames.values()) {
				frame.close();
			}
			frames.clear();
			stills.clear();
		}
	};
}
