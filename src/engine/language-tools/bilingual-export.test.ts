/**
 * Phase 40: bilingual export filename helper tests (T5.3).
 */
import { describe, expect, it } from 'vite-plus/test';
import { languageSuffixedStem } from './bilingual-export';

describe('languageSuffixedStem', () => {
	it('appends the language tag as a stem suffix', () => {
		expect(languageSuffixedStem('clip', 'zh')).toBe('clip.zh');
		expect(languageSuffixedStem('clip', 'en')).toBe('clip.en');
	});

	it('drops an existing extension before suffixing', () => {
		expect(languageSuffixedStem('My Clip.srt', 'zh')).toBe('My Clip.zh');
	});

	it('normalises locale variants to a short tag', () => {
		expect(languageSuffixedStem('clip', 'zh-CN')).toBe('clip.zh-cn');
		expect(languageSuffixedStem('clip', 'English (en)')).toBe('clip.english');
	});

	it('sanitises path-unsafe characters', () => {
		expect(languageSuffixedStem('a/b:c?', 'en')).toBe('a_b_c_.en');
	});

	it('falls back when the stem is empty', () => {
		expect(languageSuffixedStem('   ', 'zh')).toBe('captions.zh');
	});

	it('falls back when the language is missing', () => {
		expect(languageSuffixedStem('clip', null)).toBe('clip.src');
		expect(languageSuffixedStem('clip', undefined, 'translated')).toBe('clip.translated');
	});
});
