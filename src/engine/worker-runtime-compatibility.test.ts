import { describe, expect, it } from 'vitest';
import workerSource from './worker.ts?raw';

describe('worker runtime compatibility routing', () => {
	it('uses the compatibility adapter only when that adapter was actually probed', () => {
		expect(workerSource).toContain(
			'const useCompatibilityAdapter = probeResult?.compatibilityAdapter === true;'
		);
		expect(workerSource).toContain(
			'useCompatibilityAdapter\n\t\t\t\t\t\t? await initCompatibilityGpu(canvas)\n\t\t\t\t\t\t: await initGpu(canvas)'
		);
		expect(workerSource).not.toContain(
			"probeResult?.tier === 'compatibility-webgpu' || probeResult?.compatibilityAdapter\n\t\t\t\t\t\t? await initCompatibilityGpu(canvas)"
		);
	});

	it('filters dynamic export codec probes through the current capability tier', () => {
		expect(workerSource).toContain('const probedSupported = await probeExportCodecs(');
		expect(workerSource).toContain('const capabilityProbe = currentCapabilityProbe;');
		expect(workerSource).toContain('exportConstraintsForProbe(capabilityProbe).some(');
	});
});
