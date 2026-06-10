/**
 * WebNN capability probe for the optional Local Audio Cleanup feature.
 *
 * Cheap and side-effect free: checks `navigator.ml` presence and per-backend
 * `MLContext` creation, retains nothing, builds no graph, fetches no weights.
 * Results gate only the Audio Cleanup feature — never `CapabilityTierV2` or
 * any other tier logic. Probe errors map to `'unknown'`; this never throws.
 */

import type { FeatureSupport, WebNNProbeResult } from '../../protocol';

interface NavigatorLike {
	ml?: ML;
}

async function probeBackend(ml: ML, deviceType: 'cpu' | 'gpu' | 'npu'): Promise<FeatureSupport> {
	try {
		const context = await ml.createContext({ deviceType });
		try {
			context.destroy?.();
		} catch {
			// Context cleanup failures don't change the support verdict.
		}
		return 'supported';
	} catch {
		return 'unsupported';
	}
}

export async function probeWebNN(
	nav: NavigatorLike = globalThis.navigator as NavigatorLike
): Promise<WebNNProbeResult> {
	try {
		const ml = nav?.ml;
		if (!ml || typeof ml.createContext !== 'function') {
			return {
				mlPresent: false,
				backends: { cpu: 'unsupported', gpu: 'unsupported', npu: 'unsupported' },
				modelSupport: 'unknown'
			};
		}
		const [cpu, gpu, npu] = await Promise.all([
			probeBackend(ml, 'cpu'),
			probeBackend(ml, 'gpu'),
			probeBackend(ml, 'npu')
		]);
		return { mlPresent: true, backends: { cpu, gpu, npu }, modelSupport: 'unknown' };
	} catch {
		return {
			mlPresent: false,
			backends: { cpu: 'unknown', gpu: 'unknown', npu: 'unknown' },
			modelSupport: 'unknown'
		};
	}
}

/** True when at least one WebNN backend accepted a context request. */
export function webNNAvailable(probe: WebNNProbeResult | null | undefined): boolean {
	if (!probe?.mlPresent) return false;
	return (
		probe.backends.cpu === 'supported' ||
		probe.backends.gpu === 'supported' ||
		probe.backends.npu === 'supported'
	);
}
