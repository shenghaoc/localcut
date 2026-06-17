import { describe, expect, it, vi } from 'vite-plus/test';
import { createLiveComposeTap } from './live-compose-tap';
import type { ProgramCompositor } from './program-compositor';

function mockFrame(): VideoFrame {
	return { close: vi.fn() } as unknown as VideoFrame;
}

function closeSpy(frame: VideoFrame) {
	return vi.mocked(frame.close);
}

function createOwningCompositor(): ProgramCompositor {
	const frames = new Map<string, VideoFrame>();
	return {
		updateFrame(sourceId, frame) {
			frames.get(sourceId)?.close();
			frames.set(sourceId, frame);
		},
		switchScene: vi.fn(),
		updateScenes: vi.fn(),
		renderTick: vi.fn(),
		getCurrentSceneId: () => 'scene-1',
		getScenes: () => [],
		hasActiveTransition: () => false,
		dispose() {
			for (const frame of frames.values()) {
				frame.close();
			}
			frames.clear();
		}
	};
}

describe('createLiveComposeTap', () => {
	it('forwards every frame to the compositor without taking closing ownership', () => {
		const compositor = createOwningCompositor();
		const updateFrame = vi.spyOn(compositor, 'updateFrame');
		const tap = createLiveComposeTap(compositor);
		const frame = mockFrame();

		tap.onFrame('screen-1', frame);
		tap.dispose();

		expect(updateFrame).toHaveBeenCalledWith('screen-1', frame);
		expect(closeSpy(frame)).not.toHaveBeenCalled();
	});

	it('lets the compositor close the previous source frame exactly once on replacement', () => {
		const compositor = createOwningCompositor();
		const tap = createLiveComposeTap(compositor);
		const first = mockFrame();
		const second = mockFrame();

		tap.onFrame('screen-1', first);
		tap.onFrame('screen-1', second);

		expect(closeSpy(first)).toHaveBeenCalledTimes(1);
		expect(closeSpy(second)).not.toHaveBeenCalled();
	});

	it('does not double-close compositor-owned frames during tap disposal', () => {
		const compositor = createOwningCompositor();
		const tap = createLiveComposeTap(compositor);
		const frame = mockFrame();

		tap.onFrame('screen-1', frame);
		tap.dispose();
		compositor.dispose();

		expect(closeSpy(frame)).toHaveBeenCalledTimes(1);
	});
});
