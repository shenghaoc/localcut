import { describe, expect, it } from 'vite-plus/test';
import { webnnRow } from './capability-rows';
import type { CapabilityProbeResult } from '../protocol';

/** Minimal probe shaped just for `webnnRow` — it reads `beauty.webnn` and
 *  `cleanup.accelerator` only. */
function probe(
	webnn: 'supported' | 'unsupported' | 'unknown',
	accelerator?: 'webnn' | 'webgpu' | 'wasm'
): CapabilityProbeResult {
	return {
		beauty: { webnn },
		cleanup: accelerator ? { accelerator } : {}
	} as unknown as CapabilityProbeResult;
}

describe('webnnRow', () => {
	it('reads "supported" + active from the probe snapshot when WebNN is the ORT EP', () => {
		const row = webnnRow(probe('supported', 'webnn'));
		expect(row.support).toBe('supported');
		expect(row.active).toBe(true);
		expect(row.action).toContain('ORT EP: webnn');
	});

	it('is supported but not active when WebNN is present but a different EP is selected', () => {
		const row = webnnRow(probe('supported', 'webgpu'));
		expect(row.support).toBe('supported');
		expect(row.active).toBe(false);
		expect(row.action).toContain('ORT EP: webgpu');
	});

	it('falls back to "wasm" in the action when no accelerator is resolved yet', () => {
		const row = webnnRow(probe('supported'));
		expect(row.support).toBe('supported');
		expect(row.action).toContain('ORT EP: wasm');
	});

	it('is unsupported with a flag hint when WebNN (navigator.ml) is absent', () => {
		const row = webnnRow(probe('unsupported'));
		expect(row.support).toBe('unsupported');
		expect(row.active).toBe(false);
		expect(row.action).toContain('chrome://flags');
	});

	it('does not read live navigator.ml — derives only from the probe snapshot', () => {
		// `unknown` from the probe must not read as supported even if the host has navigator.ml.
		const row = webnnRow(probe('unknown', 'webnn'));
		expect(row.support).toBe('unsupported');
	});
});
