import type {
	CapabilityProbeResult,
	CapabilityTierV2,
	CaptureProbeResult,
	CodecProbeResult,
	ExportCodecSupport,
	FeatureSupport,
	LivePublishProbeResult
} from '../protocol';
import { probeWebNN } from './audio-cleanup/webnn-probe';
import { probeAsr } from './asr/asr-probe';

type VideoCodecProbeName = 'h264' | 'vp9' | 'av1';
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
	h264: 'avc1.42E01E',
	vp9: 'vp09.00.10.08',
	av1: 'av01.0.05M.08'
};

const audioCodecStrings: Record<AudioCodecProbeName, string> = {
	aac: 'mp4a.40.2',
	opus: 'opus'
};

function supportFromBoolean(value: boolean): FeatureSupport {
	return value ? 'supported' : 'unsupported';
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
		probeCodec(videoDecoder, { ...videoBase, codec: videoCodecStrings.h264 }),
		probeCodec(videoDecoder, { ...videoBase, codec: videoCodecStrings.vp9 }),
		probeCodec(videoDecoder, { ...videoBase, codec: videoCodecStrings.av1 }),
		probeCodec(videoEncoder, { ...videoBase, codec: videoCodecStrings.h264 }),
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
	if (typeof VideoEncoder !== 'function') return 'unsupported';
	try {
		const config: VideoEncoderConfig = {
			codec: 'avc1.42001E',
			width: 1920,
			height: 1080,
			bitrate: 5_000_000,
			latencyMode: 'realtime',
			hardwareAcceleration: 'prefer-hardware'
		};
		const result = await VideoEncoder.isConfigSupported(config);
		return result.supported === true ? 'supported' : 'unsupported';
	} catch {
		return 'unknown';
	}
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

async function probeOpfsSyncAccessHandle(): Promise<FeatureSupport> {
	try {
		if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') {
			return 'unsupported';
		}
		const root = await navigator.storage.getDirectory();
		const fileName = `_cap_probe_${Date.now()}_${Math.random().toString(36).slice(2)}.tmp`;
		const handle = await root.getFileHandle(fileName, { create: true });
		const access = await (handle as FileSystemFileHandle).createSyncAccessHandle();
		access.close();
		await root.removeEntry(fileName);
		return 'supported';
	} catch {
		return 'unknown';
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
		probeOpfsSyncAccessHandle()
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

/**
 * Whether recording is available: accelerated tier + all critical capture probes
 * are `'supported'`. Display audio is NOT critical (its absence only disables the
 * audio toggle; video recording remains available).
 */
export function recordingAvailable(probe: CapabilityProbeResult): boolean {
	const cap = probe.capture;
	return (
		probe.tier === 'core-webgpu' &&
		cap.mediaStreamTrackProcessor === 'supported' &&
		cap.transferableMediaStreamTrack !== 'unsupported' &&
		cap.displayCapture === 'supported' &&
		cap.videoEncodeRealtime === 'supported' &&
		cap.audioEncodeOpus === 'supported' &&
		cap.opfsSyncAccessHandle === 'supported'
	);
}

export async function probeCapabilities(): Promise<CapabilityProbeResult> {
	// Probe both adapters independently so the diagnostic panel reports each one's
	// true availability. Short-circuiting webGPUCompat to 'unsupported' whenever the
	// standard adapter succeeds would mislabel Chrome — which exposes both — as
	// lacking the compatibility adapter. The compatibilityAdapter boolean below (not
	// the raw support flag) is what drives the reduced-pipeline wiring decision.
	// WebNN gates only the optional Audio Cleanup feature; it is carried for
	// diagnostics display and never consulted by deriveCapabilityTierV2.
	const [webGPUCore, webGPUCompat, webnn] = await Promise.all([
		probeGpuAdapter(false),
		probeGpuAdapter(true),
		probeWebNN()
	]);
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
	return {
		...probeWithoutTier,
		tier: deriveCapabilityTierV2(probeWithoutTier),
		webnn,
		asr: probeAsr()
	};
}
