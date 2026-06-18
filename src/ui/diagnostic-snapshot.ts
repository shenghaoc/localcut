import type { AsrAccelerator, AsrEngine, ExportSettings, MediaAssetSnapshot } from '../protocol';
import {
	DIAGNOSTIC_SNAPSHOT_SCHEMA_VERSION,
	type CapabilityFinding,
	type CapabilityReport,
	type DiagnosticCapabilityTier,
	type DiagnosticSnapshot,
	type ExportSettingsSummary,
	type InterpolationDiagnosticSummary,
	type MlRuntimeDiagnosticSummary,
	type ProxyCacheDiagnosticSummary,
	type RecentErrorLog,
	type StorageDiagnosticSummary,
	type VoiceCleanupDiagnosticSummary
} from '../diagnostics/types';
import { buildDefaultPerformanceBudgets } from '../diagnostics/performance-budgets';
import type { CapabilitySnapshot, CapabilityTier } from './capabilities';

const APP_VERSION = '0.1.0';
// Guard the build-time global so the module is importable under unit tests (the
// node test env doesn't `define` it), matching asr/cleanup/worker controllers.
const BUILD_ID = `${APP_VERSION}+${typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev'}`;

function makeSnapshotId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return `diag-${crypto.randomUUID()}`;
	}
	return `diag-${Math.random().toString(36).slice(2)}`;
}

function finding(
	code: string,
	supported: boolean,
	message: string,
	action?: string
): CapabilityFinding {
	return {
		code,
		status: supported ? 'supported' : 'unsupported',
		message,
		action
	};
}

function browserSummary(): DiagnosticSnapshot['browser'] {
	const ua = navigator.userAgent;
	const chromium = /(?:Chrome|Chromium|Edg)\/([0-9.]+)/.exec(ua);
	const firefox = /Firefox\/([0-9.]+)/.exec(ua);
	const safari = !chromium ? /Version\/([0-9.]+).*Safari/.exec(ua) : null;
	if (chromium) {
		return {
			userAgentFamily: 'Chromium',
			userAgentVersion: chromium[1]!,
			platformFamily: navigator.platform
		};
	}
	if (firefox) {
		return {
			userAgentFamily: 'Firefox',
			userAgentVersion: firefox[1]!,
			platformFamily: navigator.platform
		};
	}
	if (safari) {
		return {
			userAgentFamily: 'Safari',
			userAgentVersion: safari[1]!,
			platformFamily: navigator.platform
		};
	}
	return {
		userAgentFamily: 'unknown',
		userAgentVersion: 'unknown',
		platformFamily: navigator.platform || 'unknown'
	};
}

function capabilityReport(
	snapshot: CapabilitySnapshot,
	tier: CapabilityTier,
	runtimeIssue: string | null,
	webgpuReady: boolean
): CapabilityReport {
	const diagnosticTier: DiagnosticCapabilityTier = tier;
	const isolationFinding = finding(
		'capability.cross_origin_isolated',
		snapshot.crossOriginIsolated,
		snapshot.crossOriginIsolated
			? 'COOP/COEP isolation is active.'
			: 'COOP/COEP isolation is missing, so the accelerated SAB path is disabled.',
		snapshot.crossOriginIsolated
			? undefined
			: 'Serve dev/preview/production with COOP/COEP headers, then reload.'
	);
	const sabFinding = finding(
		'capability.shared_array_buffer',
		snapshot.sharedArrayBuffer,
		snapshot.sharedArrayBuffer
			? 'SharedArrayBuffer is available.'
			: 'SharedArrayBuffer is unavailable.',
		snapshot.sharedArrayBuffer ? undefined : 'Enable cross-origin isolation and reload.'
	);
	const webgpuFinding = finding(
		'capability.webgpu',
		snapshot.webgpu && webgpuReady,
		webgpuReady
			? 'WebGPU device is ready in the worker.'
			: (runtimeIssue ?? 'WebGPU API or device is not ready.'),
		webgpuReady ? undefined : 'Use hardware-accelerated Chromium or inspect GPU diagnostics.'
	);
	const webcodecsFinding = finding(
		'capability.webcodecs',
		snapshot.webCodecs,
		snapshot.webCodecs ? 'WebCodecs is exposed.' : 'WebCodecs is unavailable.',
		snapshot.webCodecs
			? undefined
			: 'Use a recent Chromium-based browser for accelerated import/export.'
	);
	const findings = [isolationFinding, sabFinding, webgpuFinding, webcodecsFinding];
	return {
		tier: diagnosticTier,
		tierReason:
			tier === 'accelerated'
				? 'UI and worker report full accelerated capability.'
				: (runtimeIssue ?? 'One or more accelerated capabilities are unavailable.'),
		crossOriginIsolated: snapshot.crossOriginIsolated,
		sharedArrayBuffer: sabFinding,
		webGpu: {
			status: webgpuReady ? 'ready' : snapshot.webgpu ? 'requesting' : 'unavailable',
			features: [],
			optionalFeatures: {
				shaderF16: {
					code: 'webgpu.feature.shader-f16',
					status: 'unknown',
					message: 'Worker snapshot not available yet.'
				},
				timestampQuery: {
					code: 'webgpu.feature.timestamp-query',
					status: 'unknown',
					message: 'Worker snapshot not available yet.'
				},
				subgroups: {
					code: 'webgpu.feature.subgroups',
					status: 'unknown',
					message: 'Worker snapshot not available yet.'
				}
			}
		},
		webCodecs: {
			decoders: [{ codec: 'browser-reported', direction: 'decode', supported: snapshot.webCodecs }],
			encoders: [
				{
					codec: 'browser-reported',
					direction: 'encode',
					supported: typeof VideoEncoder !== 'undefined'
				}
			]
		},
		formatCompatibility: null,
		mediabunny: {
			code: 'capability.mediabunny',
			status: 'supported',
			message: 'Mediabunny is bundled with the app.'
		},
		audioWorklet: finding(
			'capability.audio_worklet',
			snapshot.audioWorklet,
			snapshot.audioWorklet ? 'AudioWorklet is available.' : 'AudioWorklet is unavailable.',
			snapshot.audioWorklet ? undefined : 'Audio playback/mixing may be limited.'
		),
		fileSystemAccess: finding(
			'capability.file_system_access',
			snapshot.fileSystemAccess,
			snapshot.fileSystemAccess
				? 'File System Access pickers are available.'
				: 'File System Access pickers are unavailable.',
			snapshot.fileSystemAccess ? undefined : 'Use Chromium desktop for direct export destinations.'
		),
		opfs: {
			code: 'capability.opfs',
			status: typeof navigator.storage?.getDirectory === 'function' ? 'supported' : 'unsupported',
			message:
				typeof navigator.storage?.getDirectory === 'function'
					? 'OPFS is available.'
					: 'OPFS is unavailable; cache may fall back or be disabled.'
		},
		findings
	};
}

