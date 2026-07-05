import { describe, expect, it } from 'vite-plus/test';
import interpolationEngineSource from '../engine/interpolation/interpolation-engine.ts?raw';
import timelineModelSource from '../engine/timeline.ts?raw';
import abortErrorSource from '../lib/abort-error.ts?raw';
import blobDownloadSource from '../lib/blob-download.ts?raw';
import clipboardSource from '../lib/clipboard.ts?raw';
import audioInsertRowSource from './AudioInsertRow.tsx?raw';
import appSource from './App.tsx?raw';
import captionStyleInspectorSource from './CaptionStyleInspector.tsx?raw';
import languageToolsPanelSource from './LanguageToolsPanel.tsx?raw';
import liveAudioChainPanelSource from './LiveAudioChainPanel.tsx?raw';
import previewGizmoSource from './PreviewGizmo.tsx?raw';
import reframeOverlaySource from './ReframeOverlay.tsx?raw';
import timelineSource from './Timeline.tsx?raw';
import voiceCleanupPanelSource from './VoiceCleanupPanel.tsx?raw';

describe('review comment regression guards', () => {
	it('handles queued tensor cleanup after device-loss rejections', () => {
		expect(interpolationEngineSource).toContain('.onSubmittedWorkDone()');
		expect(interpolationEngineSource).toContain('.catch(() => {})');
		expect(interpolationEngineSource).toContain('.finally(() => outputTensor.dispose())');
	});

	it('keeps shared blob downloads DOM-backed and short-lived', () => {
		expect(blobDownloadSource).toContain('document.body.appendChild(a)');
		expect(blobDownloadSource).toContain('setTimeout(() => URL.revokeObjectURL(url), 1_000)');
		expect(blobDownloadSource).toContain(
			'try {\n\t\tdocument.body.appendChild(a);\n\t\ta.click();\n\t} finally {\n\t\t// Schedule revocation even if the synthetic click or cleanup throws.\n\t\tsetTimeout(() => URL.revokeObjectURL(url), 1_000);\n\t\ta.remove();\n\t}'
		);
	});

	it('guards clipboard and timeline edge cases', () => {
		expect(clipboardSource).toContain('const clipboard = getClipboard();');
		expect(clipboardSource).toContain(
			'return { ok: false, error: CLIPBOARD_UNAVAILABLE_MESSAGE };'
		);
		expect(abortErrorSource).toContain("'name' in error");
		expect(abortErrorSource).toContain("error.name === 'AbortError'");
		expect(timelineModelSource).toContain('const sourceTrack = timeline[source.trackIndex];');
		expect(timelineModelSource).toContain(
			'if (!sourceTrack || sourceTrack.locked) return timeline;'
		);
	});

	it('uses shared download and abort helpers for caption preset export', () => {
		expect(captionStyleInspectorSource).toContain(
			"import { isAbortError } from '../lib/abort-error';"
		);
		expect(captionStyleInspectorSource).toContain(
			"import { downloadBlob } from '../lib/blob-download';"
		);
		expect(captionStyleInspectorSource).toContain('downloadBlob(blob, filename);');
		expect(captionStyleInspectorSource).not.toContain("document.createElement('a')");
		expect(captionStyleInspectorSource).not.toContain('instanceof DOMException');
	});

	it('keeps capability probing separate from canvas initialization', () => {
		expect(appSource).toContain('const probe = await probeCapabilitiesV2();');
		expect(appSource).toContain('async function initializePendingCanvas()');
		expect(appSource).toContain('await initializePendingCanvas();');
		expect(appSource).toContain('Capability detection failed: ${message}');
		expect(appSource).toContain('Canvas initialization failed: ${message}');
		expect(appSource).not.toContain('let probe;');
	});

	it('does not announce passive latency metrics as live regions', () => {
		expect(liveAudioChainPanelSource).toContain('class="latency-display"');
		expect(voiceCleanupPanelSource).toContain('class="latency-display"');
		expect(liveAudioChainPanelSource).not.toContain('class="latency-display" aria-live');
		expect(voiceCleanupPanelSource).not.toContain('class="latency-display" aria-live');
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
		expect(languageToolsPanelSource).toContain('function createCopiedFieldFeedback');
		expect(languageToolsPanelSource).toContain('let resetTimer');
		expect(languageToolsPanelSource).toContain('onCleanup(() => {');
		expect(languageToolsPanelSource).toContain('clearTimeout(resetTimer)');
		expect(languageToolsPanelSource).toContain('resetTimer = setTimeout');
		expect(languageToolsPanelSource).toContain('const markCopiedField = createCopiedFieldFeedback');
		expect(languageToolsPanelSource).toContain('function createFieldCopier');
		expect(languageToolsPanelSource).toContain('const copyField = createFieldCopier');
		expect(languageToolsPanelSource).toContain('markCopiedField(field);');
	});
});
