import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { BookOpen, X } from 'lucide-solid';
import DOMPurify from 'dompurify';
import { Button } from './components/button';
import { renderMarkdown } from './markdown';

/**
 * Vite glob import: loads all markdown files from docs/ as raw strings at build time.
 * Each file becomes a { name: string, content: string } entry keyed by path.
 */
const docModules = import.meta.glob<string>('/docs/*.md', {
	query: '?raw',
	import: 'default',
	eager: true
});

interface DocEntry {
	name: string;
	content: string;
}

function loadDocs(): DocEntry[] {
	return Object.entries(docModules)
		.map(([path, content]) => {
			const fileName = path.split('/').pop() ?? path;
			// Derive a readable name from the filename
			const name = fileName
				.replace(/\.md$/, '')
				.replace(/-/g, ' ')
				.replace(/_/g, ' ')
				.replace(/\b\w/g, (c) => c.toUpperCase());
			return { name, content };
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

interface HelpPanelProps {
	open: boolean;
	/** Doc file name (e.g. "LIVE-STREAMING.md") to open on; defaults to the first doc. */
	initialDocFileName?: string | null;
	onClose: () => void;
}

export function HelpPanel(props: HelpPanelProps) {
	const entries = loadDocs();
	const [activeIndex, setActiveIndex] = createSignal(0);
	let panelRef: HTMLElement | undefined;

	const activeDoc = () => entries[activeIndex()];

	function initialIndex(): number {
		const fileName = props.initialDocFileName;
		if (!fileName) return 0;
		const wanted = fileName.replace(/\.md$/, '').replace(/[-_]/g, ' ').toLowerCase();
		const index = entries.findIndex((entry) => entry.name.toLowerCase() === wanted);
		return index === -1 ? 0 : index;
	}

	createEffect(() => {
		if (props.open) {
			setActiveIndex(initialIndex());
			requestAnimationFrame(() => panelRef?.focus());
		}
	});

	const renderedHtml = createMemo(() => {
		const doc = activeDoc();
		if (!doc) return '';
		return DOMPurify.sanitize(renderMarkdown(doc.content));
	});

	return (
		<Show when={props.open}>
			<div class="help-backdrop" onClick={props.onClose} aria-hidden="true" />
			<aside
				ref={panelRef}
				class="help-panel panel"
				role="dialog"
				aria-modal="true"
				aria-labelledby="help-panel-title"
				tabIndex={-1}
				onKeyDown={(e) => {
					e.stopPropagation();
					if (e.key === 'Escape') {
						props.onClose();
						return;
					}
					if (e.key === 'Tab') {
						const panel = panelRef;
						if (!panel) return;
						const focusable = panel.querySelectorAll<HTMLElement>(
							'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
						);
						if (focusable.length === 0) return;
						const first = focusable[0]!;
						const last = focusable[focusable.length - 1]!;
						if (document.activeElement === panel) {
							e.preventDefault();
							(e.shiftKey ? last : first).focus();
							return;
						}
						if (e.shiftKey && document.activeElement === first) {
							e.preventDefault();
							last.focus();
						} else if (!e.shiftKey && document.activeElement === last) {
							e.preventDefault();
							first.focus();
						}
					}
				}}
			>
				<header class="help-panel-header">
					<div>
						<p class="panel-title" id="help-panel-title">
							<BookOpen size={14} aria-hidden="true" />
							Help &amp; Documentation
						</p>
					</div>
					<Button size="icon" variant="ghost" onClick={props.onClose} aria-label="Close help panel">
						<X size={16} aria-hidden="true" />
					</Button>
				</header>

				<div class="help-panel-body">
					<nav class="help-nav" aria-label="Documentation pages">
						<For each={entries}>
							{(doc, index) => (
								<button
									type="button"
									class={`help-nav-item${index() === activeIndex() ? ' is-active' : ''}`}
									onClick={() => setActiveIndex(index())}
									aria-current={index() === activeIndex() ? 'page' : undefined}
								>
									{doc.name}
								</button>
							)}
						</For>
					</nav>
					{/* eslint-disable-next-line solid/no-innerhtml */}
					<div class="help-content" innerHTML={renderedHtml()} />
				</div>
			</aside>
		</Show>
	);
}
