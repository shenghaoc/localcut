/**
 * Cleaned-audio routing (Phase 27): when a clip carries a `cleanedAudio`
 * reference and the derived asset is present and still covers the clip's
 * source range, playback and export substitute the derived asset for the
 * original audio. Anything else — missing asset, retrim past the cleaned
 * range — falls back to the original source audio, never to silence.
 *
 * Pure timeline logic: no model code, no worker globals. Imported by the
 * pipeline worker and the export mixer; safe everywhere.
 */

import type { TimelineClip } from '../timeline';

/** Retrim tolerance before a cleaned range is considered stale (seconds). */
export const CLEANED_AUDIO_EPSILON_S = 1e-3;

interface AudioCapableHandle {
	audioSource: object | null;
}

/** True when the clip's current source range is inside the cleaned range. */
export function cleanedAudioCoversClip(clip: TimelineClip): boolean {
	const ref = clip.cleanedAudio;
	if (!ref) return false;
	return (
		clip.inPoint >= ref.clipInPointS - CLEANED_AUDIO_EPSILON_S &&
		clip.inPoint + clip.duration <= ref.clipInPointS + ref.durationS + CLEANED_AUDIO_EPSILON_S
	);
}

export interface CleanedAudioSubstitute<H> {
	handle: H;
	/** The clip re-pointed at the derived asset with a remapped in-point. */
	clip: TimelineClip;
}

/**
 * Resolves the audio substitute for a clip, or null when original audio
 * should play (no cleanup applied, asset missing, or range not covered).
 *
 * The substitute clip keeps start/duration/fades so all downstream timing
 * and mix math is unchanged; only `sourceId` and `inPoint` are remapped
 * (the derived asset's t=0 corresponds to `clipInPointS` in source time).
 */
export function cleanedAudioSubstitute<H extends AudioCapableHandle>(
	clip: TimelineClip,
	sources: ReadonlyMap<string, H>
): CleanedAudioSubstitute<H> | null {
	const ref = clip.cleanedAudio;
	if (!ref) return null;
	const handle = sources.get(ref.assetId);
	if (!handle?.audioSource) return null;
	if (!cleanedAudioCoversClip(clip)) return null;
	return {
		handle,
		clip: {
			...clip,
			sourceId: ref.assetId,
			inPoint: Math.max(0, clip.inPoint - ref.clipInPointS)
		}
	};
}

/** True when cleanup is applied but its derived asset is unavailable. */
export function cleanedAudioMissing<H extends AudioCapableHandle>(
	clip: TimelineClip,
	sources: ReadonlyMap<string, H>
): boolean {
	const ref = clip.cleanedAudio;
	if (!ref) return false;
	return !sources.get(ref.assetId)?.audioSource;
}
