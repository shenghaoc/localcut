import type { LayoutClip, ResolveResult } from './timeline';

export interface LayoutResolvedLayer {
	layer: ResolveResult;
	layoutLayer: LayoutClip['sceneSnapshot']['layers'][number] | null;
}

/**
 * Applies a Program Mode layout clip to the resolved ISO layers for a timestamp.
 *
 * The ISO clips still provide frames, effects, transitions, and timing; the
 * layout clip supplies visibility, z-order, and transform from the recorded
 * scene snapshot. `sourceRef` is matched against the decoded clip's source id,
 * falling back to track id for older fixture data.
 */
export function applyProgramLayoutToResolvedLayers(
	layers: readonly ResolveResult[],
	layoutClip: LayoutClip | null
): LayoutResolvedLayer[] {
	if (!layoutClip) return layers.map((layer) => ({ layer, layoutLayer: null }));

	const bySourceId = new Map<string, ResolveResult[]>();
	const byTrackId = new Map<string, ResolveResult[]>();
	for (const layer of layers) {
		pushLayer(bySourceId, layer.clip.sourceId, layer);
		pushLayer(byTrackId, layer.trackId, layer);
	}

	const usedTrackFallbacks = new Set<ResolveResult>();
	const ordered: LayoutResolvedLayer[] = [];
	const sceneLayers = [...layoutClip.sceneSnapshot.layers]
		.filter((layer) => layer.visible)
		.sort((a, b) => a.zIndex - b.zIndex);

	for (const sceneLayer of sceneLayers) {
		const sourceMatch = bySourceId.get(sceneLayer.sourceRef)?.[0] ?? null;
		const trackMatch =
			sourceMatch === null
				? (byTrackId.get(sceneLayer.sourceRef) ?? []).find(
						(layer) => !usedTrackFallbacks.has(layer)
					)
				: null;
		const candidate = sourceMatch ?? trackMatch;
		if (!candidate) continue;
		if (trackMatch) usedTrackFallbacks.add(trackMatch);
		ordered.push({ layer: candidate, layoutLayer: sceneLayer });
	}

	return ordered;
}

function pushLayer(map: Map<string, ResolveResult[]>, key: string, layer: ResolveResult): void {
	if (key.length === 0) return;
	const existing = map.get(key);
	if (existing) {
		existing.push(layer);
		return;
	}
	map.set(key, [layer]);
}
