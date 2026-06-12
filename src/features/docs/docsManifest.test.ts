import { describe, expect, it } from 'vite-plus/test';
import {
	DOC_SECTIONS,
	DOCS_BASE_PATH,
	DOCS_INDEX_SLUG,
	docsPath,
	findDocSection,
	parseDocsPath
} from './docsManifest';

describe('docs manifest', () => {
	it('contains every expected user guide section', () => {
		const slugs = DOC_SECTIONS.map((section) => section.slug);
		expect(slugs).toEqual(
			expect.arrayContaining([
				DOCS_INDEX_SLUG,
				'getting-started',
				'importing-media',
				'timeline-editing',
				'exporting',
				'browser-limitations',
				'performance',
				'faq',
				'troubleshooting',
				'live-streaming'
			])
		);
	});

	it('has unique slugs and non-empty titles', () => {
		const slugs = DOC_SECTIONS.map((section) => section.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
		for (const section of DOC_SECTIONS) {
			expect(section.title.length).toBeGreaterThan(0);
		}
	});

	it('bundles markdown content with a single top-level heading', () => {
		for (const section of DOC_SECTIONS) {
			expect(section.content.startsWith('# '), `${section.slug} starts with an h1`).toBe(true);
			const h1Count = section.content.split('\n').filter((line) => line.startsWith('# ')).length;
			expect(h1Count, `${section.slug} has exactly one h1`).toBe(1);
		}
	});

	it('only cross-links to sections that exist', () => {
		const pattern = /\]\(\/docs(?:\/([a-z0-9-]+))?\)/g;
		for (const section of DOC_SECTIONS) {
			for (const match of section.content.matchAll(pattern)) {
				const slug = match[1] ?? DOCS_INDEX_SLUG;
				expect(findDocSection(slug), `${section.slug} links to ${slug}`).not.toBeNull();
			}
		}
	});
});

describe('docsPath', () => {
	it('maps the index section to the base path', () => {
		expect(docsPath(DOCS_INDEX_SLUG)).toBe(DOCS_BASE_PATH);
	});

	it('maps sections to subpaths', () => {
		expect(docsPath('exporting')).toBe('/docs/exporting');
	});

	it('round-trips every section through parseDocsPath', () => {
		for (const section of DOC_SECTIONS) {
			expect(parseDocsPath(docsPath(section.slug))).toBe(section.slug);
		}
	});
});

describe('parseDocsPath', () => {
	it('returns null outside /docs', () => {
		expect(parseDocsPath('/')).toBeNull();
		expect(parseDocsPath('/editor')).toBeNull();
		expect(parseDocsPath('/docsx')).toBeNull();
		expect(parseDocsPath('')).toBeNull();
	});

	it('maps /docs and trailing slashes to the index section', () => {
		expect(parseDocsPath('/docs')).toBe(DOCS_INDEX_SLUG);
		expect(parseDocsPath('/docs/')).toBe(DOCS_INDEX_SLUG);
		expect(parseDocsPath('/docs/exporting/')).toBe('exporting');
	});

	it('normalises unknown sections to the index instead of dead-ending', () => {
		expect(parseDocsPath('/docs/no-such-page')).toBe(DOCS_INDEX_SLUG);
	});
});
