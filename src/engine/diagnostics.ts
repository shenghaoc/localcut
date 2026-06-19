import type {
	ExportSettings,
	FeatureSupport,
	LivePublishProbeResult,
	VoiceCleanupSettings,
	CaptureProbeResult,
	CapabilityProbeResult
} from '../protocol';
import { DEFAULT_VOICE_CLEANUP_SETTINGS } from '../protocol';
import type {
	CapabilityFinding,
	CapabilityReport,
	CodecSupportSummary,
	FormatCompatibilitySummary as DiagFormatCompatibilitySummary,
	DeviceLostSummary,
	DiagnosticSnapshot,
	DiagnosticCapabilityTier,
	ExportSettingsSummary,
	ProxyCacheDiagnosticSummary,
	RecentErrorLog,
	RecoveryAction,
	StorageDiagnosticSummary,
	VoiceCleanupDiagnosticSummary,
	WebGpuCapability
} from '../diagnostics/types';
import { DIAGNOSTIC_SNAPSHOT_SCHEMA_VERSION } from '../diagnostics/types';
import { buildDefaultPerformanceBudgets } from '../diagnostics/performance-budgets';
import { probeAllCodecs } from './codec-support';
import { captureUnavailableReasons } from './capture-reasons';

interface DiagnosticSourceLike {
	readonly proxy?: {
		readonly status?: string;
		readonly byteSize?: number;
	};
}

export interface WorkerDiagnosticInput {
	readonly appVersion: string;
	readonly webgpuReady: boolean;
	readonly webgpuStatus: WebGpuCapability['status'];
	readonly webgpuFeatures: readonly string[];
	readonly webgpuLimits: Readonly<Record<string, number>>;
	readonly gpuUnavailableReason: string | null;
	readonly lastDeviceLost: DeviceLostSummary | undefined;
	readonly rendererSubmissionCount: number | null;
	readonly activeExportSettings: ExportSettings | null;
	readonly recentErrors: RecentErrorLog;
	readonly sources: readonly DiagnosticSourceLike[];
	readonly voiceCleanup?: VoiceCleanupSettings;
	/** Phase 47: live-publish probe results from the main-thread capability probe. */
	readonly livePublish?: LivePublishProbeResult | null;
	/** Phase 45: program mode capability (derived from capture + WebGPU probes). */
	readonly programMode?: FeatureSupport;
	/** Capture probe results for dynamic unavailable-reason strings. */
	readonly capture?: CaptureProbeResult;
}

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

/**
 * Phase 47 (T8): live-publish capability findings. Pure capability strings —
 * the snapshot must never carry the endpoint URL or bearer token (R1.2).
 */
function publishFinding(
	code: string,
	support: FeatureSupport,
	label: string,
	unavailableNote: string
): CapabilityFinding {
	return {
		code,
		// FeatureSupport values are a subset of CapabilityStatus.
		status: support,
		message:
			support === 'supported'
				? `${label} is available.`
				: support === 'unsupported'
					? `${label} is unavailable. ${unavailableNote}`
					: `${label} support is unknown (probe did not run).`
	};
}

function publishFindings(probe: LivePublishProbeResult): CapabilityFinding[] {
	return [
		publishFinding(
			'publish.rtc',
			probe.rtcPeerConnection,
			'RTCPeerConnection (WHIP publish)',
			'Live publish is hidden behind a reduced-tier explanation.'
		),
		publishFinding(
			'publish.track-generator',
			probe.trackGeneratorWorker,
			'MediaStreamTrackGenerator',
			'The publish program-feed tap cannot run.'
		),
		publishFinding(
			'publish.track-transfer',
			probe.trackTransfer,
			'Transferable MediaStreamTrack',
			'Publish falls back to bounded per-frame transfer.'
		),
		publishFinding(
			'publish.generateKeyFrame',
			probe.generateKeyFrame,
			'RTCRtpSender.generateKeyFrame',
			'The platform default GOP applies while streaming.'
		),
		publishFinding(
			'publish.hw-encode',
			probe.hardwareH264Encode,
			'Hardware H.264 encode',
			'The encoder-session budget is limited to one concurrent session.'
		)
	];
}

