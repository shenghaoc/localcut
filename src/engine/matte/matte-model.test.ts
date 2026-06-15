/**
 * Phase 31 (corrected plan) — matte model ops and serialization.
 * Covers R1 (mode/strength/blurRadius mutations, defaults) and the model-pin
 * round-trip portion of R1.2.
 */

import { describe, expect, it } from 'vite-plus/test';
import {
	DEFAULT_MATTE,
	defaultClipEffects,
	defaultClipTransform,
	setClipMatteBlurRadius,
	setClipMatteEnabled,
	setClipMatteMode,
	setClipMatteStrength,
	type TimelineClip,
	type TimelineTrack
} from '../timeline';
import { deserializeProject, serializeProject, PROJECT_SCHEMA_VERSION } from '../project';

function makeClip(partial?: Partial<TimelineClip>): TimelineClip {
	return {
		id: 'clip-1',
		sourceId: 'src-1',
		start: 0,
		duration: 5,
		inPoint: 0,
		effects: defaultClipEffects(),
		transform: defaultClipTransform(),
		audioFadeIn: 0,
		audioFadeOut: 0,
		...partial
	};
}

function makeTimeline(clip: TimelineClip): TimelineTrack[] {
	return [
		{
			id: 'track-1',
			type: 'video',
			gain: 1,
			pan: 0,
			muted: false,
			solo: false,
			clips: [clip]
		} as unknown as TimelineTrack
	];
}

function matteOf(timeline: TimelineTrack[]): TimelineClip['matte'] {
	return timeline[0]!.clips[0]!.matte;
}

describe('matte model ops (Phase 31)', () => {
	it('defaults to remove mode with the permissively licensed model pin', () => {
		expect(DEFAULT_MATTE.mode).toBe('remove');
		// The license verdict (design.md): the deployed default is MediaPipe Selfie
		// Segmentation (Apache-2.0); GPL-family pins like RVM must never be the default.
		expect(DEFAULT_MATTE.modelKey).toBe('mediapipe-selfie-general');
		expect(/rvm/i.test(DEFAULT_MATTE.modelKey)).toBe(false);
	});

	it('enable seeds the full default matte and disable preserves settings', () => {
		const enabled = setClipMatteEnabled(makeTimeline(makeClip()), 'track-1', 'clip-1', true);
		expect(matteOf(enabled)).toEqual({ ...DEFAULT_MATTE, enabled: true });

		const customized = setClipMatteMode(enabled, 'track-1', 'clip-1', 'blur');
		const disabled = setClipMatteEnabled(customized, 'track-1', 'clip-1', false);
		expect(matteOf(disabled)?.enabled).toBe(false);
		expect(matteOf(disabled)?.mode).toBe('blur');
	});

	it('mode changes are applied and same-mode is a no-op', () => {
		const enabled = setClipMatteEnabled(makeTimeline(makeClip()), 'track-1', 'clip-1', true);
		const blurred = setClipMatteMode(enabled, 'track-1', 'clip-1', 'blur');
		expect(matteOf(blurred)?.mode).toBe('blur');
		expect(setClipMatteMode(blurred, 'track-1', 'clip-1', 'blur')).toBe(blurred);
	});

	it('mode/blur/strength changes require an existing matte', () => {
		const bare = makeTimeline(makeClip());
		expect(setClipMatteMode(bare, 'track-1', 'clip-1', 'blur')).toBe(bare);
		expect(setClipMatteBlurRadius(bare, 'track-1', 'clip-1', 12)).toBe(bare);
		expect(setClipMatteStrength(bare, 'track-1', 'clip-1', 0.5)).toBe(bare);
	});

	it('clamps strength to [0,1] and blur radius to [0,64], rejecting NaN', () => {
		const enabled = setClipMatteEnabled(makeTimeline(makeClip()), 'track-1', 'clip-1', true);
		expect(matteOf(setClipMatteStrength(enabled, 'track-1', 'clip-1', 2))?.strength).toBe(1);
		expect(matteOf(setClipMatteStrength(enabled, 'track-1', 'clip-1', -1))?.strength).toBe(0);
		expect(setClipMatteStrength(enabled, 'track-1', 'clip-1', Number.NaN)).toBe(enabled);
		expect(matteOf(setClipMatteBlurRadius(enabled, 'track-1', 'clip-1', 100))?.blurRadius).toBe(64);
		expect(matteOf(setClipMatteBlurRadius(enabled, 'track-1', 'clip-1', -3))?.blurRadius).toBe(0);
		expect(setClipMatteBlurRadius(enabled, 'track-1', 'clip-1', Number.NaN)).toBe(enabled);
	});
});

describe('matte serialization (Phase 31, R1.2)', () => {
	function roundTrip(matte: TimelineClip['matte']): TimelineClip['matte'] {
		const timeline = makeTimeline(makeClip({ matte }));
		const doc = serializeProject({
			projectId: 'matte-test',
			timeline,
			captionTracks: [],
			transitions: [],
			markers: [],
			sources: [],
			masterGain: 1
		});
		expect(doc.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
		const result = deserializeProject(doc);
		if (!result.ok) throw new Error(`deserialize failed: ${result.reason}`);
		return result.doc.timeline[0]!.clips[0]!.matte;
	}

	it('round-trips mode, strength, blur radius, and the model pin verbatim', () => {
		const matte = roundTrip({
			enabled: true,
			mode: 'blur',
			modelKey: 'custom-pin-2.0',
			strength: 0.75,
			blurRadius: 24
		});
		expect(matte).toEqual({
			enabled: true,
			mode: 'blur',
			modelKey: 'custom-pin-2.0',
			strength: 0.75,
			blurRadius: 24
		});
	});

	it('defaults missing mode to remove for pre-v12 documents', () => {
		const timeline = makeTimeline(
			makeClip({
				matte: { enabled: true, mode: 'remove', modelKey: 'modnet-v1', strength: 1 }
			})
		);
		const doc = serializeProject({
			projectId: 'matte-legacy',
			timeline,
			captionTracks: [],
			transitions: [],
			markers: [],
			sources: [],
			masterGain: 1
		}) as unknown as Record<string, unknown>;
		// Simulate a v11 doc whose matte predates the mode field.
		const tracks = doc.timeline as Array<{ clips: Array<Record<string, unknown>> }>;
		delete (tracks[0]!.clips[0]!.matte as Record<string, unknown>).mode;
		doc.schemaVersion = 11;
		const result = deserializeProject(doc);
		if (!result.ok) throw new Error(`deserialize failed: ${result.reason}`);
		expect(result.doc.timeline[0]!.clips[0]!.matte?.mode).toBe('remove');
	});
});
