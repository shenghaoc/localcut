import type {
	BeautyProbeResult,
	CapabilityProbeResult,
	CapabilityTierV2,
	CaptureProbeResult,
	CaptureUxProbeResult,
	CodecProbeResult,
	ExportCodecSupport,
	FeatureSupport,
	LivePublishProbeResult,
	SmartReframeProbeResult
} from '../protocol';
import type { CleanupProbeResult } from '../protocol';
import { probeAsr } from './asr/asr-probe';
import { CAPTURE_VIDEO_CODEC_FALLBACKS } from './replay-buffer/capture';

// H.264 is probed via the resolution-derived `h264ConstrainedBaseline()` helper,
// so it does not live in `videoCodecStrings` (which only holds fixed strings).
type VideoCodecProbeName = 'vp9' | 'av1';
type AudioCodecProbeName = 'aac' | 'opus';

interface CodecProbeConfig {
	codec: string;
	width?: number;
	height?: number;
	sampleRate?: number;
	numberOfChannels?: number;
	bitrate?: number;
	hardwareAcceleration?: 'prefer-hardware';
}

type CodecProbeConstructor = {
	isConfigSupported?: (config: CodecProbeConfig) => Promise<{ supported?: boolean }>;
};

type GpuWithCompat = {
	requestAdapter: (
		options?: GPURequestAdapterOptions & { featureLevel?: 'compatibility' }
	) => Promise<GPUAdapter | null>;
};

const unknownCodecs: CodecProbeResult = {
	h264Decode: 'unknown',
	vp9Decode: 'unknown',
	av1Decode: 'unknown',
	h264Encode: 'unknown',
	vp9Encode: 'unknown',
	av1Encode: 'unknown',
	aacDecode: 'unknown',
	opusDecode: 'unknown',
	aacEncode: 'unknown',
	opusEncode: 'unknown'
};

const videoCodecStrings: Record<VideoCodecProbeName, string> = {
	vp9: 'vp09.00.10.08',
	av1: 'av01.0.05M.08'
};

/**
 * Returns an H.264 Constrained-Baseline codec string whose level covers
 * the given frame size. MaxFS per H.264 Table A-1: L3.0=1620, L3.1=3600,
 * L3.2=5120, L4.0/4.1=8192, L4.2=8704, L5.0=22080, L5.1=36864.
 */
export function h264ConstrainedBaseline(width: number, height: number): string {
	const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
	const level =
		mbs <= 1620
			? 0x1e
			: mbs <= 3600
				? 0x1f
				: mbs <= 5120
					? 0x20
					: mbs <= 8192
						? 0x28 // L4.0 (L4.1 shares MaxFS = 8192)
						: mbs <= 8704
							? 0x2a // L4.2 — covers 8193–8704 MBs (e.g. ~2048×1088)
							: mbs <= 22080
								? 0x32 // L5.0
								: 0x33; // L5.1
	return `avc1.42E0${level.toString(16).toUpperCase().padStart(2, '0')}`;
}

const audioCodecStrings: Record<AudioCodecProbeName, string> = {
	aac: 'mp4a.40.2',
	opus: 'opus'
};

function supportFromBoolean(value: boolean): FeatureSupport {
	return value ? 'supported' : 'unsupported';
}

function preferredCleanupAcceleratorFromPlatform(): CleanupProbeResult['accelerator'] {
	try {
		const nav =
			typeof navigator === 'undefined' ? null : (navigator as Navigator & { ml?: unknown });
		if (nav?.ml !== undefined) return 'webnn';
	} catch {
		// fall through to the next cheaper accelerator check
	}
	try {
		if (typeof navigator !== 'undefined' && 'gpu' in navigator) return 'webgpu';
	} catch {
		// fall back to the baseline runtime
	}
	return 'wasm';
}

function hasSharedArrayBuffer(): FeatureSupport {
	if (typeof SharedArrayBuffer !== 'function') return 'unsupported';
	try {
		new SharedArrayBuffer(8);
		return 'supported';
	} catch {
		return 'unknown';
	}
}