function featureFinding(
	feature: string,
	features: readonly string[],
	label: string
): CapabilityFinding {
	const supported = features.includes(feature);
	return {
		code: `webgpu.feature.${feature}`,
		status: supported ? 'supported' : 'unsupported',
		message: supported
			? `${label} is enabled on the WebGPU device.`
			: `${label} is not enabled on this WebGPU device.`,
		action: supported
			? undefined
			: 'The editor will use the f32/shared-memory fallback where available.'
	};
}

function userAgentSummary(): DiagnosticSnapshot['browser'] {
	const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
	const platform = typeof navigator !== 'undefined' ? navigator.platform : 'unknown';
	const chromium = /(?:Chrome|Chromium|Edg)\/([0-9.]+)/.exec(ua);
	const firefox = /Firefox\/([0-9.]+)/.exec(ua);
	const safari = !chromium ? /Version\/([0-9.]+).*Safari/.exec(ua) : null;
	if (chromium) {
		return {
			userAgentFamily: 'Chromium',
			userAgentVersion: chromium[1]!,
			platformFamily: platform || 'unknown'
		};
	}
	if (firefox) {
		return {
			userAgentFamily: 'Firefox',
			userAgentVersion: firefox[1]!,
			platformFamily: platform || 'unknown'
		};
	}
	if (safari) {
		return {
			userAgentFamily: 'Safari',
			userAgentVersion: safari[1]!,
			platformFamily: platform || 'unknown'
		};
	}
	return {
		userAgentFamily: 'unknown',
		userAgentVersion: 'unknown',
		platformFamily: platform || 'unknown'
	};
}

function webGpuCapability(input: WorkerDiagnosticInput): WebGpuCapability {
	return {
		status: input.webgpuStatus,
		features: input.webgpuFeatures,
		optionalFeatures: {
			shaderF16: featureFinding('shader-f16', input.webgpuFeatures, 'shader-f16'),
			timestampQuery: featureFinding('timestamp-query', input.webgpuFeatures, 'timestamp-query'),
			subgroups: featureFinding('subgroups', input.webgpuFeatures, 'subgroups')
		},
		limits: Object.keys(input.webgpuLimits).length > 0 ? input.webgpuLimits : undefined,
		lastDeviceLost: input.lastDeviceLost
	};
}

const DECODER_PROBES = [
	{ codec: 'avc1.640028', label: 'h264', container: 'mp4' },
	{ codec: 'vp09.00.10.08', label: 'vp9', container: 'webm' },
	{ codec: 'av01.0.05M.08', label: 'av1', container: 'mp4/webm' }
] as const;

const ENCODER_PROBES = [
	{ codec: 'avc1.640028', label: 'h264', container: 'mp4', avc: true },
	{ codec: 'vp09.00.10.08', label: 'vp9', container: 'webm', avc: false },
	{ codec: 'av01.0.05M.08', label: 'av1', container: 'webm', avc: false }
] as const;

// Codec probing hits `isConfigSupported`, which can perform a hardware capability
// query per call. Diagnostics can be opened/refreshed repeatedly, so the results
// are cached for the session and reused; capability does not change at runtime, so
// the cache is only cleared explicitly via `invalidateDiagnosticProbeCache()`.
let cachedDecoderProbe: Promise<CodecSupportSummary[]> | null = null;
let cachedEncoderProbe: Promise<CodecSupportSummary[]> | null = null;
let cachedFormatCompatibility: Promise<DiagFormatCompatibilitySummary> | null = null;
// The storage estimate is cheap-ish but still I/O; cache it for a short window so a
// single open/refresh burst doesn't issue several `navigator.storage.estimate()`
// calls in a row, while still reflecting changes on the next manual refresh.
let cachedStorage: { at: number; value: StorageDiagnosticSummary } | null = null;
const STORAGE_CACHE_TTL_MS = 2_000;

/** Drop cached codec/storage probe results (call when capability may have changed). */
export function invalidateDiagnosticProbeCache(): void {
	cachedDecoderProbe = null;
	cachedEncoderProbe = null;
	cachedFormatCompatibility = null;
	cachedStorage = null;
}

