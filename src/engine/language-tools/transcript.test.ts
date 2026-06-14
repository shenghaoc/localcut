/**
 * Phase 40: Transcript and segment helper tests.
 *
 * Tests the timing invariant: output segments copy start/duration exactly
 * and preserve count/order.
 */
import { describe, expect, it } from 'vite-plus/test';
import {
	assembleTranscript,
	buildTranslatedSegments,
	dominantLanguage,
	oppositeLanguage
} from './transcript';
import type { CaptionSegmentSnapshot } from '../../protocol';

const SEGMENTS: CaptionSegmentSnapshot[] = [
	{ id: 's1', start: 0, duration: 1.5, text: 'Hello world' },
	{ id: 's2', start: 1.5, duration: 2.0, text: 'This is a test' },
	{ id: 's3', start: 3.5, duration: 1.0, text: '  ' }, // whitespace only
	{ id: 's4', start: 4.5, duration: 0.8, text: 'Final segment' }
];

describe('assembleTranscript', () => {
	it('joins trimmed non-empty segments with spaces', () => {
		const result = assembleTranscript(SEGMENTS);
		expect(result).toBe('Hello world This is a test Final segment');
	});

	it('returns empty string for empty segments', () => {
		expect(assembleTranscript([])).toBe('');
	});

	it('filters out whitespace-only segments', () => {
		const segments: CaptionSegmentSnapshot[] = [
			{ id: 's1', start: 0, duration: 1, text: '  ' },
			{ id: 's2', start: 1, duration: 1, text: '' }
		];
		expect(assembleTranscript(segments)).toBe('');
	});
});

describe('buildTranslatedSegments', () => {
	it('copies start and duration verbatim from source', () => {
		const translatedTexts = ['你好世界', '这是一个测试', '', '最后的片段'];
		const result = buildTranslatedSegments(SEGMENTS, translatedTexts);

		expect(result).toHaveLength(4);
		for (let i = 0; i < result.length; i++) {
			expect(result[i].start).toBe(SEGMENTS[i].start);
			expect(result[i].duration).toBe(SEGMENTS[i].duration);
		}
	});

	it('replaces text with translated version', () => {
		const translatedTexts = ['你好世界', '这是一个测试', '', '最后的片段'];
		const result = buildTranslatedSegments(SEGMENTS, translatedTexts);

		expect(result[0].text).toBe('你好世界');
		expect(result[1].text).toBe('这是一个测试');
		expect(result[2].text).toBe('');
		expect(result[3].text).toBe('最后的片段');
	});

	it('preserves segment count 1:1', () => {
		const translatedTexts = ['a', 'b', 'c', 'd'];
		const result = buildTranslatedSegments(SEGMENTS, translatedTexts);
		expect(result).toHaveLength(SEGMENTS.length);
	});

	it('preserves segment order', () => {
		const translatedTexts = ['a', 'b', 'c', 'd'];
		const result = buildTranslatedSegments(SEGMENTS, translatedTexts);
		for (let i = 0; i < result.length; i++) {
			expect(result[i].start).toBe(SEGMENTS[i].start);
		}
	});

	it('throws on count mismatch', () => {
		expect(() => buildTranslatedSegments(SEGMENTS, ['a', 'b'])).toThrow(
			'Timing invariant violation'
		);
	});

	it('assigns empty ids (worker will assign)', () => {
		const translatedTexts = ['a', 'b', 'c', 'd'];
		const result = buildTranslatedSegments(SEGMENTS, translatedTexts);
		for (const seg of result) {
			expect(seg.id).toBe('');
		}
	});
});

describe('dominantLanguage', () => {
	it('returns zh when zh detections have higher confidence', () => {
		const detections = [
			{ detectedLanguage: 'zh', confidence: 0.9 },
			{ detectedLanguage: 'zh', confidence: 0.8 },
			{ detectedLanguage: 'en', confidence: 0.3 }
		];
		expect(dominantLanguage(detections)).toBe('zh');
	});

	it('returns en when en detections have higher confidence', () => {
		const detections = [
			{ detectedLanguage: 'en', confidence: 0.9 },
			{ detectedLanguage: 'en', confidence: 0.7 }
		];
		expect(dominantLanguage(detections)).toBe('en');
	});

	it('returns zh on tie (zh >= en)', () => {
		const detections = [
			{ detectedLanguage: 'zh', confidence: 0.5 },
			{ detectedLanguage: 'en', confidence: 0.5 }
		];
		expect(dominantLanguage(detections)).toBe('zh');
	});

	it('handles empty detections', () => {
		expect(dominantLanguage([])).toBe('zh'); // tie-breaks to zh
	});

	it('handles zh-CN variant', () => {
		const detections = [{ detectedLanguage: 'zh-CN', confidence: 0.95 }];
		expect(dominantLanguage(detections)).toBe('zh');
	});
});

describe('oppositeLanguage', () => {
	it('returns en for zh', () => {
		expect(oppositeLanguage('zh')).toBe('en');
	});

	it('returns zh for en', () => {
		expect(oppositeLanguage('en')).toBe('zh');
	});
});