async function probeGpuAdapter(compatibility: boolean): Promise<FeatureSupport> {
	if (typeof navigator === 'undefined' || !('gpu' in navigator)) return 'unsupported';
	try {
		const gpu = navigator.gpu as GpuWithCompat;
		const adapter = await gpu.requestAdapter(
			compatibility ? { featureLevel: 'compatibility' } : undefined
		);
		return adapter ? 'supported' : 'unsupported';
	} catch {
		return 'unknown';
	}
}

async function probeCodec(
	ctor: CodecProbeConstructor | undefined,
	config: CodecProbeConfig
): Promise<FeatureSupport> {
	if (!ctor?.isConfigSupported) return 'unsupported';
	try {
		const result = await ctor.isConfigSupported(config);
		return result.supported === true ? 'supported' : 'unsupported';
	} catch {
		return 'unknown';
	}
}

function getCodecConstructor(
	name: 'VideoDecoder' | 'VideoEncoder' | 'AudioDecoder' | 'AudioEncoder'
): CodecProbeConstructor | undefined {
	const value = (globalThis as unknown as Record<string, unknown>)[name];
	return typeof value === 'function' ? (value as CodecProbeConstructor) : undefined;
}

async function probeCodecs(): Promise<CodecProbeResult> {
	const videoDecoder = getCodecConstructor('VideoDecoder');
	const videoEncoder = getCodecConstructor('VideoEncoder');
	const audioDecoder = getCodecConstructor('AudioDecoder');
	const audioEncoder = getCodecConstructor('AudioEncoder');

	const videoBase = { width: 1280, height: 720, bitrate: 5_000_000 };
	const audioBase = { sampleRate: 48_000, numberOfChannels: 2, bitrate: 128_000 };
	const h264Codec = h264ConstrainedBaseline(1280, 720);

	// The ten probes are independent; running them in parallel keeps startup from
	// serializing across isConfigSupported round-trips (each can hit a hardware
	// capability query). probeCodec already maps its own failures to a state, so
	// Promise.all never rejects here.
	const [
		h264Decode,
		vp9Decode,
		av1Decode,
		h264Encode,
		vp9Encode,
		av1Encode,
		aacDecode,
		opusDecode,
		aacEncode,
		opusEncode
	] = await Promise.all([
		probeCodec(videoDecoder, { ...videoBase, codec: h264Codec }),
		probeCodec(videoDecoder, { ...videoBase, codec: videoCodecStrings.vp9 }),
		probeCodec(videoDecoder, { ...videoBase, codec: videoCodecStrings.av1 }),
		probeCodec(videoEncoder, { ...videoBase, codec: h264Codec }),
		probeCodec(videoEncoder, { ...videoBase, codec: videoCodecStrings.vp9 }),
		probeCodec(videoEncoder, { ...videoBase, codec: videoCodecStrings.av1 }),
		probeCodec(audioDecoder, { ...audioBase, codec: audioCodecStrings.aac }),
		probeCodec(audioDecoder, { ...audioBase, codec: audioCodecStrings.opus }),
		probeCodec(audioEncoder, { ...audioBase, codec: audioCodecStrings.aac }),
		probeCodec(audioEncoder, { ...audioBase, codec: audioCodecStrings.opus })
	]);

	return {
		h264Decode,
		vp9Decode,
		av1Decode,
		h264Encode,
		vp9Encode,
		av1Encode,
		aacDecode,
		opusDecode,
		aacEncode,
		opusEncode
	};
}

/**
 * Usable video decode for *at least one* import codec. Derived from the real
 * per-codec probes — not from the mere presence of the `VideoDecoder`
 * constructor — so a browser that exposes the API but supports no import codec
 * is not mistaken for a working decode path.
 */
export function anyVideoDecodeSupported(codecs: CodecProbeResult): boolean {
	return (
		codecs.h264Decode === 'supported' ||
		codecs.vp9Decode === 'supported' ||
		codecs.av1Decode === 'supported'
	);
}

/** Usable video encode for at least one export codec (drives export, not tier). */
export function anyVideoEncodeSupported(codecs: CodecProbeResult): boolean {
	return (
		codecs.h264Encode === 'supported' ||
		codecs.vp9Encode === 'supported' ||
		codecs.av1Encode === 'supported'
	);
}

/** Usable audio decode for at least one import codec. */
export function anyAudioDecodeSupported(codecs: CodecProbeResult): boolean {
	return codecs.aacDecode === 'supported' || codecs.opusDecode === 'supported';
}

