import { describe, it, expect, afterEach } from 'vite-plus/test';
import { render } from 'solid-js/web';
import { LimitedPreview } from '../ui/LimitedPreview';

const defaultProps = {
	thumbnailUrl: 'data:image/png;base64,iVBORw0KGgo=',
	fileName: 'clip-001.mp4',
	width: 1920,
	height: 1080,
	duration: 125.5
};

const disposers: Array<() => void> = [];

function renderLimitedPreview(props = defaultProps) {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const dispose = render(() => <LimitedPreview {...props} />, container);
	disposers.push(dispose);
	return { container, dispose };
}

afterEach(() => {
	for (const dispose of disposers) dispose();
	disposers.length = 0;
	document.body.innerHTML = '';
});

describe('LimitedPreview', () => {
	it('renders the compatibility preview container', () => {
		const { container } = renderLimitedPreview();
		const preview = container.querySelector('[aria-label="Compatibility preview"]');
		expect(preview).not.toBeNull();
	});

	it('renders the thumbnail image with correct alt text', () => {
		const { container } = renderLimitedPreview();
		const img = container.querySelector('img');
		expect(img).not.toBeNull();
		expect(img!.alt).toBe('Compatibility thumbnail for clip-001.mp4');
		expect(img!.src).toContain('data:image/png');
	});

	it('displays resolution and duration in the metadata strip', () => {
		const { container } = renderLimitedPreview();
		const meta = container.querySelector('.limited-preview-copy');
		expect(meta).not.toBeNull();
		expect(meta!.textContent).toContain('clip-001.mp4');
		expect(meta!.textContent).toContain('1920×1080');
		expect(meta!.textContent).toContain('2:05');
	});

	it('renders the compatibility preview badge', () => {
		const { container } = renderLimitedPreview();
		const badge = container.querySelector('.limited-preview-badge');
		expect(badge).not.toBeNull();
		expect(badge!.textContent).toBe('Compatibility preview');
	});

	it('formats durations over one hour correctly', () => {
		const { container } = renderLimitedPreview({
			...defaultProps,
			duration: 3723
		});
		const meta = container.querySelector('.limited-preview-copy');
		expect(meta!.textContent).toContain('1:02:03');
	});

	it('formats zero duration as 0:00', () => {
		const { container } = renderLimitedPreview({
			...defaultProps,
			duration: 0
		});
		const meta = container.querySelector('.limited-preview-copy');
		expect(meta!.textContent).toContain('0:00');
	});

	it('sets width and height attributes on the image', () => {
		const { container } = renderLimitedPreview();
		const img = container.querySelector('img')!;
		expect(img.getAttribute('width')).toBe('1920');
		expect(img.getAttribute('height')).toBe('1080');
	});
});