async function probeDecodersUncached(): Promise<CodecSupportSummary[]> {
	if (typeof VideoDecoder === 'undefined') {
		return DECODER_PROBES.map((p) => ({
			codec: p.label,
			container: p.container,
			direction: 'decode' as const,
			supported: false,
			reason: 'VideoDecoder API unavailable'
		}));
	}
	return Promise.all(
		DECODER_PROBES.map(async (p) => {
			try {
				const result = await VideoDecoder.isConfigSupported({ codec: p.codec });
				return {
					codec: p.label,
					container: p.container,
					direction: 'decode' as const,
					supported: result.supported === true,
					reason: result.supported ? undefined : 'Not supported by this browser'
				};
			} catch {
				return {
					codec: p.label,
					container: p.container,
					direction: 'decode' as const,
					supported: false,
					reason: 'Probe threw an error'
				};
			}
		})
	);
}

function probeDecoders(): Promise<CodecSupportSummary[]> {
	if (!cachedDecoderProbe) {
		// Cache the promise (not just the result) so concurrent snapshot builds share
		// one in-flight probe; on rejection, clear it so a later call can retry.
		cachedDecoderProbe = probeDecodersUncached().catch((error) => {
			cachedDecoderProbe = null;
			throw error;
		});
	}
	return cachedDecoderProbe;
}

async function probeEncodersUncached(): Promise<CodecSupportSummary[]> {
	if (typeof VideoEncoder === 'undefined') {
		return ENCODER_PROBES.map((p) => ({
			codec: p.label,
			container: p.container,
			direction: 'encode' as const,
			supported: false,
			reason: 'VideoEncoder API unavailable'
		}));
	}
	return Promise.all(
		ENCODER_PROBES.map(async (p) => {
			try {
				const config: VideoEncoderConfig = {
					codec: p.codec,
					width: 1280,
					height: 720,
					bitrate: 5_000_000,
					framerate: 30,
					...(p.avc ? { avc: { format: 'avc' as const } } : {})
				};
				const result = await VideoEncoder.isConfigSupported(config);
				return {
					codec: p.label,
					container: p.container,
					direction: 'encode' as const,
					supported: result.supported === true,
					reason: result.supported ? undefined : 'Not supported by this browser'
				};
			} catch {
				return {
					codec: p.label,
					container: p.container,
					direction: 'encode' as const,
					supported: false,
					reason: 'Probe threw an error'
				};
			}
		})
	);
}

function probeEncoders(): Promise<CodecSupportSummary[]> {
	if (!cachedEncoderProbe) {
		cachedEncoderProbe = probeEncodersUncached().catch((error) => {
			cachedEncoderProbe = null;
			throw error;
		});
	}
	return cachedEncoderProbe;
}

async function probeFormatCompatibilityUncached(): Promise<DiagFormatCompatibilitySummary> {
	try {
		const codecs = await probeAllCodecs();
		const demuxableContainers = ['mp4', 'mov', 'webm', 'mp3', 'ogg', 'wav', 'm4a', 'm4v'];
		return {
			totalVideoCodecs: codecs.video.length,
			supportedVideoCodecs: codecs.video.filter((c) => c.strategy !== 'unsupported').length,
			hwPreferredVideoCodecs: codecs.video.filter((c) => c.hardwarePreferred).length,
			totalAudioCodecs: codecs.audio.length,
			supportedAudioCodecs: codecs.audio.filter((c) => c.strategy !== 'unsupported').length,
			demuxableContainers,
			videoCodecs: codecs.video,
			audioCodecs: codecs.audio
		};
	} catch {
		return {
			totalVideoCodecs: 0,
			supportedVideoCodecs: 0,
			hwPreferredVideoCodecs: 0,
			totalAudioCodecs: 0,
			supportedAudioCodecs: 0,
			demuxableContainers: [],
			videoCodecs: [],
			audioCodecs: []
		};
	}
}

function probeFormatCompatibility(): Promise<DiagFormatCompatibilitySummary> {
	if (!cachedFormatCompatibility) {
		cachedFormatCompatibility = probeFormatCompatibilityUncached();
	}
	return cachedFormatCompatibility;
}

