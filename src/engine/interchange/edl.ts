import type { ProjectDoc, SourceDescriptor } from '../project';
import type { TimelineClip, TimelineTrack } from '../timeline';
import { compareStrings, formatTimecode, interchangeRate, snapToFrames } from './time';
import type { InterchangeOutput } from './otio';

/**
 * Cuts-only CMX3600 EDL emitter (Phase 48). One video track per list — the
 * format is structurally single-track — with transitions flattened to
 * straight cuts and audio omitted; every omission is reported as a warning.
 */

export interface EdlSerializeOptions {
	displayName: string;
	/** Track to export; defaults to the first video track containing clips. */
	trackId?: string;
}

/** Broadcast convention: record timecode starts at one hour. */
const RECORD_START_HOURS = 1;
const TITLE_REEL = 'AX';
const REEL_MAX_LENGTH = 8;

function reelBase(fileName: string): string {
	const dot = fileName.lastIndexOf('.');
	const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
	const alnum = stem.toUpperCase().replace(/[^A-Z0-9]/g, '');
	// Names with no alphanumeric characters (e.g. CJK-only) fall back to a
	// generic reel; FROM CLIP NAME comments preserve the real file name.
	return alnum || 'REEL';
}

/**
 * Deterministic reel assignment in first-appearance order. Dedup suffixes
 * count toward the 8-character CMX3600 limit: the base is shortened so
 * `<base><n>` never exceeds 8 characters.
 */
class ReelNames {
	private bySourceId = new Map<string, string>();
	private used = new Set<string>([TITLE_REEL]);

	reelFor(sourceId: string, fileName: string): string {
		const existing = this.bySourceId.get(sourceId);
		if (existing) return existing;
		const base = reelBase(fileName);
		let candidate = base.slice(0, REEL_MAX_LENGTH);
		for (let suffix = 2; this.used.has(candidate); suffix += 1) {
			const digits = String(suffix);
			candidate = base.slice(0, Math.max(0, REEL_MAX_LENGTH - digits.length)) + digits;
		}
		this.used.add(candidate);
		this.bySourceId.set(sourceId, candidate);
		return candidate;
	}
}

function pickTrack(
	doc: ProjectDoc,
	options: EdlSerializeOptions,
	warnings: string[]
): TimelineTrack | null {
	if (options.trackId) {
		const track = doc.timeline.find((item) => item.id === options.trackId);
		if (track && track.type === 'video') return track;
		warnings.push(`Track ${options.trackId} is not a video track; nothing exported.`);
		return null;
	}
	const track = doc.timeline.find((item) => item.type === 'video' && item.clips.length > 0);
	if (!track) warnings.push('No video track with clips; nothing exported.');
	return track ?? null;
}

function clipName(clip: TimelineClip, sourceById: Map<string, SourceDescriptor>): string {
	if (clip.kind === 'title') return `Title: ${clip.title?.text ?? 'Title'}`;
	return sourceById.get(clip.sourceId)?.fileName ?? clip.sourceId;
}

export function serializeTimelineToEdl(
	doc: ProjectDoc,
	options: EdlSerializeOptions
): InterchangeOutput {
	const warnings: string[] = [];
	const sequenceRate = interchangeRate(doc);
	// Clamp so sub-1 fps sequence rates (slideshows) still yield a legal
	// integer timecode rate; the rounding comment below records the change.
	const fps = Math.max(1, Math.round(sequenceRate));
	const sourceById = new Map(doc.sources.map((source) => [source.sourceId, source]));
	const track = pickTrack(doc, options, warnings);

	const lines: string[] = [];
	lines.push(`TITLE: ${(options.displayName || 'UNTITLED').toUpperCase()}`);
	lines.push('FCM: NON-DROP FRAME');
	if (fps !== sequenceRate) {
		lines.push(`* LOCALCUT: RATE ${sequenceRate} ROUNDED TO ${fps} NDF`);
	}

	if (track) {
		const omittedTracks = doc.timeline.filter((item) => item !== track && item.clips.length > 0);
		if (omittedTracks.length > 0) {
			warnings.push(
				`EDL is single-track: ${omittedTracks.length} other track(s) with clips were omitted.`
			);
		}
		if (doc.transitions.some((transition) => transition.trackId === track.id)) {
			warnings.push('EDL export is cuts-only: transitions become straight cuts.');
		}

		const reels = new ReelNames();
		const recordOffset = RECORD_START_HOURS * 3600 * fps;
		const sorted = [...track.clips].sort((a, b) => a.start - b.start || compareStrings(a.id, b.id));
		let eventNumber = 0;
		for (const clip of sorted) {
			const recIn = snapToFrames(clip.start, fps);
			const recOut = snapToFrames(clip.start + clip.duration, fps);
			const durationFrames = recOut - recIn;
			if (durationFrames <= 0) {
				warnings.push(`Clip ${clipName(clip, sourceById)} collapses to zero frames; skipped.`);
				continue;
			}
			const isTitle = clip.kind === 'title';
			const reel = isTitle
				? TITLE_REEL
				: reels.reelFor(clip.sourceId, sourceById.get(clip.sourceId)?.fileName ?? clip.sourceId);
			// Source duration must equal record duration in a cut event, so the
			// source out is derived from the snapped record duration.
			const srcIn = isTitle ? 0 : snapToFrames(clip.inPoint, fps);
			eventNumber += 1;
			lines.push(
				[
					String(eventNumber).padStart(3, '0'),
					'  ',
					reel.padEnd(REEL_MAX_LENGTH),
					' V     C        ',
					formatTimecode(srcIn, fps),
					' ',
					formatTimecode(srcIn + durationFrames, fps),
					' ',
					formatTimecode(recordOffset + recIn, fps),
					' ',
					formatTimecode(recordOffset + recOut, fps)
				].join('')
			);
			lines.push(`* FROM CLIP NAME: ${clipName(clip, sourceById)}`);
		}
	}

	return { text: `${lines.join('\n')}\n`, warnings };
}

