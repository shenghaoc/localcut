import type { CapabilityProbeResult, FeatureSupport } from '../protocol';

/** One row in the capability matrix. Kept JSX-free here (separate from
 *  `CapabilityMatrixPanel.tsx`) so the pure row builders are unit-testable in the
 *  node test environment, which has no Solid JSX transform. */
export interface CapabilityRow {
	label: string;
	support: FeatureSupport;
	active: boolean;
	action: string | null;
}

export function webnnRow(probe: CapabilityProbeResult): CapabilityRow {
	// Read WebNN from the stored probe snapshot (populated by probeBeauty) like
	// every other row — not a live `navigator.ml` query, so it stays consistent
	// with the snapshot and respects the DEV `__localcutCapabilityOverrides` hook.
	const hasMl = probe.beauty?.webnn === 'supported';
	const ortEp = probe.cleanup?.accelerator;
	return {
		label: 'WebNN (ML acceleration)',
		support: hasMl ? 'supported' : 'unsupported',
		active: ortEp === 'webnn',
		action: hasMl ? `ORT EP: ${ortEp ?? 'wasm'}` : 'Enable the WebNN flag in chrome://flags'
	};
}
