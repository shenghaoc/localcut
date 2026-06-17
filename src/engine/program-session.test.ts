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

function fakeCaptureSession(options?: {
	epochValue?: number | null;
	landingSources?: ReturnType<CaptureSession['getLandingSources']>;
	mediaTimesUs?: number[];
}) {
	const start = vi.fn(async () => {});
	const stop = vi.fn(async () => {});
	const appendSceneSwitch = vi.fn();
	const currentMediaTimeUs = vi.fn();
	for (const timeUs of options?.mediaTimesUs ?? [1_000_000, 1_500_000, 2_500_000]) {
		currentMediaTimeUs.mockReturnValueOnce(timeUs);
	}
	currentMediaTimeUs.mockReturnValue(2_500_000);
	const getLandingSources = vi.fn(
		() =>
			options?.landingSources ?? [
				{
					sourceId: 'cam-1',
					kind: 'webcam' as const,
					label: 'Camera',
					firstSampleUs: 1_000_000,
					lastSampleUs: 2_500_000,
					bytesWritten: 1024,
					captureMode: 'full' as const
				}
			]
	);
	const session = {
		sessionId: 'program-test',
		start,
		stop,
		appendSceneSwitch,
		epochValue: options?.epochValue === undefined ? 1_000_000 : options.epochValue,
		currentMediaTimeUs,
		getLandingSources
	} as unknown as CaptureSession;
	return { session, start, stop, appendSceneSwitch, currentMediaTimeUs, getLandingSources };
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
		hasActiveTransition: () => false,
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
	it('starts capture, records scene switches, and returns the layout track', async () => {
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
		expect(result.layoutTrack?.layoutClips).toHaveLength(2);
		expect(result.layoutTrack?.clips).toHaveLength(2);
		expect(result.layoutTrack?.layoutClips?.map((clip) => clip.sceneId)).toEqual([
			'scene-1',
			'scene-2'
		]);
		expect(budget.available()).toBe(2);
		expect(disposeCompositor).toHaveBeenCalledOnce();
		expect(disposeTap).toHaveBeenCalledOnce();
	});

	it('falls back to the session start when no capture source establishes an epoch', async () => {
		const capture = fakeCaptureSession({
			epochValue: null,
			landingSources: [],
			mediaTimesUs: [2_000_000, 2_500_000]
		});
		const budget = createEncoderBudget(2);
		const { compositor } = fakeCompositor();
		const { tap } = fakeTap();

		const session = createProgramSession(config(), budget, capture.session, compositor, tap);

		await session.start();
		const result = await session.stop();

		expect(capture.getLandingSources).toHaveBeenCalledOnce();
		expect(result.layoutTrack?.layoutClips).toHaveLength(1);
		expect(result.layoutTrack?.layoutClips?.[0]).toMatchObject({
			sceneId: 'scene-1',
			startTime: 0
		});
		expect(result.layoutTrack?.layoutClips?.[0]?.duration).toBeCloseTo(0.5);
	});

	it('preserves the scene definition snapshot active at each switch', async () => {
		const sessionConfig = config();
		const capture = fakeCaptureSession({ mediaTimesUs: [1_000_000, 1_250_000, 2_000_000] });
		const budget = createEncoderBudget(2);
		const { compositor } = fakeCompositor();
		const { tap } = fakeTap();

		const session = createProgramSession(sessionConfig, budget, capture.session, compositor, tap);

		await session.start();
		session.switchScene('scene-2');
		session.updateScenes(
			sessionConfig.scenes.map((scene) =>
				scene.id === 'scene-2'
					? {
							...scene,
							layers: scene.layers.map((layer) => ({
								...layer,
								transform: { ...layer.transform, scale: 3 }
							}))
						}
					: scene
			)
		);
		const result = await session.stop();

		const switchedClip = result.layoutTrack?.layoutClips?.find(
			(clip) => clip.sceneId === 'scene-2'
		);
		expect(switchedClip?.sceneSnapshot.layers[0]?.transform.scale).toBe(1.4);
	});
});