/** Usable audio encode for at least one export codec. */
export function anyAudioEncodeSupported(codecs: CodecProbeResult): boolean {
	return codecs.aacEncode === 'supported' || codecs.opusEncode === 'supported';
}

/**
 * Phase 47 (T4.1): live-publish probes. Runs where `probeCapabilities` runs —
 * the main thread (App startup) — which is exactly where `RTCPeerConnection`
 * lives; worker-side generator availability is re-confirmed by the worker at
 * tap start, falling back to the main-frames mode.
 */
export async function probeLivePublish(
	// Shared with the Phase 41 capture group — one transfer-detection
	// implementation (probeTransferableMediaStreamTrack), probed once per
	// session by probeCapabilities and fed to both groups.
	trackTransfer: FeatureSupport = probeTransferableMediaStreamTrack()
): Promise<LivePublishProbeResult> {
	const globals = globalThis as unknown as Record<string, unknown>;
	const rtcPeerConnection = supportFromBoolean(typeof globals.RTCPeerConnection === 'function');
	// Main-side constructor presence is the proxy for worker availability —
	// Chromium exposes the generator in both scopes; the worker re-confirms at
	// tap start and falls back to the main-frames mode.
	const trackGeneratorWorker = supportFromBoolean(
		typeof globals.MediaStreamTrackGenerator === 'function'
	);

	const senderCtor = globals.RTCRtpSender as { prototype?: Record<string, unknown> } | undefined;
	const generateKeyFrame = supportFromBoolean(
		typeof senderCtor?.prototype?.generateKeyFrame === 'function'
	);
	// Isolated so an encoder-probe failure can never reject probeLivePublish and
	// take the (independent) WebRTC findings down to 'unknown' with it.
	let hardwareH264Encode: FeatureSupport = 'unsupported';
	try {
		hardwareH264Encode = await probeCodec(getCodecConstructor('VideoEncoder'), {
			codec: 'avc1.42e029',
			width: 1920,
			height: 1080,
			bitrate: 6_000_000,
			hardwareAcceleration: 'prefer-hardware'
		});
	} catch {
		hardwareH264Encode = 'unknown';
	}

	return {
		rtcPeerConnection,
		trackGeneratorWorker,
		trackTransfer,
		generateKeyFrame,
		hardwareH264Encode
	};
}

/** R3.1: the publish feature exists only when the strictly required pieces do. */
export function livePublishAvailable(probe: LivePublishProbeResult): boolean {
	return probe.rtcPeerConnection === 'supported' && probe.trackGeneratorWorker === 'supported';
}

export function deriveCapabilityTierV2(
	probe: Omit<CapabilityProbeResult, 'tier'>
): CapabilityTierV2 {
	const hasGpu = probe.webGPUCore === 'supported' || probe.webGPUCompat === 'supported';
	// Tier depends on *usable* video decode (real codec probes), never on the bare
	// VideoDecoder constructor and never on encode support — export-codec
	// availability is represented separately by `exportConstraintsForProbe`.
	const hasDecode = anyVideoDecodeSupported(probe.codecs);
	const hasSab = probe.sharedArrayBuffer === 'supported';
	const hasOffscreenCanvas = probe.offscreenCanvas === 'supported';

	// core-webgpu = the accelerated preview/editing path is available. It does NOT
	// require AV1 (or any specific) encode; an H.264-only Chromium session is core.
	if (
		probe.webGPUCore === 'supported' &&
		hasDecode &&
		hasSab &&
		hasOffscreenCanvas &&
		probe.crossOriginIsolated
	) {
		return 'core-webgpu';
	}
	if (hasGpu && hasDecode && hasOffscreenCanvas) return 'compatibility-webgpu';
	if (hasDecode && hasOffscreenCanvas) return 'limited-webcodecs';
	// shell-only: no WebGPU path and no usable video-decode path (or no canvas).
	return 'shell-only';
}

export function exportConstraintsForProbe(
	probe: CapabilityProbeResult
): readonly ExportCodecSupport[] {
	const supported: ExportCodecSupport[] = [];
	if (probe.codecs.h264Encode === 'supported') {
		supported.push({ codec: 'h264', container: 'mp4' });
	}
	if (probe.codecs.vp9Encode === 'supported') {
		supported.push({ codec: 'vp9', container: 'webm' });
	}
	if (probe.tier === 'core-webgpu' && probe.codecs.av1Encode === 'supported') {
		supported.push({ codec: 'av1', container: 'webm' });
	}
	return supported;
}

