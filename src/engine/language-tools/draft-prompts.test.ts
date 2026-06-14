/**
 * Phase 40: Draft prompts tests.
 *
 * Tests prompt building and defensive parsing for titles/hashtags/文案.
 */
import { describe, expect, it } from 'vite-plus/test';
import { buildDraftPrompt, parseDraftResponse } from './draft-prompts';

describe('buildDraftPrompt', () => {
	it('includes the transcript in the prompt', () => {
		const prompt = buildDraftPrompt('Hello world transcript');
		expect(prompt).toContain('Hello world transcript');
	});

	it('requests titles, hashtags, and caption', () => {
		const prompt = buildDraftPrompt('test');
		expect(prompt).toContain('TITLES:');
		expect(prompt).toContain('HASHTAGS:');
		expect(prompt).toContain('CAPTION:');
	});
});

describe('parseDraftResponse', () => {
	it('parses a well-formatted response', () => {
		const response = `TITLES:
My Great Video
Amazing Content
Best Moments
HASHTAGS:
#video #content #amazing #test #fun
CAPTION:
这是一个很棒的视频，展示了最好的时刻。`;

		const result = parseDraftResponse(response);
		expect(result.titles).toEqual(['My Great Video', 'Amazing Content', 'Best Moments']);
		expect(result.hashtags).toEqual(['#video', '#content', '#amazing', '#test', '#fun']);
		expect(result.caption).toBe('这是一个很棒的视频，展示了最好的时刻。');
	});

	it('limits titles to 3', () => {
		const response = `TITLES:
Title 1
Title 2
Title 3
Title 4
Title 5
HASHTAGS:
#tag
CAPTION:
caption`;

		const result = parseDraftResponse(response);
		expect(result.titles).toHaveLength(3);
	});

	it('limits hashtags to 5', () => {
		const response = `TITLES:
Title
HASHTAGS:
#a #b #c #d #e #f #g
CAPTION:
caption`;

		const result = parseDraftResponse(response);
		expect(result.hashtags).toHaveLength(5);
	});

	it('filters out non-hashtag tokens', () => {
		const response = `TITLES:
Title
HASHTAGS:
#valid nottag #also-valid
CAPTION:
caption`;

		const result = parseDraftResponse(response);
		expect(result.hashtags).toEqual(['#valid', '#also-valid']);
	});

	it('handles missing sections gracefully', () => {
		const response = 'Some random text without any structure';
		const result = parseDraftResponse(response);
		expect(result.titles).toEqual([]);
		expect(result.hashtags).toEqual([]);
		expect(result.caption).toBe('');
	});

	it('handles partial response', () => {
		const response = `TITLES:
Only Title
HASHTAGS:`;
		const result = parseDraftResponse(response);
		expect(result.titles).toEqual(['Only Title']);
		expect(result.hashtags).toEqual([]);
		expect(result.caption).toBe('');
	});

	it('handles case-insensitive headers', () => {
		const response = `titles:
My Title
hashtags:
#tag
caption:
My caption`;

		const result = parseDraftResponse(response);
		expect(result.titles).toEqual(['My Title']);
		expect(result.hashtags).toEqual(['#tag']);
		expect(result.caption).toBe('My caption');
	});

	it('trims whitespace from parsed values', () => {
		const response = `TITLES:
  Trimmed Title
HASHTAGS:
  #tag
CAPTION:
  Trimmed caption  `;

		const result = parseDraftResponse(response);
		expect(result.titles[0]).toBe('Trimmed Title');
		expect(result.caption).toBe('Trimmed caption');
	});
});
