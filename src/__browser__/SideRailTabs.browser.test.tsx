import { describe, it, expect, afterEach } from 'vite-plus/test';
import { render } from 'solid-js/web';
import { createSignal, For } from 'solid-js';
import { Tabs } from '@ark-ui/solid/tabs';
import '../global.css';
import {
	CAPTURE_SIDE_RAIL_TABS,
	SIDE_RAIL_TABS,
	isSideRailTab,
	sideRailTabTriggerId,
	type CaptureSideRailTab,
	type SideRailTab
} from '../ui/side-rail-tabs';
import { SecondaryRailPanel, SecondaryRailTabs } from '../ui/SecondaryRailTabs';

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

function renderSecondaryCaptureTabs(): HTMLElement {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const [value, setValue] = createSignal<CaptureSideRailTab>('record');
	const dispose = render(
		() => (
			<div class="side-rail-tab-panel">
				<SecondaryRailTabs
					idPrefix="capture"
					label="Capture tools"
					tabs={CAPTURE_SIDE_RAIL_TABS}
					value={value()}
					onSelect={(tab) => setValue(tab)}
				/>
				<For each={CAPTURE_SIDE_RAIL_TABS}>
					{(tab) => (
						<SecondaryRailPanel
							idPrefix="capture"
							tab={tab.id}
							value={value()}
							keepMounted={tab.id !== 'publish'}
						>
							<button type="button">Panel {tab.label}</button>
						</SecondaryRailPanel>
					)}
				</For>
			</div>
		),
		container
	);
	disposers.push(dispose);
	return container;
}

function renderSecondarySoloTab(): HTMLElement {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const dispose = render(
		() => (
			<div class="side-rail-tab-panel">
				<SecondaryRailTabs
					idPrefix="text"
					label="Text tools"
					tabs={[{ id: 'captions', label: 'Captions' }] as const}
					value="captions"
					onSelect={() => {}}
				/>
				<SecondaryRailPanel idPrefix="text" tab="captions" value="captions" keepMounted>
					<button type="button">Captions panel</button>
				</SecondaryRailPanel>
			</div>
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

	it('keeps secondary Capture destinations at three jobs (Replay lives under Record)', async () => {
		const container = renderSecondaryCaptureTabs();
		await nextFrame();

		const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
		expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['Record', 'Program', 'Go Live']);

		for (const tab of tabs) {
			const panelId = tab.getAttribute('aria-controls');
			expect(panelId).toBeTruthy();
			if (!panelId) throw new Error('secondary tab is missing aria-controls');
			expect(document.getElementById(panelId)).not.toBeNull();
		}

		const panels = Array.from(container.querySelectorAll<HTMLDivElement>('[role="tabpanel"]'));
		expect(panels).toHaveLength(3);
		for (const panel of panels) {
			expect(panel.tabIndex).toBe(0);
			const tabId = panel.getAttribute('aria-labelledby');
			if (!tabId) throw new Error('secondary panel is missing aria-labelledby');
			expect(document.getElementById(tabId)).not.toBeNull();
		}

		const [record, program, publish] = tabs;
		if (!record || !program || !publish) throw new Error('expected three secondary tabs');
		expect(record.tabIndex).toBe(0);
		expect(record.getAttribute('aria-selected')).toBe('true');
		expect(program.tabIndex).toBe(-1);
		expect(document.getElementById('capture-panel-record')?.hidden).toBe(false);
		expect(document.getElementById('capture-panel-program')?.hidden).toBe(true);
		expect(document.getElementById('capture-panel-record')?.querySelector('button')).not.toBeNull();
		expect(
			document.getElementById('capture-panel-program')?.querySelector('button')
		).not.toBeNull();
		expect(document.getElementById('capture-panel-publish')?.querySelector('button')).toBeNull();

		record.focus();
		record.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		await nextFrame();
		expect(program.tabIndex).toBe(0);
		expect(program.getAttribute('aria-selected')).toBe('true');
		expect(document.activeElement).toBe(program);
		expect(document.getElementById('capture-panel-program')?.hidden).toBe(false);
		expect(document.getElementById('capture-panel-record')?.querySelector('button')).not.toBeNull();
		expect(
			document.getElementById('capture-panel-program')?.querySelector('button')
		).not.toBeNull();

		program.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
		await nextFrame();
		expect(publish.tabIndex).toBe(0);
		expect(document.activeElement).toBe(publish);
		expect(
			document.getElementById('capture-panel-publish')?.querySelector('button')
		).not.toBeNull();

		publish.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
		await nextFrame();
		expect(record.tabIndex).toBe(0);
		expect(program.tabIndex).toBe(-1);
		expect(document.activeElement).toBe(record);
		expect(document.getElementById('capture-panel-publish')?.querySelector('button')).toBeNull();
	});

	it('hides the secondary tab bar when only one destination is available', async () => {
		const container = renderSecondarySoloTab();
		await nextFrame();
		expect(container.querySelector('[role="tablist"]')).toBeNull();
		expect(container.querySelector('[role="tabpanel"]')).not.toBeNull();
		expect(container.textContent).toContain('Captions panel');
	});
});
