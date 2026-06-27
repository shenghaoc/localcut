import { currentIsoTimestamp } from '../../time';
import type {
	AsrAccelerator,
	AsrEngine,
	AsrGeneratedCaptionMetadata,
	CaptionSegmentSnapshot
} from '../../protocol';
import { makeCaptionSegmentId, makeCaptionTrackId } from '../captions/model';
import { createCaptionTrack, type CaptionTrack } from '../captions/types';

export interface CreateAsrCaptionTrackOptions {
	segments: readonly CaptionSegmentSnapshot[];
	trackName: string;
	language: string | null;
	engine: AsrEngine;
	accelerator: AsrAccelerator;
	phraseLevel: boolean;
	createdAt?: string;
}

export function createAsrCaptionTrack(options: CreateAsrCaptionTrackOptions): CaptionTrack {
	const createdAt = options.createdAt ?? currentIsoTimestamp();
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
			generatedBy: 'auto-captions-phase-29',
			engine: options.engine,
			accelerator: options.accelerator,
			language: options.language,
			phraseLevel: options.phraseLevel,
			createdAt
		} satisfies AsrGeneratedCaptionMetadata)
	});
}
