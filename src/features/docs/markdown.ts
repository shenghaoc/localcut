/**
 * Markdown → sanitised HTML for the in-app user guide.
 *
 * Pipeline: marked (GFM) parses the bundled, repo-authored markdown, then
 * DOMPurify sanitises the generated HTML before it is ever assigned via
 * `innerHTML`. User-provided or remote markdown is never rendered here.
 */
import DOMPurify from 'dompurify';
import { Marked } from 'marked';

const parser = new Marked({ gfm: true, async: false });

const EXTERNAL_LINK_PATTERN = /^(https?:)?\/\//i;

let linkHookInstalled = false;

/**
 * External links must open outside the SPA without handing the opener to the
 * target page; in-app `/docs/...` links keep their plain href so DocsArticle
 * can intercept them for history-based navigation.
 */
function installLinkHook(): void {
	if (linkHookInstalled) return;
	linkHookInstalled = true;
	DOMPurify.addHook('afterSanitizeAttributes', (node) => {
		if (node.tagName !== 'A') return;
		const href = node.getAttribute('href') ?? '';
		if (EXTERNAL_LINK_PATTERN.test(href)) {
			node.setAttribute('target', '_blank');
			node.setAttribute('rel', 'noopener noreferrer');
		}
	});
}

export function renderDocHtml(markdown: string): string {
	installLinkHook();
	const rawHtml = parser.parse(markdown, { async: false });
	return DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
}