// ── Capture probes (Phase 41) ─────────────────────────────────────────────

function probeMediaStreamTrackProcessor(): FeatureSupport {
	try {
		return typeof MediaStreamTrackProcessor === 'function' ? 'supported' : 'unsupported';
	} catch {
		return 'unknown';
	}
}

function probeTransferableMediaStreamTrack(): FeatureSupport {
	try {
		if (
			typeof document === 'undefined' ||
			typeof MediaStreamTrack === 'undefined' ||
			typeof structuredClone !== 'function'
		) {
			return 'unsupported';
		}
		const canvas = document.createElement('canvas');
		const stream = canvas.captureStream();
		const track = stream.getVideoTracks().at(0);
		if (!track) return 'unsupported';
		try {
			const cloned = structuredClone(track, { transfer: [track] });
			return typeof cloned === 'object' && cloned !== null ? 'supported' : 'unsupported';
		} catch {
			return 'unsupported';
		} finally {
			track.stop();
		}
	} catch {
		return 'unknown';
	}
}

function probeDisplayCapture(): FeatureSupport {
	if (typeof navigator !== 'undefined' && 'mediaDevices' in navigator) {
		const md = navigator.mediaDevices as MediaDevices | undefined;
		return md && typeof md.getDisplayMedia === 'function' ? 'supported' : 'unsupported';
	}
	return 'unsupported';
}

async function probeDisplayAudioCapture(): Promise<FeatureSupport> {
	try {
		if (typeof navigator === 'undefined') {
			return 'unsupported';
		}
		const md = navigator.mediaDevices as MediaDevices | undefined;
		if (!md || typeof md.getDisplayMedia !== 'function') return 'unsupported';
		// Attempt to query supported constraints without a full picker gesture.
		// This is a best-effort probe; the result may be 'unknown' until first real use.
		if (typeof md.getSupportedConstraints !== 'function') return 'unknown';
		const constraints = md.getSupportedConstraints();
		if ('systemAudio' in constraints && (constraints as Record<string, boolean>).systemAudio) {
			return 'supported';
		}
		return 'unknown';
	} catch {
		return 'unknown';
	}
}

async function probeVideoEncodeRealtime(): Promise<FeatureSupport> {
	if (typeof VideoEncoder !== 'function' || typeof VideoEncoder.isConfigSupported !== 'function') {
		return 'unsupported';
	}
	// Probe the exact codecs the capture session chooses between, so a 'supported'
	// here means the recording encoder can actually configure — not just that some
	// unrelated H.264 profile/level works. This list is the single source of truth:
	// the worker's runtime encoder setup builds its candidate set from the same
	// CAPTURE_VIDEO_CODEC_FALLBACKS and `VideoEncoder.isConfigSupported`-selects one
	// of them (see ensureCaptureVideoEncoder in worker.ts), so the UI gate and the encoder
	// cannot drift. Run them in parallel like probeCodecs so startup doesn't
	// serialize the isConfigSupported calls.
	const results = await Promise.all(
		CAPTURE_VIDEO_CODEC_FALLBACKS.map((codec) =>
			VideoEncoder.isConfigSupported({
				codec,
				width: 1920,
				height: 1080,
				bitrate: 5_000_000,
				latencyMode: 'realtime',
				hardwareAcceleration: 'prefer-hardware'
			})
				.then((r): FeatureSupport => (r.supported === true ? 'supported' : 'unsupported'))
				.catch((): FeatureSupport => 'unknown')
		)
	);
	if (results.includes('supported')) return 'supported';
	if (results.includes('unknown')) return 'unknown';
	return 'unsupported';
}

async function probeAudioEncode(codec: 'opus' | 'aac'): Promise<FeatureSupport> {
	if (typeof AudioEncoder !== 'function') return 'unsupported';
	try {
		const config: AudioEncoderConfig = {
			codec: codec === 'opus' ? 'opus' : 'mp4a.40.2',
			sampleRate: 48_000,
			numberOfChannels: 2,
			bitrate: 128_000
		};
		const result = await AudioEncoder.isConfigSupported(config);
		return result.supported === true ? 'supported' : 'unsupported';
	} catch {
		return 'unknown';
	}
}