function exportSettingsSummary(settings: ExportSettings | null): ExportSettingsSummary | null {
	if (!settings) return null;
	return {
		codec: settings.codec,
		container: settings.container,
		width: settings.width,
		height: settings.height,
		fps: settings.fps,
		videoBitrate: settings.videoBitrate,
		sourceMode: settings.sourceMode ?? 'original',
		range: settings.range ? { startS: settings.range.startS, endS: settings.range.endS } : 'full'
	};
}

function proxyCacheSummary(assets: readonly MediaAssetSnapshot[]): ProxyCacheDiagnosticSummary {
	let proxyAssets = 0;
	let readyProxies = 0;
	let failedProxies = 0;
	let estimatedBytes = 0;
	for (const asset of assets) {
		if (!asset.proxy) continue;
		proxyAssets += 1;
		if (asset.proxy.status === 'ready') readyProxies += 1;
		if (asset.proxy.status === 'failed') failedProxies += 1;
		estimatedBytes += asset.proxy.byteSize ?? 0;
	}
	return {
		status: proxyAssets === 0 ? 'unknown' : failedProxies > 0 ? 'degraded' : 'available',
		proxyAssets,
		readyProxies,
		failedProxies,
		estimatedBytes,
		message:
			proxyAssets === 0
				? 'No proxy/cache assets are reported in the UI state.'
				: 'Proxy/cache status is available.'
	};
}

function voiceCleanupSummary(
	input?: UiDiagnosticInput['voiceCleanup']
): VoiceCleanupDiagnosticSummary {
	const status = input?.wasmLoadStatus ?? 'not-loaded';
	return {
		denoiserEnabledTrackCount: input?.denoiserEnabledTrackCount ?? 0,
		wasmProvenance: '@jitsi/rnnoise-wasm@0.2.1 prebuilt artifact',
		wasmSha256: input?.wasmSha256 ?? null,
		wasmLoadStatus: status,
		wasmLoadTimeMs: input?.wasmLoadTimeMs ?? null,
		workletLatencyMs: input?.workletLatencyMs ?? 17.67,
		normalisationTargetLufs: input?.normalisationTargetLufs ?? -14,
		normaliseGainDb: input?.normaliseGainDb ?? 0,
		limiterCeilingDbtp: input?.limiterCeilingDbtp ?? -1,
		findings: [
			{
				code: 'voice-cleanup.rnnoise-wasm',
				status: status === 'loaded' ? 'supported' : status === 'error' ? 'unavailable' : 'unknown',
				message:
					status === 'loaded'
						? 'RNNoise WASM loaded and checksum verification succeeded.'
						: status === 'error'
							? `RNNoise WASM failed to load: ${input?.unavailableReason || 'unknown error'}`
							: 'RNNoise WASM is loaded lazily when a track denoiser is enabled.'
			},
			{
				code: 'voice-cleanup.worklet-latency',
				status: 'supported',
				message: `Monitor latency budget is ${(input?.workletLatencyMs ?? 17.67).toFixed(
					2
				)} ms for quantum + denoiser ring + limiter lookahead.`
			}
		]
	};
}