async function buildCapabilityReport(input: WorkerDiagnosticInput): Promise<CapabilityReport> {
	const isolated = globalThis.crossOriginIsolated === true;
	const hasSab = typeof SharedArrayBuffer === 'function';
	const hasWebCodecs = typeof VideoDecoder !== 'undefined';
	const hasOpfs =
		typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
	const tier: DiagnosticCapabilityTier =
		isolated && hasSab && input.webgpuReady && hasWebCodecs ? 'accelerated' : 'limited';
	const findings: CapabilityFinding[] = [
		finding(
			'capability.cross_origin_isolated',
			isolated,
			isolated
				? 'Cross-origin isolation is active.'
				: 'Cross-origin isolation is missing, so SharedArrayBuffer is gated.',
			isolated ? undefined : 'Serve the app with COOP/COEP headers, then reload.'
		),
		finding(
			'capability.shared_array_buffer',
			hasSab,
			hasSab ? 'SharedArrayBuffer is available.' : 'SharedArrayBuffer is unavailable.',
			hasSab ? undefined : 'Use an isolated modern browser context.'
		),
		finding(
			'capability.webcodecs',
			hasWebCodecs,
			hasWebCodecs
				? 'WebCodecs is exposed in this worker.'
				: 'WebCodecs is unavailable in this worker.',
			hasWebCodecs
				? undefined
				: 'Use a recent Chromium-based browser for accelerated import/export.'
		)
	];
	if (input.livePublish) {
		findings.push(...publishFindings(input.livePublish));
	}
	if (input.programMode) {
		const probe = input.capture ? ({ capture: input.capture } as CapabilityProbeResult) : null;
		const captureReasons = probe ? captureUnavailableReasons(probe) : [];
		const reasonStr =
			captureReasons.length > 0 ? captureReasons.join(' ') : 'Missing required capabilities.';
		findings.push(
			finding(
				'program.mode',
				input.programMode === 'supported',
				input.programMode === 'supported'
					? 'Program Mode is available (WebGPU + capture probes OK).'
					: `Program Mode unavailable: ${reasonStr}`,
				input.programMode === 'supported' ? undefined : `Program Mode unavailable: ${reasonStr}`
			)
		);
	}
	if (!input.webgpuReady && input.gpuUnavailableReason) {
		findings.push({
			code: 'capability.webgpu_unavailable',
			status: 'unavailable',
			message: input.gpuUnavailableReason,
			action:
				'Enable hardware acceleration, update GPU drivers, or use a WebGPU-capable Chromium browser.'
		});
	}
	return {
		tier,
		tierReason:
			tier === 'accelerated'
				? 'Worker has isolation, SharedArrayBuffer, WebGPU, and WebCodecs.'
				: (input.gpuUnavailableReason ??
					'One or more accelerated worker capabilities are unavailable.'),
		crossOriginIsolated: isolated,
		sharedArrayBuffer: finding(
			'capability.shared_array_buffer',
			hasSab,
			hasSab ? 'SharedArrayBuffer is available.' : 'SharedArrayBuffer is unavailable.',
			hasSab ? undefined : 'Enable COOP/COEP and reload.'
		),
		webGpu: webGpuCapability(input),
		webCodecs: {
			decoders: await probeDecoders(),
			encoders: await probeEncoders()
		},
		formatCompatibility: await probeFormatCompatibility(),
		mediabunny: finding(
			'capability.mediabunny',
			true,
			'Mediabunny modules are bundled in the worker.'
		),
		audioWorklet: {
			code: 'capability.audio_worklet',
			status: 'unknown',
			message:
				'AudioWorklet availability is not probed in the pipeline worker. See UI diagnostics for the main-thread report.'
		},
		fileSystemAccess: finding(
			'capability.file_system_access',
			false,
			'File System Access pickers are main-thread-only and reported by the UI snapshot.',
			'Open the diagnostics panel in the UI for picker availability.'
		),
		opfs: finding(
			'capability.opfs',
			hasOpfs,
			hasOpfs
				? 'OPFS is available for worker-owned cache data.'
				: 'OPFS is unavailable; cache falls back or is disabled.'
		),
		findings
	};
}

async function storageSummary(): Promise<StorageDiagnosticSummary> {
	const now = Date.now();
	if (cachedStorage && now - cachedStorage.at < STORAGE_CACHE_TTL_MS) {
		return cachedStorage.value;
	}
	const value = await storageSummaryUncached();
	cachedStorage = { at: now, value };
	return value;
}

async function storageSummaryUncached(): Promise<StorageDiagnosticSummary> {
	const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
	const estimate = storage?.estimate ? await storage.estimate().catch(() => null) : null;
	const persisted = storage?.persisted ? await storage.persisted().catch(() => null) : null;
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
		opfsSupported: typeof storage?.getDirectory === 'function',
		indexedDbSupported: typeof indexedDB !== 'undefined',
		persistentStorage: persisted === null ? 'unknown' : persisted ? 'granted' : 'denied',
		usageBytes,
		quotaBytes,
		warning
	};
}

