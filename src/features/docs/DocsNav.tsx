import { For } from 'solid-js';
import { DOC_SECTIONS, docsPath } from './docsManifest';

interface DocsNavProps {
	activeSlug: string;
	onNavigate: (slug: string) => void;
}

/**
 * Section navigation for the user guide. Real anchors keep middle-click /
 * copy-link working; plain left clicks are intercepted for SPA navigation.
 */
export function DocsNav(props: DocsNavProps) {
	return (
		<nav class="docs-nav" aria-label="User guide sections">
			<For each={DOC_SECTIONS}>
				{(section) => (
					<a
						href={docsPath(section.slug)}
						class={`docs-nav-item${section.slug === props.activeSlug ? ' is-active' : ''}`}
						aria-current={section.slug === props.activeSlug ? 'page' : undefined}
						onClick={(event) => {
							if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
							event.preventDefault();
							props.onNavigate(section.slug);
						}}
					>
						{section.title}
					</a>
				)}
			</For>
		</nav>
	);
}