export async function probeOpfsSyncAccessHandleInWorker(): Promise<FeatureSupport> {
	if (typeof Worker === 'undefined' || typeof navigator?.storage?.getDirectory !== 'function') {
		return 'unsupported';
	}
	// The result is posted only AFTER the temp file is removed, so the parent's
	// worker.terminate() (which runs as soon as it receives the message) cannot
	// race the cleanup and leave a _cap_probe_*.tmp behind on every startup.
	const src = `self.onmessage = async () => {
		let result = 'unknown';
		let root, name, created = false;
		try {
			root = await navigator.storage.getDirectory();
			name = '_cap_probe_' + Math.floor(performance.timeOrigin + performance.now()) + '_' + Math.random().toString(36).slice(2) + '.tmp';
			const handle = await root.getFileHandle(name, { create: true });
			created = true;
			if (typeof handle.createSyncAccessHandle !== 'function') {
				result = 'unsupported';
			} else {
				const access = await handle.createSyncAccessHandle();
				access.close();
				result = 'supported';
			}
		} catch {
			result = 'unknown';
		}
		if (created && root && name) {
			try { await root.removeEntry(name); } catch {}
		}
		self.postMessage(result);
	};`;
	let url: string | undefined;
	let worker: Worker | undefined;
	try {
		// Inside the try so a throwing createObjectURL/Blob/Worker (strict CSP, SSR,
		// or headless test env) degrades to 'unknown' instead of rejecting the probe.
		url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
		worker = new Worker(url);
		const w = worker;
		return await new Promise<FeatureSupport>((resolve) => {
			const timer = setTimeout(() => resolve('unknown'), 3_000);
			w.onmessage = (e) => {
				clearTimeout(timer);
				resolve(e.data as FeatureSupport);
			};
			w.onerror = () => {
				clearTimeout(timer);
				resolve('unknown');
			};
			w.postMessage('go');
		});
	} catch {
		return 'unknown';
	} finally {
		worker?.terminate();
		// Revoke only after the worker has loaded and finished (or timed out): some
		// browsers fetch the worker script asynchronously, so revoking immediately
		// after `new Worker` can abort the load. The finally still runs if `new
		// Worker` throws, so the URL is never leaked.
		if (url) URL.revokeObjectURL(url);
	}
}

async function probeCaptureCapabilities(
	transferableMediaStreamTrack: FeatureSupport = probeTransferableMediaStreamTrack()
): Promise<CaptureProbeResult> {
	const [
		displayAudioCapture,
		videoEncodeRealtime,
		audioEncodeOpus,
		audioEncodeAac,
		opfsSyncAccessHandle
	] = await Promise.all([
		probeDisplayAudioCapture(),
		probeVideoEncodeRealtime(),
		probeAudioEncode('opus'),
		probeAudioEncode('aac'),
		probeOpfsSyncAccessHandleInWorker()
	]);

	return {
		mediaStreamTrackProcessor: probeMediaStreamTrackProcessor(),
		transferableMediaStreamTrack,
		displayCapture: probeDisplayCapture(),
		displayAudioCapture,
		videoEncodeRealtime,
		audioEncodeOpus,
		audioEncodeAac,
		opfsSyncAccessHandle
	};
}

const unknownCapture: CaptureProbeResult = {
	mediaStreamTrackProcessor: 'unknown',
	transferableMediaStreamTrack: 'unknown',
	displayCapture: 'unknown',
	displayAudioCapture: 'unknown',
	videoEncodeRealtime: 'unknown',
	audioEncodeOpus: 'unknown',
	audioEncodeAac: 'unknown',
	opfsSyncAccessHandle: 'unknown'
};

/** Probe Smart Reframe capabilities. Saliency is always supported (pure DSP). */
export function probeSmartReframe(): SmartReframeProbeResult {
	// Analysis worker: the dedicated Smart Reframe worker needs the Worker ctor.
	const analysisWorker: FeatureSupport =
		typeof Worker !== 'undefined' ? 'supported' : 'unsupported';

	// Face detection runs in the analysis worker on the user's explicit action.
	// Capability is tied to worker availability; the actual ORT/ONNX model
	// download happens on use, and any model failure falls back to saliency.
	const faceDetection: FeatureSupport = analysisWorker;

	return {
		faceDetection,
		saliency: 'supported', // Pure DSP — always available
		analysisWorker
	};
}

