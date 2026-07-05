import { describe, expect, it } from 'vite-plus/test';
import interpolationEngineSource from '../engine/interpolation/interpolation-engine.ts?raw';
import timelineModelSource from '../engine/timeline.ts?raw';
import abortErrorSource from '../lib/abort-error.ts?raw';
import blobDownloadSource from '../lib/blob-download.ts?raw';
import clipboardSource from '../lib/clipboard.ts?raw';
import audioInsertRowSource from './AudioInsertRow.tsx?raw';
import appSource from './App.tsx?raw';
import captionStyleInspectorSource from './CaptionStyleInspector.tsx?raw';
import exportDialogSource from './ExportDialog.tsx?raw';
import languageToolsPanelSource from './LanguageToolsPanel.tsx?raw';
import liveAudioChainPanelSource from './LiveAudioChainPanel.tsx?raw';
import previewGizmoSource from './PreviewGizmo.tsx?raw';
import reframeOverlaySource from './ReframeOverlay.tsx?raw';
import timelineSource from './Timeline.tsx?raw';
import voiceCleanupPanelSource from './VoiceCleanupPanel.tsx?raw';

describe('review comment regression guards', () => {
	it('handles queued tensor cleanup after device-loss rejections', () => {
		expect(interpolationEngineSource).toContain('.onSubmittedWorkDone()');
		expect(interpolationEngineSource).toContain('.catch((err)');
		expect(interpolationEngineSource).toContain('.finally(() => outputTensor.dispose())');
	});

	it('keeps shared blob downloads DOM-backed and short-lived', () => {
		expect(blobDownloadSource).toContain('url = URL.createObjectURL(blob)');
		expect(blobDownloadSource).toContain('document.body.appendChild(a)');
		expect(blobDownloadSource).toContain('setTimeout(() => URL.revokeObjectURL(url!), 10_000)');
		expect(blobDownloadSource).toContain(
			"try {\n\t\turl = URL.createObjectURL(blob);\n\t\ta.href = url;\n\t\ta.download = name;\n\t\tdocument.body.appendChild(a);\n\t\ta.click();\n\t} finally {\n\t\t// Schedule revocation even if the synthetic click or cleanup throws.\n\t\t// A 10-second timeout is safer for large files (like video exports) to\n\t\t// prevent premature revocation in Safari's async download manager.\n\t\tif (url) setTimeout(() => URL.revokeObjectURL(url!), 10_000);\n\t\ta.remove();\n\t}"
		);
	});

	it('guards clipboard and timeline edge cases', () => {
		expect(clipboardSource).toContain('const clipboard = getClipboard();');
		expect(clipboardSource).toContain(
			'return { ok: false, error: CLIPBOARD_UNAVAILABLE_MESSAGE };'
		);
		expect(clipboardSource).toContain('{ ok: true }');
		expect(clipboardSource).toContain('{ ok: false; error: string }');
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

	it('provides downloadBlob fallback in ExportDialog chapter save', () => {
		expect(exportDialogSource).toContain("import { downloadBlob } from '../lib/blob-download';");
		// The native-save catch block must fall back to downloadBlob
		expect(exportDialogSource).toContain('downloadBlob(textBlob, textName)');
		expect(exportDialogSource).toContain('downloadBlob(jsonBlob, jsonName)');
	});

	it('keeps capability probing separate from canvas initialization', () => {
		expect(appSource).toContain('const probe = await probeCapabilitiesV2();');
		expect(appSource).toContain('async function initializePendingCanvas()');
		expect(appSource).toContain('await initializePendingCanvas();');
		expect(appSource).toContain('Capability detection failed');
		expect(appSource).toContain('Canvas initialization failed');
		expect(appSource).toContain('handleInitError');
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
			'const centerTranslate = `${b.left + cx - w / 2}px ${b.top + cy - h / 2}px`'
		);
		expect(previewGizmoSource).toContain('width: `${w}px`');
		expect(previewGizmoSource).toContain('height: `${h}px`');
		expect(previewGizmoSource).toContain('const centeredTransform = `rotate(${t.rotation}deg)`');
		expect(previewGizmoSource).not.toContain(
			'const centeredTransform = `rotate(${t.rotation}deg) scaleX(${w / 100}) scaleY(${h / 100})`'
		);
		expect(previewGizmoSource).toContain('translate: centerTranslate');
		expect(previewGizmoSource).toContain("'transform-origin': '50% 50%'");
	});

	it('uses Solid Show for audio insert conditional rendering', () => {
		expect(audioInsertRowSource).toContain('Show, type JSX');
		expect(audioInsertRowSource).toContain('<Show when={props.bypass}');
		expect(audioInsertRowSource).toContain('<Show when={expanded()}>');
		expect(audioInsertRowSource).toContain('const bypassActionLabel = () =>');
		expect(audioInsertRowSource).toContain('`Enable ${props.label}`');
		expect(audioInsertRowSource).toContain('`Bypass ${props.label}`');
		expect(audioInsertRowSource).toContain('aria-label={bypassActionLabel()}');
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
