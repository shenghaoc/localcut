import { createCaptionTrack, type CaptionDiagnostic, type CaptionSegment, type ParsedCaptionDocument } from './types';

function parseSrtTimecode(value: string): number | null {
  const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(value.trim());
  if (!match) return null;
  const [, hh, mm, ss, ms] = match;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms) / 1000;
}

function formatSrtTimecode(time: number): string {
  const totalMs = Math.max(0, Math.round(time * 1000));
  const hh = Math.floor(totalMs / 3_600_000);
  const mm = Math.floor((totalMs % 3_600_000) / 60_000);
  const ss = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function parseSrt(text: string): ParsedCaptionDocument {
  const diagnostics: CaptionDiagnostic[] = [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (normalized.length === 0) {
    return { segments: [], diagnostics, recovered: false };
  }

  const blocks = normalized.split(/\n{2,}/);
  const segments: CaptionSegment[] = [];
  blocks.forEach((block, index) => {
    const lines = block.split('\n');
    let cursor = 0;
    const maybeIndex = lines[cursor]?.trim() ?? '';
    if (/^\d+$/.test(maybeIndex)) {
      cursor += 1;
    } else {
      diagnostics.push({
        code: 'invalid-index',
        severity: 'warning',
        cueIndex: index + 1,
        message: `Cue ${index + 1} has no numeric index; continuing.`,
      });
      if (!maybeIndex.includes('-->') && (lines[cursor + 1]?.includes('-->') ?? false)) {
        cursor += 1;
      }
    }
    const timingLine = lines[cursor]?.trim() ?? '';
    const timing = /^(.+?)\s*-->\s*(.+)$/.exec(timingLine);
    if (!timing) {
      diagnostics.push({
        code: 'invalid-timecode',
        severity: 'error',
        cueIndex: index + 1,
        message: `Cue ${index + 1} is missing a valid timing line.`,
      });
      return;
    }
    const start = parseSrtTimecode(timing[1]);
    const end = parseSrtTimecode(timing[2]);
    if (start === null || end === null || end <= start) {
      diagnostics.push({
        code: end !== null && start !== null && end <= start ? 'negative-duration' : 'invalid-timecode',
        severity: 'error',
        cueIndex: index + 1,
        message: `Cue ${index + 1} has invalid timing.`,
      });
      return;
    }
    const body = lines.slice(cursor + 1).join('\n').trim();
    if (body.length === 0) {
      diagnostics.push({
        code: 'empty-cue',
        severity: 'warning',
        cueIndex: index + 1,
        message: `Cue ${index + 1} is empty and was skipped.`,
      });
      return;
    }
    segments.push({
      id: `caption-${index + 1}`,
      start,
      duration: end - start,
      text: body,
    });
  });

  segments.sort((a, b) => a.start - b.start);
  for (let index = 1; index < segments.length; index += 1) {
    const prev = segments[index - 1]!;
    const current = segments[index]!;
    if (current.start < prev.start + prev.duration) {
      diagnostics.push({
        code: 'overlap',
        severity: 'warning',
        cueIndex: index + 1,
        message: `Cue ${index + 1} overlaps the previous cue.`,
      });
    }
  }
  return {
    segments,
    diagnostics,
    recovered: diagnostics.some((d) => d.severity !== 'info'),
  };
}

export function serializeSrt(segments: readonly CaptionSegment[]): string {
  return segments
    .map((segment, index) => {
      const start = formatSrtTimecode(segment.start);
      const end = formatSrtTimecode(segment.start + segment.duration);
      return `${index + 1}\n${start} --> ${end}\n${segment.text.trim()}`;
    })
    .join('\n\n');
}

export function captionTrackFromSrt(text: string, id: string, name?: string) {
  const parsed = parseSrt(text);
  return {
    track: createCaptionTrack({ id, name, segments: parsed.segments }),
    diagnostics: parsed.diagnostics,
    format: 'srt' as const,
    recovered: parsed.recovered,
  };
}
