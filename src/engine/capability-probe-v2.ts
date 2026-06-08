import type {
	CapabilityProbeResult,
	CapabilityTierV2,
	CodecProbeResult,
	ExportCodecSupport,
	FeatureSupport
} from '../protocol';

type VideoCodecProbeName = 'h264' | 'vp9' | 'av1';
type AudioCodecProbeName = 'aac' | 'opus';

interface CodecProbeConfig {
	codec: string;
	width?: number;
	height?: number;
	sampleRate?: number;
	numberOfChannels?: number;
	bitrate?: number;
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
	const codecs = await probeCodecs().catch(() => unknownCodecs);
	const probeWithoutTier: Omit<CapabilityProbeResult, 'tier'> = {
		crossOriginIsolated: globalThis.crossOriginIsolated === true,
		sharedArrayBuffer: hasSharedArrayBuffer(),
		webGPUCore,
		webGPUCompat,
		compatibilityAdapter: webGPUCore !== 'supported' && webGPUCompat === 'supported',
		webCodecsDecode: supportFromBoolean(typeof VideoDecoder !== 'undefined'),
		webCodecsEncode: supportFromBoolean(typeof VideoEncoder !== 'undefined'),
		codecs,
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
		offscreenCanvas: supportFromBoolean(typeof OffscreenCanvas !== 'undefined')
	};
	return {
		...probeWithoutTier,
		tier: deriveCapabilityTierV2(probeWithoutTier)
	};
}
