import { serializeSrt } from './srt';
import { serializeWebVtt } from './webvtt';
import { captionSegmentEnd, cloneCaptionSegment, type CaptionExportSettings, type CaptionSidecarFile, type CaptionTrack } from './types';

export function filterCaptionSegmentsForRange(
  track: CaptionTrack,
  range: CaptionExportSettings['range'],
): ReturnType<typeof cloneCaptionSegment>[] {
  const startS = range.mode === 'timeline-range' ? range.startS : 0;
  const endS = range.mode === 'timeline-range' ? range.endS : Number.POSITIVE_INFINITY;
  return track.segments
    .filter((segment) => segment.start < endS && captionSegmentEnd(segment) > startS)
    .map((segment) => ({
      ...cloneCaptionSegment(segment),
      start: Math.max(0, segment.start - startS),
    }));
}

export function exportCaptionSidecars(track: CaptionTrack, settings: CaptionExportSettings): CaptionSidecarFile[] {
  const segments = filterCaptionSegmentsForRange(track, settings.range);
  const baseName = settings.fileStem.trim() || track.name || 'captions';
  const files: CaptionSidecarFile[] = [];
  for (const format of settings.formats) {
    if (format === 'srt') {
      files.push({
        fileName: `${baseName}.srt`,
        mimeType: 'application/x-subrip',
        content: serializeSrt(segments),
      });
    } else {
      files.push({
        fileName: `${baseName}.vtt`,
        mimeType: 'text/vtt',
        content: serializeWebVtt(segments),
      });
    }
  }
  return files;
}
