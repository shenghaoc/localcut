import { createEffect, createMemo, on } from 'solid-js';
import type { DocSection } from './docsManifest';
import { parseDocsPath } from './docsManifest';
import { renderDocHtml } from './markdown';

interface DocsArticleProps {
	section: DocSection;
	onNavigate: (slug: string) => void;
}

export function DocsArticle(props: DocsArticleProps) {
	let articleRef: HTMLElement | undefined;

	const html = createMemo(() => renderDocHtml(props.section.content));

	// Switching sections is a page navigation: reset scroll and move focus to
	// the article so keyboard and screen-reader users land on the new content.
	createEffect(
		on(
			() => props.section.slug,
			(_slug, previous) => {
				if (!articleRef) return;
				articleRef.scrollTop = 0;
				if (previous !== undefined) articleRef.focus();
			}
		)
	);

	// Markdown cross-links to /docs/... stay inside the SPA.
	const handleClick = (event: MouseEvent) => {
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		const anchor = event.target instanceof Element ? event.target.closest('a') : null;
		const href = anchor?.getAttribute('href');
		if (!href || !href.startsWith('/')) return;
		const slug = parseDocsPath(href);
		if (slug === null) return;
		event.preventDefault();
		props.onNavigate(slug);
	};

	return (
		<article
			ref={(el) => {
				articleRef = el;
			}}
			class="docs-article"
			aria-label={props.section.title}
			tabIndex={-1}
			onClick={handleClick}
			// Sanitised in renderDocHtml: marked output passes through DOMPurify,
			// and only bundled repo-authored markdown is rendered.
			// eslint-disable-next-line solid/no-innerhtml
			innerHTML={html()}
		/>
	);
}
