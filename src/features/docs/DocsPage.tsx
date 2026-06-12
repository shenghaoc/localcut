import { createEffect, createMemo, onCleanup, onMount } from 'solid-js';
import { ArrowLeft, BookOpen } from 'lucide-solid';
import { Button } from '../../ui/components/button';
import { DOC_SECTIONS, findDocSection } from './docsManifest';
import { DocsNav } from './DocsNav';
import { DocsArticle } from './DocsArticle';

interface DocsPageProps {
	slug: string;
	onNavigate: (slug: string) => void;
	onClose: () => void;
}

/**
 * Full-screen in-app user guide rendered over the editor (which stays
 * mounted, so returning loses no state). Routing is owned by App; this view
 * only reports navigation intents.
 */
export function DocsPage(props: DocsPageProps) {
	let pageRef: HTMLElement | undefined;

	// Index 0 is the guide overview — the manifest is never empty.
	const section = createMemo(() => findDocSection(props.slug) ?? DOC_SECTIONS[0]!);

	onMount(() => {
		pageRef?.focus();
	});

	createEffect(() => {
		document.title = `${section().title} · LocalCut Studio User Guide`;
	});
	onCleanup(() => {
		document.title = 'LocalCut Studio';
	});

	return (
		<section
			ref={(el) => {
				pageRef = el;
			}}
			class="docs-page"
			aria-label="User guide"
			tabIndex={-1}
			onKeyDown={(event) => {
				if (event.key === 'Escape') {
					event.preventDefault();
					props.onClose();
				}
			}}
		>
			<header class="docs-header">
				<Button variant="ghost" onClick={() => props.onClose()}>
					<ArrowLeft size={14} aria-hidden="true" />
					Back to editor
				</Button>
				<p class="docs-header-title">
					<BookOpen size={14} aria-hidden="true" />
					User Guide
				</p>
			</header>
			<div class="docs-body">
				<DocsNav activeSlug={section().slug} onNavigate={props.onNavigate} />
				<DocsArticle section={section()} onNavigate={props.onNavigate} />
			</div>
		</section>
	);
}