export async function storageSummary(): Promise<StorageDiagnosticSummary> {
	const estimate = navigator.storage?.estimate
		? await navigator.storage.estimate().catch(() => null)
		: null;
	const persisted = navigator.storage?.persisted
		? await navigator.storage.persisted().catch(() => null)
		: null;
	const usageBytes = estimate?.usage ?? null;
	const quotaBytes = estimate?.quota ?? null;
	const freeBytes = usageBytes !== null && quotaBytes !== null ? quotaBytes - usageBytes : null;
	const warning =
		freeBytes === null
			? 'unknown'
			: freeBytes < 512 * 1024 * 1024
				? 'storage-pressure'
				: usageBytes !== null && quotaBytes !== null && usageBytes / quotaBytes > 0.8
					? 'near-limit'
					: 'ok';
	return {
		opfsSupported: typeof navigator.storage?.getDirectory === 'function',
		indexedDbSupported: typeof indexedDB !== 'undefined',
		persistentStorage: persisted === null ? 'unknown' : persisted ? 'granted' : 'denied',
		usageBytes,
		quotaBytes,
		warning
	};
}

export interface UiDiagnosticInput {
	readonly capabilities: CapabilitySnapshot;
	readonly tier: CapabilityTier;
	readonly runtimeIssue: string | null;
	readonly webgpuReady: boolean;
	readonly exportSettings: ExportSettings | null;
	readonly assets: readonly MediaAssetSnapshot[];
	readonly recentErrors: RecentErrorLog;
	readonly workerSnapshot?: DiagnosticSnapshot | null;
	readonly interpolation?: InterpolationDiagnosticSummary;
	/** Active Auto Captions engine + accelerator, so an ORT/WASM transcription is
	 *  not misreported as LiteRT in support bundles. `null` engine ⇒ none loaded. */
	readonly asr?: { readonly engine: AsrEngine | null; readonly accelerator: AsrAccelerator | null };
	readonly voiceCleanup?: {
		readonly denoiserEnabledTrackCount: number;
		readonly wasmLoadStatus: VoiceCleanupDiagnosticSummary['wasmLoadStatus'];
		readonly wasmLoadTimeMs: number | null;
		readonly wasmSha256: string | null;
		readonly unavailableReason: string;
		readonly workletLatencyMs: number;
		readonly normalisationTargetLufs: number;
		readonly normaliseGainDb: number;
		readonly limiterCeilingDbtp: number;
	};
}

/**
 * Resolves the ML-runtime summary. When the active Auto Captions engine is the
 * ONNX one, report `ort` + its execution provider so an exported support bundle
 * reflects the runtime that actually ran; otherwise fall back to the worker's
 * summary (LiteRT today). `AsrAccelerator` and `OrtExecutionProvider` share the
 * same member set, so the accelerator maps straight to `ortEp`.
 */
export function mlRuntimeSummary(
	asr: UiDiagnosticInput['asr'],
	workerMlRuntime: MlRuntimeDiagnosticSummary | undefined
): MlRuntimeDiagnosticSummary {
	if (asr?.engine === 'ort-whisper') {
		return { mlRuntime: 'ort', ortEp: asr.accelerator ?? 'wasm', tensorLocation: 'cpu' };
	}
	return workerMlRuntime ?? { mlRuntime: 'litert' };
}

export async function buildUiDiagnosticSnapshot(
	input: UiDiagnosticInput
): Promise<DiagnosticSnapshot> {
	const worker = input.workerSnapshot;
	return {
		schemaVersion: DIAGNOSTIC_SNAPSHOT_SCHEMA_VERSION,
		snapshotId: makeSnapshotId(),
		createdAt: new Date().toISOString(),
		appVersion: APP_VERSION,
		buildId: BUILD_ID,
		browser: browserSummary(),
		capability:
			worker?.capability ??
			capabilityReport(input.capabilities, input.tier, input.runtimeIssue, input.webgpuReady),
		storage: worker?.storage ?? (await storageSummary()),
		proxyCache: worker?.proxyCache ?? proxyCacheSummary(input.assets),
		voiceCleanup: input.voiceCleanup
			? voiceCleanupSummary(input.voiceCleanup)
			: (worker?.voiceCleanup ?? voiceCleanupSummary()),
		mlRuntime: mlRuntimeSummary(input.asr, worker?.mlRuntime),
		activeExportSettings: exportSettingsSummary(input.exportSettings),
		performanceBudgets: worker?.performanceBudgets ?? buildDefaultPerformanceBudgets(),
		recentErrors: input.recentErrors,
		recoveryActions: worker?.recoveryActions ?? [],
		interpolation: input.interpolation ?? worker?.interpolation
	};
}
