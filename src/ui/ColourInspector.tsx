/** Colour metadata inspector section — Phase 21.
 *
 *  Read-only display of source colour metadata for the selected clip,
 *  plus any active HDR / gamut warnings.
 */

import { For, createMemo } from 'solid-js';
import type { HDRWarningSnapshot } from '../protocol';

export interface ColourInspectorProps {
	primaries: string | null;
	transfer: string | null;
	matrix: string | null;
	origin: string | null;
	fullRange: boolean | null;
	warnings: HDRWarningSnapshot[];
}

export default function ColourInspector(props: ColourInspectorProps) {
	const hasMetadata = createMemo(() => props.origin !== null && props.origin !== 'none');
	const hasWarnings = createMemo(() => props.warnings.length > 0);

	return (
		<section class="inspector-section colour-section">
			<h3 class="inspector-heading">Colour</h3>

			{!hasMetadata() && !hasWarnings() && <p class="colour-none">No colour metadata available.</p>}

			{hasMetadata() && (
				<dl class="colour-metadata">
					<dt>Origin</dt>
					<dd>{props.origin}</dd>
					<dt>Primaries</dt>
					<dd>{props.primaries ?? 'Unknown'}</dd>
					<dt>Transfer</dt>
					<dd>{props.transfer ?? 'Unknown'}</dd>
					<dt>Matrix</dt>
					<dd>{props.matrix ?? 'Unknown'}</dd>
					<dt>Range</dt>
					<dd>{props.fullRange ? 'Full' : 'Limited'}</dd>
				</dl>
			)}

			{hasWarnings() && (
				<ul class="colour-warnings">
					<For each={props.warnings}>
						{(w) => (
							<li
								class={`colour-warning colour-warning--${w.type === 'hdr-content-detected' ? 'amber' : 'red'}`}
							>
								{w.message}
							</li>
						)}
					</For>
				</ul>
			)}
		</section>
	);
}
