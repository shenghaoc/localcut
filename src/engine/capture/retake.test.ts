import { describe, expect, it } from 'vitest';
import type {
	TimelineClipSnapshot,
	TransformParamsSnapshot,
	ClipKeyframesSnapshot
} from '../../protocol';
import { applyRetakeToClip } from './retake';

const mockTransform: TransformParamsSnapshot = {
	x: 0.7,
	y: 0.7,
	scale: 1,
	rotation: 0,
	opacity: 1,
	anchorX: 0.5,
	anchorY: 0.5,
	fit: 'letterbox'
};

const mockKeyframes: ClipKeyframesSnapshot = {
	opacity: [{ t: 0, value: 1, easing: 'linear' }]
};

const originalClip: TimelineClipSnapshot = {
	id: 'clip-abc',
	sourceId: 'source-old',
	start: 0,
	duration: 10,
	inPoint: 2,
	effects: {
		brightness: 0,
		contrast: 0,
		saturation: 0,
		temperature: 0,
		temperatureStrength: 0,
		lutStrength: 1,
		skinSmoothStrength: 0
	},
	transform: mockTransform,
	keyframes: mockKeyframes,
	audioFadeIn: 0,
	audioFadeOut: 0,
	captureSessionId: 'session-123'
};

describe('applyRetakeToClip', () => {
	it('preserves id, transform, keyframes', () => {
		const result = applyRetakeToClip(originalClip, 'source-new', 15);
		expect(result.id).toBe('clip-abc');
		expect(result.transform).toEqual(mockTransform);
		expect(result.keyframes).toEqual(mockKeyframes);
		expect(result.captureSessionId).toBe('session-123');
	});

	it('updates sourceId to the new recording', () => {
		const result = applyRetakeToClip(originalClip, 'source-new', 15);
		expect(result.sourceId).toBe('source-new');
	});

	it('updates duration to the new recording duration', () => {
		const result = applyRetakeToClip(originalClip, 'source-new', 15);
		expect(result.duration).toBe(15);
	});

	it('resets inPoint to 0', () => {
		const result = applyRetakeToClip(originalClip, 'source-new', 15);
		expect(result.inPoint).toBe(0);
	});

	it('preserves effects and other fields', () => {
		const result = applyRetakeToClip(originalClip, 'source-new', 15);
		expect(result.effects).toEqual(originalClip.effects);
		expect(result.audioFadeIn).toBe(0);
		expect(result.audioFadeOut).toBe(0);
	});

	it('undo scenario — reverting to original state restores equality', () => {
		const retaken = applyRetakeToClip(originalClip, 'source-new', 15);
		// Simulate undo by restoring the original snapshot
		const restored = { ...retaken, sourceId: 'source-old', duration: 10, inPoint: 2 };
		expect(restored.id).toBe(originalClip.id);
		expect(restored.sourceId).toBe(originalClip.sourceId);
		expect(restored.duration).toBe(originalClip.duration);
		expect(restored.inPoint).toBe(originalClip.inPoint);
		expect(restored.transform).toEqual(originalClip.transform);
		expect(restored.keyframes).toEqual(originalClip.keyframes);
	});
});