const unknownCaptureUx: CaptureUxProbeResult = {
	documentPip: 'unknown',
	cropTarget: 'unknown',
	elementCapture: 'unknown'
};

/**
 * Phase 42: Probe recorder-UX browser capabilities (Chromium-only APIs).
 * Errors are mapped to `'unknown'` (same pattern as other probe groups).
 */
async function probeCaptureUx(): Promise<CaptureUxProbeResult> {
	const documentPip = supportFromBoolean(
		typeof window !== 'undefined' && 'documentPictureInPicture' in window
	);
	const cropTarget = supportFromBoolean(
		typeof globalThis !== 'undefined' && 'CropTarget' in globalThis
	);
	const elementCapture = supportFromBoolean(
		typeof globalThis !== 'undefined' && 'RestrictionTarget' in globalThis
	);
	return { documentPip, cropTarget, elementCapture };
}

/**
 * Phase 32b: probe Beauty availability — display/feature-gate only. WebGPU +
 * cross-origin isolation are required for the accelerated face/landmark path;
 * WebNN is gated behind per-model proof (reported but not auto-enabled); WASM is
 * the explicit reduced/export-only fallback. Whether a model is actually
 * configured is decided later by the load flow (template manifest → unavailable).
 */
export function probeBeauty(): BeautyProbeResult {
	const nav = typeof navigator !== 'undefined' ? navigator : undefined;
	return {
		wasm: supportFromBoolean(typeof WebAssembly !== 'undefined'),
		webgpu: supportFromBoolean(nav !== undefined && 'gpu' in nav),
		webnn: supportFromBoolean(nav !== undefined && (nav as { ml?: unknown }).ml !== undefined),
		crossOriginIsolated: globalThis.crossOriginIsolated === true
	};
}

/** Phase 38b: probe `ImageDecoder` API for animated image frame-accurate decoding. */
export function probeImageDecoder(): FeatureSupport {
	return typeof (globalThis as unknown as Record<string, unknown>)['ImageDecoder'] === 'function'
		? 'supported'
		: 'unsupported';
}

/** Which path the recorder feeds frames into the pipeline-worker encoder. */
export type CaptureTapMode = 'worker-track' | 'main-frames';

/**
 * Chooses the recorder data-plane path (bugfix B5/T5.5), mirroring publish's
 * `selectTapMode`. With Transferable MediaStreamTrack the source track is
 * transferred into the worker (`worker-track`); without it the main thread keeps
 * the track, reads it with its own `MediaStreamTrackProcessor`, and forwards each
 * frame to the worker encoder (`main-frames`). 'unknown' takes the safe main-frames
 * path — it never attempts a transfer that could throw `DataCloneError`.
 */
export function selectCaptureMode(probe: CapabilityProbeResult): CaptureTapMode {
	return probe.capture.transferableMediaStreamTrack === 'supported'
		? 'worker-track'
		: 'main-frames';
}

/**
 * Whether recording is available: accelerated tier + all critical capture probes
 * are `'supported'`. Display audio is NOT critical (its absence only disables the
 * audio toggle; video recording remains available).
 *
 * Transferable MediaStreamTrack is NOT required: without it the recorder uses the
 * off-main-thread main-frames path (bugfix B5/T5.5), which needs only
 * `MediaStreamTrackProcessor` (read on the main thread). `MediaStreamTrackProcessor`
 * is the universal requirement of both data-plane paths — see {@link selectCaptureMode}.
 */
export function recordingAvailable(probe: CapabilityProbeResult): boolean {
	const cap = probe.capture;
	return (
		probe.tier === 'core-webgpu' &&
		cap.mediaStreamTrackProcessor === 'supported' &&
		cap.displayCapture === 'supported' &&
		cap.videoEncodeRealtime === 'supported' &&
		cap.audioEncodeOpus === 'supported' &&
		cap.opfsSyncAccessHandle === 'supported'
	);
}

