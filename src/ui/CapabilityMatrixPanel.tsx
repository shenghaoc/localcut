import { createMemo, For, Show } from 'solid-js';
import type { CapabilityProbeResult, FeatureSupport } from '../protocol';

interface CapabilityMatrixPanelProps {
	probe: CapabilityProbeResult | null;
}

interface CapabilityRow {
	label: string;
	support: FeatureSupport;
	active: boolean;
	action: string | null;
}

function supportChip(support: FeatureSupport): string {
	switch (support) {
		case 'supported':
			return 'Supported';
		case 'unsupported':
			return 'Unsupported';
		case 'unknown':
			return 'Unknown';
	}
}

function canHeadersUnlockCore(probe: CapabilityProbeResult): boolean {
	return (
		probe.webGPUCore === 'supported' &&
		probe.webCodecsDecode === 'supported' &&
		probe.webCodecsEncode === 'supported' &&
		probe.codecs.h264Encode === 'supported' &&
		probe.codecs.vp9Encode === 'supported' &&
		probe.codecs.av1Encode === 'supported' &&
		probe.offscreenCanvas === 'supported'
	);
}

function rowsForProbe(probe: CapabilityProbeResult): CapabilityRow[] {
	const sabAction = !probe.crossOriginIsolated
		? canHeadersUnlockCore(probe)
			? 'Serve the app with COOP/COEP headers to unlock the core tier.'
			: 'COOP/COEP is one missing requirement; this browser still has other tier limits.'
		: null;
	return [
		{
			label: 'WebGPU standard',
			support: probe.webGPUCore,
			active:
				probe.tier === 'core-webgpu' ||
				(probe.tier === 'compatibility-webgpu' && !probe.compatibilityAdapter),
			action:
				probe.webGPUCore === 'supported'
					? null
					: 'Enable hardware acceleration or use a WebGPU-capable browser.'
		},
		{
			label: 'WebGPU compatibility adapter',
			support: probe.webGPUCompat,
			active: probe.compatibilityAdapter,
			action:
				probe.webGPUCompat === 'supported' || probe.webGPUCore === 'supported'
					? null
					: 'No WebGPU adapter detected; use a browser with WebGPU for GPU preview.'
		},
		{
			label: 'VideoDecoder',
			support: probe.webCodecsDecode,
			active: probe.webCodecsDecode === 'supported' && probe.tier !== 'shell-only',
			action:
				probe.webCodecsDecode === 'supported'
					? null
					: 'Use a browser with WebCodecs decode support.'
		},
		{
			label: 'VideoEncoder',
			support: probe.webCodecsEncode,
			active: probe.webCodecsEncode === 'supported' && probe.tier !== 'shell-only',
			action:
				probe.webCodecsEncode === 'supported'
					? null
					: 'Export is limited without WebCodecs encode support.'
		},
		{
			label: 'H.264 decode',
			support: probe.codecs.h264Decode,
			active: probe.codecs.h264Decode === 'supported',
			action: null
		},
		{
			label: 'VP9 decode',
			support: probe.codecs.vp9Decode,
			active: probe.codecs.vp9Decode === 'supported',
			action: null
		},
		{
			label: 'AV1 decode',
			support: probe.codecs.av1Decode,
			active: probe.codecs.av1Decode === 'supported',
			action: null
		},
		{
			label: 'H.264 encode',
			support: probe.codecs.h264Encode,
			active: probe.codecs.h264Encode === 'supported',
			action: null
		},
		{
			label: 'VP9 encode',
			support: probe.codecs.vp9Encode,
			active: probe.codecs.vp9Encode === 'supported',
			action: null
		},
		{
			label: 'AV1 encode',
			support: probe.codecs.av1Encode,
			active: probe.tier === 'core-webgpu' && probe.codecs.av1Encode === 'supported',
			action: null
		},
		{
			label: 'AAC decode',
			support: probe.codecs.aacDecode,
			active: probe.codecs.aacDecode === 'supported',
			action: null
		},
		{
			label: 'Opus decode',
			support: probe.codecs.opusDecode,
			active: probe.codecs.opusDecode === 'supported',
			action: null
		},
		{
			label: 'AAC encode',
			support: probe.codecs.aacEncode,
			active: probe.codecs.aacEncode === 'supported',
			action: null
		},
		{
			label: 'Opus encode',
			support: probe.codecs.opusEncode,
			active: probe.codecs.opusEncode === 'supported',
			action: null
		},
		{
			label: 'SharedArrayBuffer',
			support: probe.sharedArrayBuffer,
			active: probe.sharedArrayBuffer === 'supported',
			action: sabAction
		},
		{
			label: 'OffscreenCanvas',
			support: probe.offscreenCanvas,
			active: probe.offscreenCanvas === 'supported' && probe.tier !== 'shell-only',
			action:
				probe.offscreenCanvas === 'supported'
					? null
					: 'Preview tiers require worker-owned OffscreenCanvas.'
		},
		{
			label: 'File System Access',
			support: probe.fileSystemAccess,
			active: probe.fileSystemAccess === 'supported',
			action:
				probe.fileSystemAccess === 'supported'
					? null
					: 'Exports use blob download when direct file saving is unavailable.'
		},
		{ label: 'OPFS', support: probe.opfs, active: probe.opfs === 'supported', action: null },
		{
			label: 'AudioWorklet',
			support: probe.audioWorklet,
			active: probe.audioWorklet === 'supported',
			action: null
		},
		webnnRow(probe),
		asrRow(probe),
		// ── Capture Engine (Phase 41) probes ─────────────────────────
		{
			label: 'Capture: MSTP',
			support: probe.capture.mediaStreamTrackProcessor,
			active: probe.capture.mediaStreamTrackProcessor === 'supported',
			action:
				probe.capture.mediaStreamTrackProcessor === 'supported'
					? null
					: 'Recording requires MediaStreamTrackProcessor (Chromium desktop).'
		},
		{
			label: 'Capture: Transferable Track',
			support: probe.capture.transferableMediaStreamTrack,
			active: probe.capture.transferableMediaStreamTrack === 'supported',
			action:
				probe.capture.transferableMediaStreamTrack === 'supported'
					? null
					: 'Recording requires transferable MediaStreamTrack (Chromium).'
		},
		{
			label: 'Capture: Display Capture',
			support: probe.capture.displayCapture,
			active: probe.capture.displayCapture === 'supported',
			action:
				probe.capture.displayCapture === 'supported'
					? null
					: 'Screen recording requires getDisplayMedia support.'
		},
		{
			label: 'Capture: Display Audio',
			support: probe.capture.displayAudioCapture,
			active: probe.capture.displayAudioCapture === 'supported',
			action:
				probe.capture.displayAudioCapture === 'supported'
					? null
					: probe.capture.displayAudioCapture === 'unknown'
						? 'System/tab audio capture support is unknown until first use.'
						: 'System/tab audio capture is not available on this platform.'
		},
		{
			label: 'Capture: Video Encode (realtime)',
			support: probe.capture.videoEncodeRealtime,
			active: probe.capture.videoEncodeRealtime === 'supported',
			action:
				probe.capture.videoEncodeRealtime === 'supported'
					? null
					: 'Recording requires hardware-accelerated realtime video encoding.'
		},
		{
			label: 'Capture: Opus Encode',
			support: probe.capture.audioEncodeOpus,
			active: probe.capture.audioEncodeOpus === 'supported',
			action:
				probe.capture.audioEncodeOpus === 'supported'
					? null
					: 'Audio recording requires Opus encode support.'
		},
		{
			label: 'Capture: AAC Encode',
			support: probe.capture.audioEncodeAac,
			active: probe.capture.audioEncodeAac === 'supported',
			action: null
		},
		{
			label: 'Capture: OPFS Sync Access',
			support: probe.capture.opfsSyncAccessHandle,
			active: probe.capture.opfsSyncAccessHandle === 'supported',
			action:
				probe.capture.opfsSyncAccessHandle === 'supported'
					? null
					: 'Recording requires OPFS SyncAccessHandle for crash-safe writes.'
		}
	];
}

