import { describe, it, expect, afterEach } from 'vite-plus/test';
import { render } from 'solid-js/web';
import { createSignal, For } from 'solid-js';
import { Tabs } from '@ark-ui/solid/tabs';
import '../global.css';
import {
	SIDE_RAIL_TABS,
	isSideRailTab,
	sideRailTabTriggerId,
	type SideRailTab
} from '../ui/side-rail-tabs';

const disposers: Array<() => void> = [];

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function renderSideRailTabs(widthPx = 302): HTMLElement {
	const container = document.createElement('div');
	container.style.width = `${widthPx}px`;
	document.body.appendChild(container);
	const [value, setValue] = createSignal<SideRailTab>('inspector');
	const dispose = render(
		() => (
			<Tabs.Root
				class="side-rail-tabs"
				value={value()}
				onValueChange={(details) => {
					if (isSideRailTab(details.value)) setValue(details.value);
				}}
			>
				<Tabs.List class="side-rail-tab-bar" aria-label="Side panel tabs">
					<For each={SIDE_RAIL_TABS}>
						{(tab) => (
							<Tabs.Trigger id={sideRailTabTriggerId(tab.id)} value={tab.id} class="side-rail-tab">
								{tab.label}
							</Tabs.Trigger>
						)}
					</For>
					<button type="button" class="side-rail-collapse" aria-label="Collapse side panel">
						›
					</button>
				</Tabs.List>
			</Tabs.Root>
		),
		container
	);
	disposers.push(dispose);
	return container;
}

afterEach(() => {
	for (const dispose of disposers) dispose();
	disposers.length = 0;
	document.body.innerHTML = '';
});

describe('right-rail primary destinations (IA-T4 / IA-T5)', () => {
	it('fits and switches all four destinations inside a 1280x720 rail width', async () => {
		const container = renderSideRailTabs();
		await nextFrame();

		const bar = container.querySelector<HTMLElement>('.side-rail-tab-bar');
		expect(bar).not.toBeNull();
		const style = getComputedStyle(bar!);
		expect(style.overflowX).not.toBe('auto');
		expect(style.overflowX).not.toBe('scroll');
		expect(bar!.scrollWidth).toBeLessThanOrEqual(bar!.clientWidth + 1);

		const barRect = bar!.getBoundingClientRect();
		const tabs = Array.from(bar!.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
		expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
			'Inspector',
			'Text',
			'Audio',
			'Capture'
		]);

		for (const tab of tabs) {
			const rect = tab.getBoundingClientRect();
			expect(rect.width).toBeGreaterThan(1);
			expect(rect.left).toBeGreaterThanOrEqual(barRect.left - 0.5);
			expect(rect.right).toBeLessThanOrEqual(barRect.right + 0.5);

			tab.click();
			await nextFrame();
			expect(tab.getAttribute('data-selected')).not.toBeNull();
		}
	});
});
