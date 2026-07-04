import { describe, expect, it } from 'vite-plus/test';
import interpolationEngineSource from '../engine/interpolation/interpolation-engine.ts?raw';
import blobDownloadSource from '../lib/blob-download.ts?raw';
import audioInsertRowSource from './AudioInsertRow.tsx?raw';
import languageToolsPanelSource from './LanguageToolsPanel.tsx?raw';
import previewGizmoSource from './PreviewGizmo.tsx?raw';
import reframeOverlaySource from './ReframeOverlay.tsx?raw';
import timelineSource from './Timeline.tsx?raw';

describe('review comment regression guards', () => {
	it('handles queued tensor cleanup after device-loss rejections', () => {
		expect(interpolationEngineSource).toContain('.onSubmittedWorkDone()');
		expect(interpolationEngineSource).toContain('.catch(() => {})');
		expect(interpolationEngineSource).toContain('.finally(() => outputTensor.dispose())');
	});

	it('keeps shared blob downloads DOM-backed and short-lived', () => {
		expect(blobDownloadSource).toContain('document.body.appendChild(a)');
		expect(blobDownloadSource).toContain('document.body.removeChild(a)');
		expect(blobDownloadSource).toContain('setTimeout(() => URL.revokeObjectURL(url), 1_000)');
	});

	it('does not scale bordered review overlays', () => {
		expect(reframeOverlaySource).toContain('width: `${cropRect()!.width}%`');
		expect(reframeOverlaySource).toContain('height: `${cropRect()!.height}%`');
		expect(reframeOverlaySource).not.toContain(
			'transform: `scaleX(${cropRect()!.width / 100}) scaleY(${cropRect()!.height / 100})`'
		);

		expect(timelineSource).toContain('width: `${box().width}px`');
		expect(timelineSource).toContain('height: `${box().height}px`');
		expect(timelineSource).not.toContain(
			'transform: `scaleX(${box().width}) scaleY(${box().height})`'
		);
	});

	it('keeps preview gizmo rotation centered', () => {
		expect(previewGizmoSource).toContain(
			'const centerTranslate = `${b.left + cx - 50}px ${b.top + cy - 50}px`'
		);
		expect(previewGizmoSource).toContain('translate: centerTranslate');
		expect(previewGizmoSource).toContain("'transform-origin': '50% 50%'");
	});

	it('uses Solid Show for audio insert conditional rendering', () => {
		expect(audioInsertRowSource).toContain('Show, type JSX');
		expect(audioInsertRowSource).toContain('<Show when={props.bypass}');
		expect(audioInsertRowSource).toContain('<Show when={expanded()}>');
	});

	it('clears stale language-tool copy feedback timers', () => {
		expect(languageToolsPanelSource).toContain('let copiedFieldResetTimer');
		expect(languageToolsPanelSource).toContain('onCleanup(() => {');
		expect(languageToolsPanelSource).toContain('function scheduleCopiedFieldReset()');
		expect(languageToolsPanelSource).toContain('clearTimeout(copiedFieldResetTimer)');
		expect(languageToolsPanelSource).toContain('copiedFieldResetTimer = setTimeout');
		expect(languageToolsPanelSource).toContain('scheduleCopiedFieldReset();');
	});
});
