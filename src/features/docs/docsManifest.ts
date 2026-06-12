/**
 * In-app user guide manifest. Every section is bundled at build time via
 * Vite raw imports — nothing is fetched at runtime, and only this local,
 * repo-authored content is ever rendered.
 */
import indexContent from './content/index.md?raw';
import gettingStartedContent from './content/getting-started.md?raw';
import importingMediaContent from './content/importing-media.md?raw';
import timelineEditingContent from './content/timeline-editing.md?raw';
import exportingContent from './content/exporting.md?raw';
import browserLimitationsContent from './content/browser-limitations.md?raw';
import performanceContent from './content/performance.md?raw';
import faqContent from './content/faq.md?raw';
import troubleshootingContent from './content/troubleshooting.md?raw';
import liveStreamingContent from './content/live-streaming.md?raw';

export interface DocSection {
	/** URL segment under /docs; the index section maps to /docs itself. */
	readonly slug: string;
	/** Navigation label. */
	readonly title: string;
	/** Raw markdown source. */
	readonly content: string;
}

export const DOCS_BASE_PATH = '/docs';
export const DOCS_INDEX_SLUG = 'index';

export const DOC_SECTIONS: readonly DocSection[] = [
	{ slug: DOCS_INDEX_SLUG, title: 'Overview', content: indexContent },
	{ slug: 'getting-started', title: 'Getting started', content: gettingStartedContent },
	{ slug: 'importing-media', title: 'Importing media', content: importingMediaContent },
	{ slug: 'timeline-editing', title: 'Timeline editing', content: timelineEditingContent },
	{ slug: 'exporting', title: 'Exporting', content: exportingContent },
	{ slug: 'live-streaming', title: 'Live streaming', content: liveStreamingContent },
	{
		slug: 'browser-limitations',
		title: 'Browser limitations',
		content: browserLimitationsContent
	},
	{ slug: 'performance', title: 'Performance', content: performanceContent },
	{ slug: 'troubleshooting', title: 'Troubleshooting', content: troubleshootingContent },
	{ slug: 'faq', title: 'FAQ', content: faqContent }
];

export function findDocSection(slug: string): DocSection | null {
	return DOC_SECTIONS.find((section) => section.slug === slug) ?? null;
}

/** Path for a section, e.g. `/docs/exporting`; the index section is `/docs`. */
export function docsPath(slug: string): string {
	return slug === DOCS_INDEX_SLUG ? DOCS_BASE_PATH : `${DOCS_BASE_PATH}/${slug}`;
}

/**
 * Maps a pathname onto a docs slug, or null when the path is outside /docs.
 * Unknown subpaths normalise to the index section so stale deep links still
 * land in the guide instead of a dead end.
 */
export function parseDocsPath(pathname: string): string | null {
	const path = pathname.replace(/\/+$/, '') || '/';
	if (path === DOCS_BASE_PATH) return DOCS_INDEX_SLUG;
	if (!path.startsWith(`${DOCS_BASE_PATH}/`)) return null;
	const slug = path.slice(DOCS_BASE_PATH.length + 1);
	return findDocSection(slug) ? slug : DOCS_INDEX_SLUG;
}
