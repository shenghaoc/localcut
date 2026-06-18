/**
 * Guards the Phase 27/28 hard constraints at the module-graph level:
 *
 *  - App startup never references model weights or spawns the cleanup worker
 *    (R0.2/A1): the cleanup worker module may only be reached through the
 *    dynamic import in `cleanup-bridge.ts`.
 *  - The pipeline worker never imports inference/model modules (R0.5): only
 *    the pure `cleaned-audio` routing helper is allowed.
 *  - Importing the startup-adjacent modules performs zero network fetches.
 */

import { describe, expect, it, vi } from 'vite-plus/test';
import appSource from '../../ui/App.tsx?raw';
import toolbarSource from '../../ui/Toolbar.tsx?raw';
import panelSource from '../../ui/AudioCleanupPanel.tsx?raw';
import bridgeSource from '../../ui/cleanup-bridge.ts?raw';
import controllerSource from '../../ui/cleanup-controller.ts?raw';
import pipelineWorkerSource from '../worker.ts?raw';
import probeSource from '../capability-probe-v2.ts?raw';

describe('no model load at startup (module graph)', () => {
	it('App.tsx never statically imports the cleanup workers or model modules', () => {
		expect(appSource).not.toMatch(/from\s+['"].*cleanup-ort-worker/);
		expect(appSource).not.toMatch(/dtln-runtime|dtln-ort-runtime|dtln-dsp|model-manifest/);
	});

	it('the cleanup worker is reachable only via URL constructor in cleanup-bridge', () => {
		expect(bridgeSource).toMatch(
			/new\s+URL\(\s*['"]\.\.\/engine\/audio-cleanup\/cleanup-ort-worker/
		);
		expect(bridgeSource).not.toMatch(/^import .*cleanup-ort-worker/m);
	});

	it('the pipeline worker imports no inference or model modules', () => {
		const importPaths = [...pipelineWorkerSource.matchAll(/from\s+'([^']+)'/g)].map(
			(match) => match[1]!
		);
		expect(
			importPaths.filter((path) =>
				/cleanup-ort-worker|dtln-runtime|dtln-ort-runtime|dtln-dsp|model-manifest/i.test(path)
			)
		).toEqual([]);
		expect(importPaths).toContain('./audio-cleanup/cleaned-audio');
	});

	it('the capability probe references no model/weights URLs', () => {
		expect(probeSource).not.toMatch(/weights|manifest\.json|dtln-runtime/);
	});

	it('the toolbar and panel modules reference no weights URL or worker import', () => {
		expect(toolbarSource).not.toMatch(/cleanup-ort-worker|weights\.bin/);
		expect(panelSource).not.toMatch(/cleanup-ort-worker|weights\.bin|fetch\(/);
	});

	it('the controller only fetches through injected ports (no direct fetch)', () => {
		expect(controllerSource).not.toMatch(/fetch\(/);
	});
});

describe('no model load at startup (runtime)', () => {
	it('importing probe + controller + bridge modules triggers zero fetches and zero worker spawns', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const workerSpy = vi.fn();
		vi.stubGlobal('Worker', workerSpy);
		try {
			await import('../capability-probe-v2');
			await import('../../ui/cleanup-controller');
			await import('../../ui/cleanup-bridge');
			await import('./onnx-model-manifest');
			expect(fetchSpy).not.toHaveBeenCalled();
			expect(workerSpy).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('probing capabilities (no WebNN present) fetches nothing', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		try {
			const { probeCapabilities } = await import('../capability-probe-v2');
			await probeCapabilities();
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
