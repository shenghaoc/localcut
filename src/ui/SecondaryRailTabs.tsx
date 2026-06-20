import { For, type JSX } from 'solid-js';

export function secondaryTabId(prefix: string, tab: string): string {
	return `${prefix}-tab-${tab}`;
}

export function secondaryPanelId(prefix: string, tab: string): string {
	return `${prefix}-panel-${tab}`;
}

export function SecondaryRailTabs<T extends string>(props: {
	idPrefix: string;
	label: string;
	tabs: readonly { readonly id: T; readonly label: string }[];
	value: T;
	onSelect: (tab: T) => void;
}): JSX.Element {
	const focusTab = (tab: T): void => {
		const tabId = secondaryTabId(props.idPrefix, tab);
		queueMicrotask(() => {
			document.getElementById(tabId)?.focus();
		});
	};
	const selectByOffset = (offset: number): void => {
		const currentIndex = props.tabs.findIndex((tab) => tab.id === props.value);
		if (currentIndex < 0 || props.tabs.length === 0) return;
		const nextIndex = (currentIndex + offset + props.tabs.length) % props.tabs.length;
		const nextTab = props.tabs[nextIndex];
		if (!nextTab) return;
		props.onSelect(nextTab.id);
		focusTab(nextTab.id);
	};
	const selectEdge = (edge: 'first' | 'last'): void => {
		const nextTab = edge === 'first' ? props.tabs[0] : props.tabs[props.tabs.length - 1];
		if (!nextTab) return;
		props.onSelect(nextTab.id);
		focusTab(nextTab.id);
	};
	const onKeyDown = (event: KeyboardEvent): void => {
		switch (event.key) {
			case 'ArrowRight':
			case 'ArrowDown':
				event.preventDefault();
				selectByOffset(1);
				break;
			case 'ArrowLeft':
			case 'ArrowUp':
				event.preventDefault();
				selectByOffset(-1);
				break;
			case 'Home':
				event.preventDefault();
				selectEdge('first');
				break;
			case 'End':
				event.preventDefault();
				selectEdge('last');
				break;
		}
	};

	return (
		<div
			class="side-rail-secondary-tabs"
			role="tablist"
			aria-label={props.label}
			onKeyDown={onKeyDown}
		>
			<For each={props.tabs}>
				{(tab) => (
					<button
						type="button"
						id={secondaryTabId(props.idPrefix, tab.id)}
						class="side-rail-secondary-tab"
						role="tab"
						tabIndex={props.value === tab.id ? 0 : -1}
						aria-selected={props.value === tab.id ? 'true' : 'false'}
						aria-controls={secondaryPanelId(props.idPrefix, tab.id)}
						onClick={() => props.onSelect(tab.id)}
					>
						{tab.label}
					</button>
				)}
			</For>
		</div>
	);
}

export function SecondaryRailPanel<T extends string>(props: {
	idPrefix: string;
	tab: T;
	value: T;
	keepMounted?: boolean;
	children: JSX.Element;
}): JSX.Element {
	const active = (): boolean => props.value === props.tab;

	return (
		<div
			id={secondaryPanelId(props.idPrefix, props.tab)}
			class="side-rail-secondary-panel"
			role="tabpanel"
			tabIndex={0}
			hidden={!active()}
			aria-labelledby={secondaryTabId(props.idPrefix, props.tab)}
		>
			{active() || props.keepMounted ? props.children : null}
		</div>
	);
}
