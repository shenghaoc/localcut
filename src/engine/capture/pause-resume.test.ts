import { describe, expect, it } from 'vite-plus/test';
import type { CaptureManifestRecord } from './chunk-manifest';
import {
	extractPauseResumePairs,
	computeGapCollapsedUs,
	seamMarkerPositionsUs,
	type PauseResumePair
} from './pause-resume';

describe('extractPauseResumePairs', () => {
	it('pairs consecutive pause/resume records', () => {
		const records: CaptureManifestRecord[] = [
			{ kind: 'pause', atUs: 1000 },
			{ kind: 'resume', atUs: 2000 },
			{ kind: 'pause', atUs: 5000 },
			{ kind: 'resume', atUs: 7000 }
		];
		const pairs = extractPauseResumePairs(records);
		expect(pairs).toEqual([
			{ pauseAtUs: 1000, resumeAtUs: 2000 },
			{ pauseAtUs: 5000, resumeAtUs: 7000 }
		]);
	});

	it('excludes a final unpaired pause (session stopped while paused)', () => {
		const records: CaptureManifestRecord[] = [
			{ kind: 'pause', atUs: 1000 },
			{ kind: 'resume', atUs: 2000 },
			{ kind: 'pause', atUs: 5000 }
			// No resume — session stopped while paused
		];
		const pairs = extractPauseResumePairs(records);
		expect(pairs).toEqual([{ pauseAtUs: 1000, resumeAtUs: 2000 }]);
	});

	it('returns empty array when no pause/resume records exist', () => {
		const records: CaptureManifestRecord[] = [
			{
				kind: 'chunk',
				sourceId: 's1',
				file: 'video-s1.mp4',
				byteOffset: 0,
				byteLength: 100,
				fromUs: 0,
				toUs: 100,
				keyFrame: true,
				preEncodeDrops: 0
			}
		];
		expect(extractPauseResumePairs(records)).toEqual([]);
	});

	it('handles interleaved non-pause records', () => {
		const records: CaptureManifestRecord[] = [
			{
				kind: 'chunk',
				sourceId: 's1',
				file: 'video-s1.mp4',
				byteOffset: 0,
				byteLength: 100,
				fromUs: 0,
				toUs: 100,
				keyFrame: true,
				preEncodeDrops: 0
			},
			{ kind: 'pause', atUs: 1000 },
			{
				kind: 'chunk',
				sourceId: 's1',
				file: 'video-s1.mp4',
				byteOffset: 100,
				byteLength: 50,
				fromUs: 100,
				toUs: 200,
				keyFrame: false,
				preEncodeDrops: 0
			},
			{ kind: 'resume', atUs: 2000 },
			{
				kind: 'chunk',
				sourceId: 's1',
				file: 'video-s1.mp4',
				byteOffset: 150,
				byteLength: 80,
				fromUs: 200,
				toUs: 300,
				keyFrame: false,
				preEncodeDrops: 0
			}
		];
		const pairs = extractPauseResumePairs(records);
		expect(pairs).toEqual([{ pauseAtUs: 1000, resumeAtUs: 2000 }]);
	});
});

describe('computeGapCollapsedUs', () => {
	it('returns rawTs when no pairs exist', () => {
		expect(computeGapCollapsedUs(5000, [])).toBe(5000);
	});

	it('three-pause drift test — integer arithmetic, zero drift', () => {
		const pairs: PauseResumePair[] = [
			{ pauseAtUs: 1000, resumeAtUs: 2000 }, // gap = 1000
			{ pauseAtUs: 5000, resumeAtUs: 7000 }, // gap = 2000
			{ pauseAtUs: 12000, resumeAtUs: 15000 } // gap = 3000
		];
		// Total gap at different points:
		// Before pair 0 resume (ts < 2000): 0
		// Between pair 0 and pair 1 (2000 ≤ ts < 7000): 1000
		// Between pair 1 and pair 2 (7000 ≤ ts < 15000): 1000 + 2000 = 3000
		// After pair 2 (ts ≥ 15000): 1000 + 2000 + 3000 = 6000

		// Sample timestamps across 4 segments:
		const samples = [
			{ raw: 500, expected: 500 }, // before first pause end
			{ raw: 1500, expected: 1500 }, // during first gap
			{ raw: 2000, expected: 1000 }, // exactly at first resume
			{ raw: 3000, expected: 2000 }, // between first and second gap
			{ raw: 6000, expected: 5000 }, // during second gap
			{ raw: 7000, expected: 4000 }, // exactly at second resume
			{ raw: 8000, expected: 5000 }, // between second and third gap
			{ raw: 13000, expected: 10000 }, // during third gap
			{ raw: 15000, expected: 9000 }, // exactly at third resume
			{ raw: 16000, expected: 10000 }, // after all gaps
			{ raw: 20000, expected: 14000 }, // well after all gaps
			{ raw: 100000, expected: 94000 } // far future
		];

		for (const { raw, expected } of samples) {
			const result = computeGapCollapsedUs(raw, pairs);
			expect(result, `rawTs=${raw}`).toBe(expected);
		}
	});

	it('integer arithmetic — no floating-point rounding error', () => {
		const pairs: PauseResumePair[] = [
			{ pauseAtUs: 100_000, resumeAtUs: 200_001 },
			{ pauseAtUs: 500_000, resumeAtUs: 700_003 },
			{ pauseAtUs: 1_200_000, resumeAtUs: 1_500_007 }
		];
		const rawTs = 2_000_000;
		const result = computeGapCollapsedUs(rawTs, pairs);
		// gaps: 100001 + 200003 + 300007 = 600011
		expect(result).toBe(rawTs - 600011);
		// Verify it's exactly an integer (no floating-point drift)
		expect(Number.isInteger(result)).toBe(true);
	});
});

describe('seamMarkerPositionsUs', () => {
	it('returns collapsed resume positions with 1-based labels', () => {
		const pairs: PauseResumePair[] = [
			{ pauseAtUs: 1000, resumeAtUs: 2000 }, // gap = 1000
			{ pauseAtUs: 5000, resumeAtUs: 7000 }, // gap = 2000
			{ pauseAtUs: 12000, resumeAtUs: 15000 } // gap = 3000
		];
		const markers = seamMarkerPositionsUs(pairs);
		// Each marker is the gap-collapsed timestamp of the resume point.
		// The current gap and all prior gaps are subtracted from the raw resume timestamp.
		expect(markers).toEqual([
			{ positionUs: 1000, label: 'Resume 1' }, // 2000 - 1000 = 1000
			{ positionUs: 4000, label: 'Resume 2' }, // 7000 - 3000 = 4000
			{ positionUs: 9000, label: 'Resume 3' } // 15000 - 6000 = 9000
		]);
	});

	it('returns empty array for no pairs', () => {
		expect(seamMarkerPositionsUs([])).toEqual([]);
	});

	it('single pair', () => {
		const pairs: PauseResumePair[] = [{ pauseAtUs: 100, resumeAtUs: 200 }];
		expect(seamMarkerPositionsUs(pairs)).toEqual([{ positionUs: 100, label: 'Resume 1' }]);
	});
});
