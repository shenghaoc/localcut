import { describe, expect, it } from 'vite-plus/test';
import { deriveProgramModeSupport } from './capability-probe-v2';
import type { CapabilityProbeResult, FeatureSupport } from '../protocol';

const supported = 'supported' satisfies FeatureSupport;
const unsupported = 'unsupported' satisfies FeatureSupport;

function baseProbe(overrides: Partial<CapabilityProbeResult> = {}): CapabilityProbeResult {
	return {
		crossOriginIsolated: true,
		sharedArrayBuffer: supported,
		webGPUCore: supported,
		webGPUCompat: unsupported,
		compatibilityAdapter: false,
		webCodecsDecode: supported,
		webCodecsEncode: supported,
		codecs: {
			h264Decode: supported,
			vp9Decode: unsupported,
			av1Decode: unsupported,
			h264Encode: supported,
			vp9Encode: unsupported,
			av1Encode: unsupported,
			aacDecode: supported,
			opusDecode: supported,
			aacEncode: supported,
			opusEncode: supported
		},
		fileSystemAccess: supported,
		opfs: supported,
		audioWorklet: supported,
		offscreenCanvas: supported,
		livePublish: {
			rtcPeerConnection: supported,
			trackGeneratorWorker: supported,
			trackTransfer: supported,
			generateKeyFrame: supported,
			hardwareH264Encode: supported
		},
		capture: {
			mediaStreamTrackProcessor: supported,
			transferableMediaStreamTrack: supported,
			displayCapture: supported,
			displayAudioCapture: supported,
			videoEncodeRealtime: supported,
			audioEncodeOpus: supported,
			audioEncodeAac: supported,
			opfsSyncAccessHandle: supported
		},
		tier: 'core-webgpu',
		...overrides
	};
}

describe('deriveProgramModeSupport', () => {
	it('supports program mode for the accelerated recording-capable tier', () => {
		expect(deriveProgramModeSupport(baseProbe())).toBe('supported');
	});

	it('blocks program mode when capture processing is missing', () => {
		const probe = baseProbe({
			capture: {
				...baseProbe().capture,
				mediaStreamTrackProcessor: unsupported
			}
		});

		expect(deriveProgramModeSupport(probe)).toBe('unsupported');
	});

	it('blocks program mode when realtime video encode is missing', () => {
		const probe = baseProbe({
			capture: {
				...baseProbe().capture,
				videoEncodeRealtime: unsupported
			}
		});

		expect(deriveProgramModeSupport(probe)).toBe('unsupported');
	});

	it('blocks program mode when OPFS sync access is missing', () => {
		const probe = baseProbe({
			capture: {
				...baseProbe().capture,
				opfsSyncAccessHandle: unsupported
			}
		});

		expect(deriveProgramModeSupport(probe)).toBe('unsupported');
	});

	it('blocks program mode outside the core WebGPU tier', () => {
		const probe = baseProbe({
			tier: 'compatibility-webgpu'
		});

		expect(deriveProgramModeSupport(probe)).toBe('unsupported');
	});
});
