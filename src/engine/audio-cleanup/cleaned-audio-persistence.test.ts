/**
 * Phase 27: persistence + undo-snapshot behavior of the per-clip
 * `cleanedAudio` reference — serialization round-trips, invalid persisted
 * entries degrade to "no cleanup", and history-style snapshot/restore keeps
 * apply/remove fully reversible.
 */

import { describe, expect, it } from 'vite-plus/test';
import {
	DEFAULT_TRACK_MIX,
	defaultTimelineClip,
	setClipCleanedAudio,
	type Timeline
} from '../timeline';
import { cloneTimelineSnapshot, deserializeProject, serializeProject } from '../project';
import { createTimelineHistory } from '../history';

const REF = {
	assetId: 'cleaned-asset-1',
	clipInPointS: 1.5,
	durationS: 8,
	modelId: 'rnnoise',
	modelVersion: 'test-1'
};

function timelineFixture(withRef: boolean): Timeline {
	const clip = defaultTimelineClip({
		id: 'clip-1',
		sourceId: 'source-1',
		start: 0,
		duration: 8,
		inPoint: 1.5
	});
	if (withRef) clip.cleanedAudio = { ...REF };
	return [{ id: 'track-audio-1', type: 'audio', ...DEFAULT_TRACK_MIX, clips: [clip] }];
}

describe('cleanedAudio serialization', () => {
	it('round-trips through serialize/deserialize', () => {
		const doc = serializeProject({
			projectId: 'project-1',
			timeline: timelineFixture(true),
			sources: []
		});
		const result = deserializeProject(JSON.parse(JSON.stringify(doc)));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const clip = result.doc.timeline[0]!.clips[0]!;
		expect(clip.cleanedAudio).toEqual(REF);
	});

	it('omits the field entirely for clips without cleanup', () => {
		const doc = serializeProject({
			projectId: 'project-1',
			timeline: timelineFixture(false),
			sources: []
		});
		expect('cleanedAudio' in doc.timeline[0]!.clips[0]!).toBe(false);
	});

	it('degrades invalid persisted references to no cleanup instead of rejecting the clip', () => {
		const doc = serializeProject({
			projectId: 'project-1',
			timeline: timelineFixture(true),
			sources: []
		});
		const raw = JSON.parse(JSON.stringify(doc));
		raw.timeline[0].clips[0].cleanedAudio = { assetId: '', durationS: -1 };
		const result = deserializeProject(raw);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const clip = result.doc.timeline[0]!.clips[0]!;
		expect(clip.id).toBe('clip-1');
		expect(clip.cleanedAudio).toBeUndefined();
	});

	it('cloneTimelineSnapshot deep-copies the reference', () => {
		const timeline = timelineFixture(true);
		const cloned = cloneTimelineSnapshot(timeline);
		expect(cloned[0]!.clips[0]!.cleanedAudio).toEqual(REF);
		expect(cloned[0]!.clips[0]!.cleanedAudio).not.toBe(timeline[0]!.clips[0]!.cleanedAudio);
	});
});

describe('cleanedAudio undo/redo (worker-owned snapshot history)', () => {
	it('apply and remove are reversible through history snapshots', () => {
		const history = createTimelineHistory();
		let timeline = timelineFixture(false);
		const snapshot = (tl: Timeline) => ({ timeline: tl, transitions: [], markers: [] });

		// Apply: push the before-state, then mutate (mirrors commitTimelineMutation).
		history.push(snapshot(timeline));
		timeline = setClipCleanedAudio(timeline, 'track-audio-1', 'clip-1', REF);
		expect(timeline[0]!.clips[0]!.cleanedAudio).toEqual(REF);

		// Remove cleanup, also undoable.
		history.push(snapshot(timeline));
		timeline = setClipCleanedAudio(timeline, 'track-audio-1', 'clip-1', null);
		expect(timeline[0]!.clips[0]!.cleanedAudio).toBeUndefined();

		// Undo remove → reference restored exactly.
		const afterUndoRemove = history.undo(snapshot(timeline));
		expect(afterUndoRemove).not.toBeNull();
		timeline = afterUndoRemove!.timeline;
		expect(timeline[0]!.clips[0]!.cleanedAudio).toEqual(REF);

		// Undo apply → original audio routing restored.
		const afterUndoApply = history.undo(snapshot(timeline));
		expect(afterUndoApply).not.toBeNull();
		timeline = afterUndoApply!.timeline;
		expect(timeline[0]!.clips[0]!.cleanedAudio).toBeUndefined();

		// Redo apply → reference back.
		const afterRedo = history.redo(snapshot(timeline));
		expect(afterRedo).not.toBeNull();
		expect(afterRedo!.timeline[0]!.clips[0]!.cleanedAudio).toEqual(REF);
	});
});
