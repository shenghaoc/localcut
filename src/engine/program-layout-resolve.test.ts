import { describe, expect, it } from 'vite-plus/test';
import { applyProgramLayoutToResolvedLayers } from './program-layout-resolve';
import { defaultTimelineClip, type LayoutClip, type ResolveResult } from './timeline';

const transform = {
	x: 0,
	y: 0,
	scale: 1,
	rotation: 0,
	opacity: 1,
	anchorX: 0.5,
	anchorY: 0.5,
	fit: 'fill' as const
};

function layer(sourceId: string, trackId = `track-${sourceId}`): ResolveResult {
	return {
		trackId,
		sourceTime: 0,
		clip: defaultTimelineClip({
			id: `clip-${sourceId}`,
			sourceId,
			start: 0,
			duration: 5,
			inPoint: 0
		})
	};
}

function layoutClip(): LayoutClip {
	return {
		id: 'layout-1',
		kind: 'layout',
		startTime: 0,
		duration: 5,
		sceneId: 'scene-1',
		sceneSnapshot: {
			id: 'scene-1',
			name: 'Scene',
			hotkey: '1',
			layers: [
				{
					sourceRef: 'screen-1',
					transform: { ...transform, scale: 0.5 },
					visible: true,
					zIndex: 2
				},
				{ sourceRef: 'cam-1', transform: { ...transform, x: 0.25 }, visible: true, zIndex: 1 },
				{ sourceRef: 'hidden-1', transform, visible: false, zIndex: 0 }
			]
		}
	};
}

describe('applyProgramLayoutToResolvedLayers', () => {
	it('keeps normal resolve order when no layout clip is active', () => {
		const layers = [layer('cam-1'), layer('screen-1')];

		const arranged = applyProgramLayoutToResolvedLayers(layers, null);

		expect(arranged.map((entry) => entry.layer.clip.sourceId)).toEqual(['cam-1', 'screen-1']);
		expect(arranged.every((entry) => entry.layoutLayer === null)).toBe(true);
	});

	it('filters, orders, and annotates ISO layers from the scene snapshot', () => {
		const layers = [layer('screen-1'), layer('cam-1'), layer('hidden-1')];

		const arranged = applyProgramLayoutToResolvedLayers(layers, layoutClip());

		expect(arranged.map((entry) => entry.layer.clip.sourceId)).toEqual(['cam-1', 'screen-1']);
		expect(arranged.map((entry) => entry.layoutLayer?.transform.scale)).toEqual([1, 0.5]);
	});

	it('can match older layout refs against track id', () => {
		const layers = [layer('source-from-clip', 'legacy-track-ref')];
		const layout = layoutClip();
		layout.sceneSnapshot.layers = [
			{
				sourceRef: 'legacy-track-ref',
				transform: { ...transform, x: -0.2 },
				visible: true,
				zIndex: 0
			}
		];

		const arranged = applyProgramLayoutToResolvedLayers(layers, layout);

		expect(arranged).toHaveLength(1);
		expect(arranged[0]!.layoutLayer?.transform.x).toBe(-0.2);
	});

	it('prefers source id over colliding track id fallback', () => {
		const layers = [layer('camera', 'screen'), layer('screen', 'track-screen')];
		const layout = layoutClip();
		layout.sceneSnapshot.layers = [
			{
				sourceRef: 'screen',
				transform: { ...transform, x: 0.1 },
				visible: true,
				zIndex: 0
			}
		];

		const arranged = applyProgramLayoutToResolvedLayers(layers, layout);

		expect(arranged).toHaveLength(1);
		expect(arranged[0]!.layer.clip.sourceId).toBe('screen');
	});

	it('can reuse one source for duplicate scene layers', () => {
		const layers = [layer('camera')];
		const layout = layoutClip();
		layout.sceneSnapshot.layers = [
			{
				sourceRef: 'camera',
				transform: { ...transform, scale: 1 },
				visible: true,
				zIndex: 0
			},
			{
				sourceRef: 'camera',
				transform: { ...transform, scale: 0.35 },
				visible: true,
				zIndex: 1
			}
		];

		const arranged = applyProgramLayoutToResolvedLayers(layers, layout);

		expect(arranged).toHaveLength(2);
		expect(arranged.map((entry) => entry.layer.clip.sourceId)).toEqual(['camera', 'camera']);
		expect(arranged.map((entry) => entry.layoutLayer?.transform.scale)).toEqual([1, 0.35]);
	});
});
