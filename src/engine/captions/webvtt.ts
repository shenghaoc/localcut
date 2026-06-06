import { createCaptionTrack, type CaptionDiagnostic, type CaptionSegment, type ParsedCaptionDocument } from './types';

function parseWebVttTimecode(value: string): number | null {
  const trimmed = value.trim();
  const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(trimmed);
  if (!match) return null;
  const [, hh = '0', mm, ss, ms] = match;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms) / 1000;
}

function formatWebVttTimecode(time: number): string {
  const totalMs = Math.max(0, Math.round(time * 1000));
  const hh = Math.floor(totalMs / 3_600_000);
  const mm = Math.floor((totalMs % 3_600_000) / 60_000);
  const ss = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export function parseWebVtt(text: string): ParsedCaptionDocument {
  const diagnostics: CaptionDiagnostic[] = [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  let cursor = 0;
  if (lines[cursor]?.trim() !== 'WEBVTT') {
    diagnostics.push({
      code: 'missing-header',
      severity: 'warning',
      line: 1,
      message: 'WEBVTT header missing; attempting recovery.',
    });
  } else {
    cursor += 1;
  }
  while (cursor < lines.length && lines[cursor]!.trim() === '') cursor += 1;

  const segments: CaptionSegment[] = [];
  let cueIndex = 0;
  while (cursor < lines.length) {
    const startLine = cursor + 1;
    let cueId: string | undefined;
    let timingLine = lines[cursor] ?? '';
    if (!timingLine.includes('-->')) {
      cueId = timingLine.trim();
      cursor += 1;
      timingLine = lines[cursor] ?? '';
    }
    const timingMatch = /^(.+?)\s*-->\s*(.+?)(?:\s+(.+))?$/.exec(timingLine.trim());
    if (!timingMatch) {
      if (timingLine.trim().length > 0) {
        diagnostics.push({
          code: 'invalid-timecode',
          severity: 'error',
          cueIndex: cueIndex + 1,
          line: startLine,
          message: `Cue ${cueIndex + 1} has invalid timing.`,
        });
      }
      cursor += 1;
      continue;
    }
    const start = parseWebVttTimecode(timingMatch[1]);
    const end = parseWebVttTimecode(timingMatch[2]);
    if (start === null || end === null || end <= start) {
      diagnostics.push({
        code: end !== null && start !== null && end <= start ? 'negative-duration' : 'invalid-timecode',
        severity: 'error',
        cueIndex: cueIndex + 1,
        line: startLine,
        message: `Cue ${cueIndex + 1} has invalid timing.`,
      });
      cursor += 1;
      continue;
    }
    const settings = (timingMatch[3] ?? '').trim();
    if (settings.length > 0) {
      diagnostics.push({
        code: 'unsupported-setting',
        severity: 'info',
        cueIndex: cueIndex + 1,
        line: startLine,
        message: `Cue settings "${settings}" were ignored.`,
      });
    }
    cursor += 1;
    const body: string[] = [];
    while (cursor < lines.length && lines[cursor]!.trim() !== '') {
      body.push(lines[cursor]!);
      cursor += 1;
    }
    while (cursor < lines.length && lines[cursor]!.trim() === '') cursor += 1;
    if (body.join('\n').trim().length === 0) {
      diagnostics.push({
        code: 'empty-cue',
        severity: 'warning',
        cueIndex: cueIndex + 1,
        line: startLine,
        message: `Cue ${cueIndex + 1} is empty and was skipped.`,
      });
      continue;
    }
    cueIndex += 1;
    segments.push({
      id: cueId && cueId.length > 0 ? cueId : `caption-${cueIndex}`,
      start,
      duration: end - start,
      text: body.join('\n').trim(),
    });
  }

  segments.sort((a, b) => a.start - b.start);
  return {
    segments,
    diagnostics,
    recovered: diagnostics.some((d) => d.severity !== 'info'),
  };
}

export function serializeWebVtt(segments: readonly CaptionSegment[]): string {
  const body = segments
    .map((segment) => {
      const start = formatWebVttTimecode(segment.start);
      const end = formatWebVttTimecode(segment.start + segment.duration);
      return `${segment.id}\n${start} --> ${end}\n${segment.text.trim()}`;
    })
    .join('\n\n');
  return `WEBVTT\n\n${body}`;
}

export function captionTrackFromWebVtt(text: string, id: string, name?: string) {
  const parsed = parseWebVtt(text);
  return {
    track: createCaptionTrack({ id, name, segments: parsed.segments }),
    diagnostics: parsed.diagnostics,
    format: 'webvtt' as const,
    recovered: parsed.recovered,
  };
}
