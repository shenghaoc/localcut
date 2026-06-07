import { describe, expect, it } from 'vitest';
import appSource from './App.tsx?raw';
import toolbarSource from './Toolbar.tsx?raw';

describe('backend readiness UI gating', () => {
  it('gates transport and timeline media on preview readiness instead of acceleration', () => {
    expect(appSource).toContain('transportDisabled={!previewSurfaceAvailable()}');
    expect(appSource).toContain('&& previewSurfaceAvailable()}');
    expect(appSource).not.toContain('transportDisabled={!accelerated()}');
  });

  it('gates direct export on export readiness and handles reduced blob downloads', () => {
    expect(appSource).toContain('const exportSurfaceAvailable = () => exportReady();');
    expect(appSource).toContain("case 'export-download-ready'");
    expect(appSource).toContain('setTimeout(() => URL.revokeObjectURL(url), 10_000)');
    expect(appSource).not.toContain('queueMicrotask(() => URL.revokeObjectURL(url))');
    expect(appSource).toContain("b.send({ type: 'export-start', settings, output })");
  });

  it('shows the concrete backend label in the toolbar chip', () => {
    expect(appSource).toContain('pipelineLabel={pipelineLabel()}');
    expect(toolbarSource).toContain('pipelineLabel: string');
    expect(toolbarSource).toContain('{props.pipelineLabel}');
  });
});
