import { createSignal, createUniqueId, Show, type JSX } from 'solid-js';
import { Power, PowerOff } from 'lucide-solid';
import { Button } from './components/button';

export interface AudioInsertRowProps {
	label: string;
	icon?: JSX.Element;
	bypass: boolean;
	onToggleBypass: () => void;
	children?: JSX.Element;
}

export function AudioInsertRow(props: AudioInsertRowProps) {
	const [expanded, setExpanded] = createSignal(false);
	const paramsId = createUniqueId();

	return (
		<div class="insert-row">
			<div class="insert-header">
				<Button
					variant="ghost"
					size="icon"
					onClick={props.onToggleBypass}
					aria-label={props.label}
					aria-pressed={!props.bypass}
				>
					<Show when={props.bypass} fallback={<Power size={14} aria-hidden="true" />}>
						<PowerOff size={14} aria-hidden="true" />
					</Show>
				</Button>
				<button
					class="insert-expand"
					type="button"
					onClick={() => setExpanded(!expanded())}
					aria-expanded={expanded()}
					aria-controls={paramsId}
				>
					{props.icon}
					<span class="insert-name">{props.label}</span>
					<span class={`insert-status ${props.bypass ? 'bypassed' : 'active'}`}>
						{props.bypass ? 'Bypassed' : 'Active'}
					</span>
				</button>
			</div>
			<Show when={expanded()}>
				<div class="insert-params" id={paramsId}>
					{props.children}
				</div>
			</Show>
		</div>
	);
}