function proxyCacheSummary(sources: readonly DiagnosticSourceLike[]): ProxyCacheDiagnosticSummary {
	let proxyAssets = 0;
	let readyProxies = 0;
	let failedProxies = 0;
	let estimatedBytes = 0;
	for (const source of sources) {
		if (!source.proxy) continue;
		proxyAssets += 1;
		if (source.proxy.status === 'ready') readyProxies += 1;
		if (source.proxy.status === 'failed') failedProxies += 1;
		estimatedBytes += source.proxy.byteSize ?? 0;
	}
	return {
		status: proxyAssets === 0 ? 'unknown' : failedProxies > 0 ? 'degraded' : 'available',
		proxyAssets,
		readyProxies,
		failedProxies,
		estimatedBytes,
		message:
			proxyAssets === 0
				? 'No proxy/cache assets are currently reported.'
				: 'Proxy/cache summary is available.'
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

function voiceCleanupSummary(settings: VoiceCleanupSettings): VoiceCleanupDiagnosticSummary {
	const denoiserEnabled = settings.denoiserEnabledTracks.length > 0;
	return {
		denoiserEnabledTrackCount: settings.denoiserEnabledTracks.length,
		wasmProvenance: '@jitsi/rnnoise-wasm@0.2.1 prebuilt artifact',
		wasmSha256: null,
		wasmLoadStatus: denoiserEnabled ? 'loaded' : 'not-loaded',
		wasmLoadTimeMs: null,
		workletLatencyMs: 17.67,
		normalisationTargetLufs: settings.normalisationTargetLufs,
		normaliseGainDb: settings.normaliseGainDb,
		limiterCeilingDbtp: settings.limiterCeilingDbtp,
		findings: [
			{
				code: 'voice-cleanup.rnnoise-wasm',
				status: denoiserEnabled ? 'supported' : 'unknown',
				message: denoiserEnabled
					? 'RNNoise WASM is enabled for one or more audio tracks.'
					: 'RNNoise WASM is loaded lazily when a track denoiser is enabled.'
			},
			finding(
				'voice-cleanup.worklet-path',
				true,
				'Live monitor denoising runs in the AudioWorklet; export denoising runs in the pipeline worker.'
			)
		]
	};
}

function errorsForSubsystem(input: WorkerDiagnosticInput, subsystem: string): readonly string[] {
	return input.recentErrors.entries.filter((e) => e.subsystem === subsystem).map((e) => e.id);
}

function recoveryActions(input: WorkerDiagnosticInput, isolated: boolean): RecoveryAction[] {
	const actions: RecoveryAction[] = [];

	if (!isolated) {
		actions.push({
			actionId: 'missing-isolation',
			kind: 'reload-app',
			label: 'Reload with isolation',
			description:
				'Cross-origin isolation (COOP/COEP) is missing. The accelerated SAB clock, SharedArrayBuffer, and full-performance preview require isolation headers. Serve the app from a correctly configured origin and reload.',
			enabled: true,
			destructive: false,
			requiresUserGesture: true,
			relatedErrorIds: errorsForSubsystem(input, 'capability')
		});
	}

	if (!input.webgpuReady && input.webgpuStatus !== 'lost') {
		actions.push({
			actionId: 'retry-gpu-device',
			kind: 'retry-gpu-device',
			label: 'Retry GPU',
			description:
				'WebGPU is unavailable. The zero-copy preview pipeline and GPU-accelerated effects require a WebGPU adapter and device. Check that hardware acceleration is enabled, GPU drivers are up to date, and you are using a WebGPU-capable Chromium browser (Chrome/Edge 113+).',
			enabled: true,
			destructive: false,
			requiresUserGesture: false,
			relatedErrorIds: errorsForSubsystem(input, 'gpu')
		});
	}

	if (input.lastDeviceLost) {
		actions.push({
			actionId: 'device-lost-recovery',
			kind: 'retry-gpu-device',
			label: 'Recover GPU device',
			description: `GPU device was lost: ${input.lastDeviceLost.message || input.lastDeviceLost.reason}. Preview and export are paused. A device recovery attempt can reinitialize the pipeline without losing project state.`,
			enabled: true,
			destructive: false,
			requiresUserGesture: false,
			relatedErrorIds: errorsForSubsystem(input, 'gpu')
		});
	}

	const hasAudioErrors = input.recentErrors.entries.some((e) => e.subsystem === 'audio');
	if (hasAudioErrors) {
		actions.push({
			actionId: 'retry-audio',
			kind: 'retry-audio',
			label: 'Retry audio',
			description:
				'Audio initialization failed. This can happen if AudioWorklet module loading failed, AudioContext was blocked before a user gesture, or the audio ring buffer could not be set up. Timeline editing and visual preview remain available.',
			enabled: true,
			destructive: false,
			requiresUserGesture: true,
			relatedErrorIds: errorsForSubsystem(input, 'audio')
		});
	}

	const hasImportErrors = input.recentErrors.entries.some(
		(e) => e.subsystem === 'import' && e.severity === 'error'
	);
	if (hasImportErrors) {
		actions.push({
			actionId: 'retry-import',
			kind: 'retry-import',
			label: 'Retry import',
			description:
				'One or more media imports failed. This may be due to a corrupt file, unsupported container or codec, descriptor mismatch, or denied file permission. The current project is preserved.',
			enabled: true,
			destructive: false,
			requiresUserGesture: true,
			relatedErrorIds: errorsForSubsystem(input, 'import')
		});
	}

	const hasExportErrors = input.recentErrors.entries.some(
		(e) => e.subsystem === 'export' && e.severity === 'error'
	);
	if (hasExportErrors) {
		actions.push({
			actionId: 'retry-export',
			kind: 'retry-export',
			label: 'Retry export',
			description:
				'Export failed during prepare, decode, render, encode, mux, or write. Export settings and queue state are preserved so you can retry with the same configuration.',
			enabled: true,
			destructive: false,
			requiresUserGesture: true,
			relatedErrorIds: errorsForSubsystem(input, 'export')
		});
	}

	const hasStoragePressure = input.recentErrors.entries.some((e) => e.subsystem === 'storage');
	if (hasStoragePressure) {
		actions.push({
			actionId: 'open-storage-cleanup',
			kind: 'open-storage-cleanup',
			label: 'Clean up storage',
			description:
				'Storage quota is under pressure. You can free space by clearing render cache, thumbnails, waveform peaks, or unpinned proxies without affecting your project document or source metadata.',
			enabled: true,
			destructive: false,
			requiresUserGesture: true,
			relatedErrorIds: errorsForSubsystem(input, 'storage')
		});
	}

	actions.push({
		actionId: 'export-project-bundle',
		kind: 'export-project-bundle',
		label: 'Export project bundle',
		description: 'Create a local bundle before clearing storage or reloading.',
		enabled: true,
		destructive: false,
		requiresUserGesture: true,
		relatedErrorIds: [
			...errorsForSubsystem(input, 'storage'),
			...errorsForSubsystem(input, 'worker')
		]
	});
	actions.push({
		actionId: 'reload-app',
		kind: 'reload-app',
		label: 'Reload app',
		description: 'Reload after saving/exporting project state.',
		enabled: true,
		destructive: false,
		requiresUserGesture: true,
		relatedErrorIds: []
	});
	return actions;
}

export async function buildWorkerDiagnosticSnapshot(
	input: WorkerDiagnosticInput
): Promise<DiagnosticSnapshot> {
	const isolated = globalThis.crossOriginIsolated === true;
	return {
		schemaVersion: DIAGNOSTIC_SNAPSHOT_SCHEMA_VERSION,
		snapshotId: makeSnapshotId(),
		createdAt: new Date().toISOString(),
		appVersion: input.appVersion,
		browser: userAgentSummary(),
		capability: await buildCapabilityReport(input),
		storage: await storageSummary(),
		proxyCache: proxyCacheSummary(input.sources),
		voiceCleanup: voiceCleanupSummary(input.voiceCleanup ?? DEFAULT_VOICE_CLEANUP_SETTINGS),
		mlRuntime: { mlRuntime: 'ort' },
		activeExportSettings: exportSettingsSummary(input.activeExportSettings),
		performanceBudgets: buildDefaultPerformanceBudgets({
			'gpu-submissions-per-frame': {
				observed: input.rendererSubmissionCount,
				sampleCount: input.rendererSubmissionCount === null ? 0 : 1
			}
		}),
		recentErrors: input.recentErrors,
		recoveryActions: recoveryActions(input, isolated)
	};
}
