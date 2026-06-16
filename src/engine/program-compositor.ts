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
				// Merge opacity: for each layer, lerp between outgoing and incoming opacity
				for (const layer of layers) {
					const outgoing = outgoingLayers.find((l) => l.transform === layer.transform);
					if (outgoing) {
						layer.transform = {
							...layer.transform,
							opacity: outgoing.transform.opacity * (1 - t) + layer.transform.opacity * t
						};
					}
				}
			} else {
				// Transition complete
				transitionMs = 0;
				outgoingSceneId = '';
			}
		}

		return layers;
	}

	return {
		updateFrame(sourceId: string, frame: VideoFrame): void {
			// Close the previous held frame for this source (latest-frame-wins)
			const prev = frames.get(sourceId);
			if (prev) {
				prev.close();
			}
			frames.set(sourceId, frame);
		},

		switchScene(sceneId: string, ms: 0 | 200): void {
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
			scenes = [...newScenes];
		},

		renderTick(): void {
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

		dispose(): void {
			// Close all held frames
			for (const frame of frames.values()) {
				frame.close();
			}
			frames.clear();
			stills.clear();
		}
	};
}
