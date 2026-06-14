/**
 * Phase 40: helper to create a translated caption track in the pipeline worker.
 *
 * Mirrors the Phase 29 `createAsrCaptionTrack` pattern: produces a normal
 * `CaptionTrack` with `generatedBy` metadata so it persists, is undoable,
 * and exports through the existing Phase 22 sidecar path.
 */
import type { CaptionSegmentSnapshot } from '../../protocol';
import { makeCaptionSegmentId, makeCaptionTrackId } from '../captions/model';
import { createCaptionTrack, type CaptionTrack } from '../captions/types';

export interface CreateTranslatedCaptionTrackOptions {
	segments: readonly CaptionSegmentSnapshot[];
	trackName: string;
	language: string;
	sourceTrackId: string;
	createdAt?: Date;
}

/** Metadata stored in the `generatedBy` JSON field. */
export interface TranslatedCaptionMetadata {
	generatedBy: 'language-tools-phase-40';
	sourceTrackId: string;
	language: string;
	createdAt: string;
}

export function createTranslatedCaptionTrack(
	options: CreateTranslatedCaptionTrackOptions
): CaptionTrack {
	const createdAt = options.createdAt ?? new Date();
	return createCaptionTrack({
		id: makeCaptionTrackId(),
		name: options.trackName,
		language: options.language,
		burnedIn: false,
		visible: true,
		segments: options.segments.map((segment) => ({
			...segment,
			id: makeCaptionSegmentId()
		})),
		generatedBy: JSON.stringify({
			generatedBy: 'language-tools-phase-40',
			sourceTrackId: options.sourceTrackId,
			language: options.language,
			createdAt: createdAt.toISOString()
		} satisfies TranslatedCaptionMetadata)
	});
}
