import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { ProgramSessionConfig } from '../protocol';
import type { CaptureSession } from './capture/capture-session';
import { createEncoderBudget } from './encoder-budget';
import type { LiveComposeTap } from './live-compose-tap';
import type { ProgramCompositor } from './program-compositor';
import { createProgramSession } from './program-session';

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

function config(): ProgramSessionConfig {
	return {
		initialSceneId: 'scene-1',
		chunkTargetS: 2,
		transitionMs: 0,
		sources: [
			{
				sourceId: 'cam-1',
				kind: 'webcam',
				label: 'Camera',
				track: {} as MediaStreamTrack,
				encoderConfig: { codec: 'avc1.42001E', width: 1280, height: 720, bitrate: 2_000_000 }
			}
		],
		scenes: [
			{
				id: 'scene-1',
				name: 'Wide',
				hotkey: '1',
				layers: [{ sourceRef: 'cam-1', transform, visible: true, zIndex: 0 }]
			},
			{
				id: 'scene-2',
				name: 'Punch',
				hotkey: '2',
				layers: [
					{ sourceRef: 'cam-1', transform: { ...transform, scale: 1.4 }, visible: true, zIndex: 0 }
				]
			}
		]
	};
}

function fakeCaptureSession() {
	const start = vi.fn(async () => {});
	const stop = vi.fn(async () => {});
	const appendSceneSwitch = vi.fn();
	const session = {
		sessionId: 'program-test',
		start,
		stop,
		appendSceneSwitch,
		getSourceSnapshots: vi.fn(() => [
			{
				sourceId: 'cam-1',
				kind: 'webcam' as const,
				label: 'Camera',
				encoderConfig: 'avc1.42001E',
				hardwareAcceleration: 'prefer-hardware' as const
			}
		])
	} as unknown as CaptureSession;
	return { session, start, stop, appendSceneSwitch };
}

function fakeCompositor() {
	const dispose = vi.fn();
	const compositor: ProgramCompositor = {
		updateFrame: vi.fn(),
		switchScene: vi.fn(),
		updateScenes: vi.fn(),
		renderTick: vi.fn(),
		getCurrentSceneId: () => 'scene-1',
		getScenes: () => [],
		dispose
	};
	return { compositor, dispose };
}

function fakeTap() {
	const dispose = vi.fn();
	const tap: LiveComposeTap = {
		onFrame: vi.fn(),
		dispose
	};
	return { tap, dispose };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('createProgramSession', () => {
	it('starts capture, records scene switches, and lands ISO plus layout tracks', async () => {
		vi.spyOn(performance, 'now')
			.mockReturnValueOnce(1_000)
			.mockReturnValueOnce(1_500)
			.mockReturnValueOnce(2_500);
		const capture = fakeCaptureSession();
		const budget = createEncoderBudget(2);
		const { compositor, dispose: disposeCompositor } = fakeCompositor();
		const { tap, dispose: disposeTap } = fakeTap();

		const session = createProgramSession(config(), budget, capture.session, compositor, tap);

		await session.start();
		session.switchScene('scene-2');
		const result = await session.stop();

		expect(capture.start).toHaveBeenCalledWith(2);
		expect(capture.appendSceneSwitch).toHaveBeenCalledWith('scene-2', 1_500_000);
		expect(capture.stop).toHaveBeenCalledWith('user-stop');
		expect(result.sessionId).toBe('program-test');
		expect(result.isoTracks).toHaveLength(1);
		expect(result.isoTrackIds).toEqual(['iso-program-test-cam-1']);
		expect(result.layoutTrack?.layoutClips).toHaveLength(2);
		expect(result.layoutTrack?.layoutClips?.map((clip) => clip.sceneId)).toEqual([
			'scene-1',
			'scene-2'
		]);
		expect(budget.available()).toBe(2);
		expect(disposeCompositor).toHaveBeenCalledOnce();
		expect(disposeTap).toHaveBeenCalledOnce();
	});
});