const EVENT_LINE =
	/^(\d{3}) {2}([A-Z0-9]{1,8}) +V +C +(\d{2}):(\d{2}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2}):(\d{2})$/;

function timecodeToFrames(parts: string[], offset: number, fps: number): number {
	const [hh, mm, ss, ff] = parts.slice(offset, offset + 4).map(Number) as [
		number,
		number,
		number,
		number
	];
	return ((hh * 60 + mm) * 60 + ss) * fps + ff;
}

/**
 * Strict line-grammar validator for cuts-only CMX3600 lists (R11.6).
 * `fps` must be the integer non-drop rate the list was cut at.
 * Returns an empty array when the document is valid.
 */
export function validateCmx3600Document(text: string, fps: number): string[] {
	const issues: string[] = [];
	if (!Number.isInteger(fps) || fps <= 0) return [`invalid fps ${fps}`];
	const lines = text.split('\n');
	if (lines[lines.length - 1] === '') lines.pop();
	if (!/^TITLE: .+$/.test(lines[0] ?? '')) issues.push('line 1: expected "TITLE: <name>"');
	if (!/^FCM: (NON-)?DROP FRAME$/.test(lines[1] ?? '')) {
		issues.push('line 2: expected an FCM line');
	}
	let expectedEvent = 1;
	let lastRecordOut: number | null = null;
	for (let i = 2; i < lines.length; i += 1) {
		const line = lines[i]!;
		if (line === '' || /^\* .+$/.test(line)) continue;
		const match = EVENT_LINE.exec(line);
		if (!match) {
			issues.push(`line ${i + 1}: not a valid cut event or "* " comment: ${JSON.stringify(line)}`);
			continue;
		}
		const eventNumber = Number(match[1]);
		if (eventNumber !== expectedEvent) {
			issues.push(`line ${i + 1}: event ${match[1]} out of sequence (expected ${expectedEvent})`);
		}
		expectedEvent = eventNumber + 1;
		const fields = match.slice(3);
		for (let f = 3; f < fields.length; f += 4) {
			if (Number(fields[f]) >= fps) {
				issues.push(`line ${i + 1}: frame field ${fields[f]} exceeds ${fps - 1}`);
			}
		}
		const srcIn = timecodeToFrames(fields, 0, fps);
		const srcOut = timecodeToFrames(fields, 4, fps);
		const recIn = timecodeToFrames(fields, 8, fps);
		const recOut = timecodeToFrames(fields, 12, fps);
		if (srcOut <= srcIn) issues.push(`line ${i + 1}: source out must be after source in`);
		if (recOut <= recIn) issues.push(`line ${i + 1}: record out must be after record in`);
		if (srcOut - srcIn !== recOut - recIn) {
			issues.push(`line ${i + 1}: source and record durations differ in a cut event`);
		}
		if (lastRecordOut !== null && recIn < lastRecordOut) {
			issues.push(`line ${i + 1}: record in moves backwards`);
		}
		lastRecordOut = recOut;
	}
	return issues;
}
