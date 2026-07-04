import { createSignal, type JSX } from 'solid-js';
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

	return (
		<div class="insert-row">
			<div class="insert-header">
				<Button
					variant="ghost"
					size="icon"
					onClick={props.onToggleBypass}
					aria-label={props.bypass ? `Enable ${props.label}` : `Bypass ${props.label}`}
					aria-pressed={!props.bypass}
				>
					{props.bypass ? (
						<PowerOff size={14} aria-hidden="true" />
					) : (
						<Power size={14} aria-hidden="true" />
					)}
				</Button>
				<button
					class="insert-expand"
					type="button"
					onClick={() => setExpanded(!expanded())}
					aria-expanded={expanded()}
					aria-controls={`insert-params-${props.label}`}
				>
					{props.icon}
					<span class="insert-name">{props.label}</span>
					<span class={`insert-status ${props.bypass ? 'bypassed' : 'active'}`}>
						{props.bypass ? 'Bypassed' : 'Active'}
					</span>
				</button>
			</div>
			{expanded() ? (
				<div class="insert-params" id={`insert-params-${props.label}`}>
					{props.children}
				</div>
			) : null}
		</div>
	);
}
