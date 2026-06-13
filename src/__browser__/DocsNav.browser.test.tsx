import { describe, it, expect, afterEach, vi } from 'vite-plus/test';
import { render } from 'solid-js/web';
import { DocsNav } from '../features/docs/DocsNav';

const disposers: Array<() => void> = [];

function renderDocsNav(activeSlug = 'index', onNavigate = vi.fn()) {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const dispose = render(
		() => <DocsNav activeSlug={activeSlug} onNavigate={onNavigate} />,
		container
	);
	disposers.push(dispose);
	return { container, dispose, onNavigate };
}

afterEach(() => {
	for (const dispose of disposers) dispose();
	disposers.length = 0;
	document.body.innerHTML = '';
});

describe('DocsNav', () => {
	it('renders a nav element with accessible label', () => {
		const { container } = renderDocsNav();
		const nav = container.querySelector('nav[aria-label="User guide sections"]');
		expect(nav).not.toBeNull();
	});

	it('renders a link for each section', () => {
		const { container } = renderDocsNav();
		// DOC_SECTIONS has 10 entries from the real manifest
		const links = container.querySelectorAll('a.docs-nav-item');
		expect(links.length).toBeGreaterThanOrEqual(3);
	});

	it('marks the active section with aria-current="page"', () => {
		const { container } = renderDocsNav('getting-started');
		const activeLink = container.querySelector('a[aria-current="page"]');
		expect(activeLink).not.toBeNull();
		expect(activeLink!.textContent).toBe('Getting started');
	});

	it('applies is-active class to the active section', () => {
		const { container } = renderDocsNav('exporting');
		const activeLink = container.querySelector('a.is-active');
		expect(activeLink).not.toBeNull();
		expect(activeLink!.textContent).toBe('Exporting');
	});

	it('calls onNavigate when a non-active link is clicked', () => {
		const { container, onNavigate } = renderDocsNav('index');
		const targetLink = container.querySelector(
			'a[href="/docs/getting-started"]'
		) as HTMLAnchorElement;
		targetLink.click();
		expect(onNavigate).toHaveBeenCalledWith('getting-started');
	});

	it('does not call onNavigate when a modifier key is held', () => {
		const { container, onNavigate } = renderDocsNav('index');
		const targetLink = container.querySelector(
			'a[href="/docs/getting-started"]'
		) as HTMLAnchorElement;
		// Dispatch a click with metaKey held — should not be intercepted
		const event = new MouseEvent('click', { bubbles: true, metaKey: true });
		targetLink.dispatchEvent(event);
		expect(onNavigate).not.toHaveBeenCalled();
	});

	it('sets correct href attributes for SPA routing', () => {
		const { container } = renderDocsNav();
		const indexLink = container.querySelector('a[href="/docs"]');
		const startLink = container.querySelector('a[href="/docs/getting-started"]');
		expect(indexLink).not.toBeNull();
		expect(startLink).not.toBeNull();
	});
});
