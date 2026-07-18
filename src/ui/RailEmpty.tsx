import { Show, type JSX } from 'solid-js';

/**
 * Purpose-stating empty state for side-rail panels.
 * Title invites the next action; copy explains; optional actions are real controls.
 */
export function RailEmpty(props: {
	title: string;
	/** Tighter padding for collapsible sub-panels. */
	compact?: boolean;
	children?: JSX.Element;
	actions?: JSX.Element;
}): JSX.Element {
	return (
		<div classList={{ 'rail-empty': true, 'rail-empty--compact': props.compact === true }}>
			<p class="rail-empty-title">{props.title}</p>
			<Show when={props.children}>
				<div class="rail-empty-copy">{props.children}</div>
			</Show>
			<Show when={props.actions}>
				<div class="rail-empty-actions">{props.actions}</div>
			</Show>
		</div>
	);
}