/**
 * Phase 45: Program mode derivation follows Phase 41 recording availability — but
 * Program Mode still transfers every source track into the worker (no main-frames
 * fallback yet), so it additionally requires Transferable MediaStreamTrack even
 * though plain recording now degrades without it (bugfix B5/T5.5).
 *
 * No separate WebGPU gate is needed: `recordingAvailable` already requires
 * `tier === 'core-webgpu'`, which `deriveCapabilityTierV2` only returns when
 * `webGPUCore === 'supported'`.
 */
export function deriveProgramModeSupport(probe: CapabilityProbeResult): FeatureSupport {
	return recordingAvailable(probe) && probe.capture.transferableMediaStreamTrack !== 'unsupported'
		? 'supported'
		: 'unsupported';
}

export async function probeCapabilities(): Promise<CapabilityProbeResult> {
	// Probe both adapters independently so the diagnostic panel reports each one's
	// true availability. Short-circuiting webGPUCompat to 'unsupported' whenever the
	// standard adapter succeeds would mislabel Chrome — which exposes both — as
	// lacking the compatibility adapter. The compatibilityAdapter boolean below (not
	// the raw support flag) is what drives the reduced-pipeline wiring decision.
	const [webGPUCore, webGPUCompat] = await Promise.all([
		probeGpuAdapter(false),
		probeGpuAdapter(true)
	]);
	const cleanup: CleanupProbeResult = {
		wasmAvailable: typeof WebAssembly !== 'undefined',
		accelerator: preferredCleanupAcceleratorFromPlatform()
	};
	const codecs = await probeCodecs().catch(() => unknownCodecs);
	// One transfer attempt feeds both the publish and capture probe groups, so
	// the two diagnostics rows can never drift apart within a session.
	const trackTransfer = probeTransferableMediaStreamTrack();
	const livePublish = await probeLivePublish(trackTransfer).catch(
		(): LivePublishProbeResult => ({
			rtcPeerConnection: 'unknown',
			trackGeneratorWorker: 'unknown',
			trackTransfer: 'unknown',
			generateKeyFrame: 'unknown',
			hardwareH264Encode: 'unknown'
		})
	);
	const capture = await probeCaptureCapabilities(trackTransfer).catch(() => unknownCapture);
	const captureUx = await probeCaptureUx().catch(() => unknownCaptureUx);
	const probeWithoutTier: Omit<CapabilityProbeResult, 'tier'> = {
		crossOriginIsolated: globalThis.crossOriginIsolated === true,
		sharedArrayBuffer: hasSharedArrayBuffer(),
		webGPUCore,
		webGPUCompat,
		compatibilityAdapter: webGPUCore !== 'supported' && webGPUCompat === 'supported',
		webCodecsDecode: supportFromBoolean(typeof VideoDecoder !== 'undefined'),
		webCodecsEncode: supportFromBoolean(typeof VideoEncoder !== 'undefined'),
		codecs,
		capture,
		captureUx,
		fileSystemAccess: supportFromBoolean(
			typeof window !== 'undefined' &&
				('showOpenFilePicker' in window || 'showSaveFilePicker' in window)
		),
		opfs: supportFromBoolean(
			typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
		),
		audioWorklet: supportFromBoolean(
			typeof AudioContext !== 'undefined' && 'audioWorklet' in AudioContext.prototype
		),
		offscreenCanvas: supportFromBoolean(typeof OffscreenCanvas !== 'undefined'),
		livePublish
	};
	const tier = deriveCapabilityTierV2(probeWithoutTier);
	const probeWithTier: CapabilityProbeResult = {
		...probeWithoutTier,
		tier
	};
	const result: CapabilityProbeResult = {
		...probeWithTier,
		cleanup,
		asr: probeAsr(),
		smartReframe: probeSmartReframe(),
		imageDecoder: probeImageDecoder(),
		beauty: probeBeauty(),
		programMode: deriveProgramModeSupport(probeWithTier)
	};

	// Dev-only override hook for tests (Vite tree-shakes this in production).
	if (import.meta.env.DEV) {
		const overrides = (globalThis as Record<string, unknown>).__localcutCapabilityOverrides;
		if (overrides && typeof overrides === 'object') {
			Object.assign(result, overrides);
		}
	}

	return result;
}
