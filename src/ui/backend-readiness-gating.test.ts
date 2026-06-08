import { describe, expect, it } from 'vitest';
import appSource from './App.tsx?raw';
import toolbarSource from './Toolbar.tsx?raw';

describe('backend readiness UI gating', () => {
	it('gates transport and timeline media on preview readiness instead of acceleration', () => {
		expect(appSource).toContain('transportDisabled={!previewSurfaceAvailable()}');
		expect(appSource).toContain(
			'assets().length > 0) &&\n\t\t\t\t\t\tpreviewSurfaceAvailable()\n\t\t\t\t\t}'
		);
		expect(appSource).not.toContain('transportDisabled={!accelerated()}');
	});

	it('gates direct export on export readiness and handles reduced blob downloads', () => {
		expect(appSource).toContain('const exportSurfaceAvailable = () => exportReady();');
		expect(appSource).toContain("case 'export-download-ready'");
		expect(appSource).toContain('setTimeout(() => URL.revokeObjectURL(url), 10_000)');
		expect(appSource).not.toContain('queueMicrotask(() => URL.revokeObjectURL(url))');
		expect(appSource).toContain("b.send({ type: 'export-start', settings, output })");
	});

	it('keeps reduced export warnings visible after success clears errors', () => {
		expect(appSource).toContain(
			'const [exportWarnings, setExportWarnings] = createSignal<string[]>([])'
		);
		expect(appSource).toContain('setExportWarnings((warnings) => [...warnings, msg.message])');
		expect(appSource).toContain('warnings={exportWarnings()}');
	});

	it('starts the audio engine whenever the worker has an SAB audio ring', () => {
		expect(appSource).toContain('const [audioSabReady, setAudioSabReady] = createSignal(false)');
		expect(appSource).toContain('setAudioSabReady(audioSab !== null)');
		expect(appSource).toContain('if (audioSabReady()) void audioEngine.play(t)');
		expect(appSource).toContain('if (audioSabReady()) void audioEngine.seek(t)');
	});

	it('labels render queue as core WebGPU only when reduced direct export is available', () => {
		expect(appSource).toContain("if (exportBackend() !== 'core-webgpu')");
		expect(appSource).toContain(
			'Render queue requires the Core WebGPU export tier. Use direct export in this browser tier.'
		);
		expect(appSource).not.toContain('Render queue requires the accelerated WebGPU export path.');
	});

	it('shows the concrete backend label in the toolbar chip', () => {
		expect(appSource).toContain('pipelineLabel={pipelineLabel()}');
		expect(toolbarSource).toContain('pipelineLabel: string');
		expect(toolbarSource).toContain('{props.pipelineLabel}');
	});
});