/** WebNN gates only the experimental Audio Cleanup feature — never the tier. */
function webnnRow(probe: CapabilityProbeResult): CapabilityRow {
	const webnn = probe.webnn;
	const backends = webnn
		? (['npu', 'gpu', 'cpu'] as const).filter((b) => webnn.backends[b] === 'supported')
		: [];
	const supported = webnn?.mlPresent === true && backends.length > 0;
	return {
		label: 'WebNN (audio cleanup)',
		support: webnn ? (supported ? 'supported' : 'unsupported') : 'unknown',
		active: false,
		action: supported
			? `Local Audio Cleanup (Experimental) available via ${backends.join(', ')}.`
			: 'Optional on-device audio cleanup needs a browser with WebNN (navigator.ml).'
	};
}

/** ASR probes gate only the experimental Auto Captions feature — never the tier. */
function asrRow(probe: CapabilityProbeResult): CapabilityRow {
	const asr = probe.asr;
	const engineLabel = asr
		? asr.recommended === 'webnn-whisper'
			? 'WebNN Whisper'
			: 'unavailable'
		: 'unknown';
	const supported = asr?.recommended !== 'none';
	return {
		label: 'Auto Captions (ASR)',
		support: asr ? (supported ? 'supported' : 'unsupported') : 'unknown',
		active: false,
		action: supported
			? `Auto Captions (Experimental) available via ${engineLabel}.`
			: 'Auto Captions need the on-device WebNN Whisper engine (LiteRT); there is no browser fallback.'
	};
}

export function CapabilityMatrixPanel(props: CapabilityMatrixPanelProps) {
	const rows = createMemo(() => {
		const probe = props.probe;
		return probe ? rowsForProbe(probe) : [];
	});

	return (
		<section class="capability-matrix">
			<Show
				when={props.probe}
				fallback={<p class="capability-panel-note">Capability probe pending.</p>}
			>
				{(probe) => (
					<>
						<div class={`capability-v2-badge is-${probe().tier}`}>
							<span>Capability V2</span>
							<strong>{probe().tier}</strong>
						</div>
						<details>
							<summary>Browser info</summary>
							<p>{typeof navigator === 'undefined' ? 'Unknown browser' : navigator.userAgent}</p>
						</details>
						<ul class="capability-matrix-list">
							<For each={rows()}>
								{(row) => (
									<li class="capability-matrix-row">
										<span>{row.label}</span>
										<span class={`support-chip is-${row.support}`}>{supportChip(row.support)}</span>
										<span>{row.active ? 'Active' : '-'}</span>
										<Show when={row.action}>
											{(action) => <span class="capability-item-action">{action()}</span>}
										</Show>
									</li>
								)}
							</For>
						</ul>
					</>
				)}
			</Show>
		</section>
	);
}
