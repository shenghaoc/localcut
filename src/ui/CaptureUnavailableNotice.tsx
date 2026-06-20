import { For, Show, type JSX } from 'solid-js';

interface CaptureUnavailableNoticeProps {
	/** What is unavailable, e.g. "Recording" or "Program Mode". */
	subject: string;
	/** Concrete blocking reasons from `captureUnavailableReasons(probe)`. */
	reasons: readonly string[];
	/**
	 * Optional primary call-to-action rendered beneath the disclosure (e.g. a
	 * link to Diagnostics). When omitted, the surrounding panel's own controls
	 * remain the call-to-action.
	 */
	children?: JSX.Element;
}

/**
 * Compact unavailable state for the capture panels (IA-T3 / D16).
 *
 * Collapses the full `captureUnavailableReasons(probe)` list — which can run to
 * half a dozen lines and dominate the primary panel body — into a one-line
 * status chip plus a `<details>` disclosure holding the full, unchanged reason
 * copy. The summary states the count so the user sees the severity at a glance
 * without the panel becoming a reason dump.
 */
export function CaptureUnavailableNotice(props: CaptureUnavailableNoticeProps) {
	const count = () => props.reasons.length;
	return (
		<div class="capture-unavailable" role="status">
			<p class="capture-unavailable-status">
				<span class="capture-unavailable-dot" aria-hidden="true" />
				<span>{props.subject} unavailable</span>
				<Show when={count() > 0}>
					<span class="capture-unavailable-count">
						{count()} requirement{count() === 1 ? '' : 's'}
					</span>
				</Show>
			</p>
			<Show when={count() > 0}>
				<details class="capture-unavailable-details">
					<summary>View requirements</summary>
					<ul>
						<For each={props.reasons}>{(reason) => <li>{reason}</li>}</For>
					</ul>
				</details>
			</Show>
			{props.children}
		</div>
	);
}
