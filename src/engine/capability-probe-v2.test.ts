import { describe, expect, it } from 'vite-plus/test';
import {
	anyAudioDecodeSupported,
	anyAudioEncodeSupported,
	anyVideoDecodeSupported,
	anyVideoEncodeSupported,
	deriveCapabilityTierV2,
	exportConstraintsForProbe,
	h264ConstrainedBaseline,
	deriveProgramModeSupport,
	probeImageDecoder,
	probeOpfsSyncAccessHandleInWorker,
	probeSmartReframe,
	recordingAvailable,
	selectCaptureMode
} from './capability-probe-v2';
import type { CapabilityProbeResult } from '../protocol';
import { compatAdapterProbeResult, probeResultFor } from './compatibility/capability-fixtures';

describe('probeSmartReframe', () => {
	it('reports saliency supported and face detection gated on the analysis worker', () => {
		const probe = probeSmartReframe();
		// Saliency is pure DSP — always available.
		expect(probe.saliency).toBe('supported');
		// ORT face detection runs in the analysis worker, so it tracks it.
		expect(['supported', 'unsupported']).toContain(probe.analysisWorker);
		expect(probe.faceDetection).toBe(probe.analysisWorker);
	});
});

describe('deriveCapabilityTierV2', () => {
	it('derives all fixture tiers', () => {
		for (const tier of [
			'core-webgpu',
			'compatibility-webgpu',
			'limited-webcodecs',
			'shell-only'
		] as const) {
			const probe = probeResultFor(tier);
			expect(deriveCapabilityTierV2(probe)).toBe(tier);
		}
	});

	it('keeps decode-only browsers in limited-webcodecs instead of shell-only', () => {
		const probe = probeResultFor('limited-webcodecs');
		expect(probe.webCodecsDecode).toBe('supported');
		expect(probe.webCodecsEncode).toBe('unsupported');
		expect(deriveCapabilityTierV2(probe)).toBe('limited-webcodecs');
	});

	it('keeps core-webgpu when AV1 encode is unavailable (encode does not gate the tier)', () => {
		const base = probeResultFor('core-webgpu');
		const probe = { ...base, codecs: { ...base.codecs, av1Encode: 'unsupported' as const } };
		expect(deriveCapabilityTierV2(probe)).toBe('core-webgpu');
		// AV1 simply drops out of the export constraint set; the editor stays accelerated.
		expect(exportConstraintsForProbe({ ...probe, tier: 'core-webgpu' })).toEqual([
			{ codec: 'h264', container: 'mp4' },
			{ codec: 'vp9', container: 'webm' }
		]);
	});

	it('keeps core-webgpu with H.264 encode only (no VP9 / no AV1)', () => {
		const base = probeResultFor('core-webgpu');
		const probe = {
			...base,
			codecs: {
				...base.codecs,
				vp9Encode: 'unsupported' as const,
				av1Encode: 'unsupported' as const
			}
		};
		expect(deriveCapabilityTierV2(probe)).toBe('core-webgpu');
		expect(exportConstraintsForProbe({ ...probe, tier: 'core-webgpu' })).toEqual([
			{ codec: 'h264', container: 'mp4' }
		]);
	});

	it('drops VideoDecoder-present-but-no-codec browsers to shell-only', () => {
		const base = probeResultFor('limited-webcodecs');
		// The VideoDecoder constructor exists, but no import codec is actually decodable.
		const probe = {
			...base,
			webCodecsDecode: 'supported' as const,
			codecs: {
				...base.codecs,
				h264Decode: 'unsupported' as const,
				vp9Decode: 'unsupported' as const,
				av1Decode: 'unsupported' as const
			}
		};
		expect(deriveCapabilityTierV2(probe)).toBe('shell-only');
	});

	it('requires OffscreenCanvas before selecting reduced preview tiers', () => {
		const probe = {
			...probeResultFor('compatibility-webgpu'),
			offscreenCanvas: 'unsupported' as const
		};
		expect(deriveCapabilityTierV2(probe)).toBe('shell-only');
	});

	it('keeps a compat-adapter-only session in compatibility-webgpu', () => {
		const probe = compatAdapterProbeResult();
		expect(probe.webGPUCore).toBe('unsupported');
		expect(probe.webGPUCompat).toBe('supported');
		expect(probe.compatibilityAdapter).toBe(true);
		expect(deriveCapabilityTierV2(probe)).toBe('compatibility-webgpu');
	});
});

describe('exportConstraintsForProbe', () => {
	it('keeps unsupported codec/container pairs out of the picker', () => {
		const probe = probeResultFor('compatibility-webgpu');
		expect(exportConstraintsForProbe(probe)).toEqual([
			{ codec: 'h264', container: 'mp4' },
			{ codec: 'vp9', container: 'webm' }
		]);
	});

	it('offers no export codecs for shell-only', () => {
		const probe = probeResultFor('shell-only');
		expect(exportConstraintsForProbe(probe)).toEqual([]);
	});

	it('includes AV1 only on core-webgpu with av1 encode', () => {
		const probe = probeResultFor('core-webgpu');
		expect(exportConstraintsForProbe(probe)).toEqual([
			{ codec: 'h264', container: 'mp4' },
			{ codec: 'vp9', container: 'webm' },
			{ codec: 'av1', container: 'webm' }
		]);
	});
});

describe('codec support helpers', () => {
	it('treats only confirmed probes as usable', () => {
		const core = probeResultFor('core-webgpu').codecs;
		expect(anyVideoDecodeSupported(core)).toBe(true);
		expect(anyVideoEncodeSupported(core)).toBe(true);
		expect(anyAudioDecodeSupported(core)).toBe(true);
		expect(anyAudioEncodeSupported(core)).toBe(true);

		const shell = probeResultFor('shell-only').codecs;
		expect(anyVideoDecodeSupported(shell)).toBe(false);
		expect(anyVideoEncodeSupported(shell)).toBe(false);
		expect(anyAudioDecodeSupported(shell)).toBe(false);
		expect(anyAudioEncodeSupported(shell)).toBe(false);
	});
});

describe('probeImageDecoder', () => {
	const ORIGINAL = (globalThis as Record<string, unknown>).ImageDecoder;

	function restore(): void {
		if (ORIGINAL === undefined) delete (globalThis as Record<string, unknown>).ImageDecoder;
		else (globalThis as Record<string, unknown>).ImageDecoder = ORIGINAL;
	}

	it("reports 'supported' when globalThis.ImageDecoder is a function", () => {
		(globalThis as Record<string, unknown>).ImageDecoder = function FakeImageDecoder() {};
		try {
			expect(probeImageDecoder()).toBe('supported');
		} finally {
			restore();
		}
	});

	it("reports 'unsupported' when globalThis.ImageDecoder is absent", () => {
		delete (globalThis as Record<string, unknown>).ImageDecoder;
		try {
			expect(probeImageDecoder()).toBe('unsupported');
		} finally {
			restore();
		}
	});
});

describe('h264ConstrainedBaseline', () => {
	it('returns L3.0 for ≤720×576', () => {
		expect(h264ConstrainedBaseline(720, 576)).toBe('avc1.42E01E');
	});

	it('returns L3.1 for 720p (1280×720)', () => {
		expect(h264ConstrainedBaseline(1280, 720)).toBe('avc1.42E01F');
	});

	it('returns L4.0 for 1080p (1920×1080)', () => {
		expect(h264ConstrainedBaseline(1920, 1080)).toBe('avc1.42E028');
	});

	it('returns L4.2 for the 8193–8704 MB band (2048×1088 = 8704 MBs)', () => {
		// Without the L4.2 threshold this would jump straight to L5.0 and could
		// false-negative on an encoder that accepts L4.2 but rejects L5.0.
		expect(h264ConstrainedBaseline(2048, 1088)).toBe('avc1.42E02A');
	});

	it('returns ≥L5.1 for 2160p (3840×2160)', () => {
		expect(h264ConstrainedBaseline(3840, 2160)).toMatch(/^avc1\.42E03[23]$/);
	});

	it('picks L3.1 when L3.0 is rejected at 720p probe resolution', async () => {
		let callCount = 0;
		const fakeEncoder = {
			isConfigSupported(config: { codec: string }) {
				callCount++;
				const supported = config.codec !== 'avc1.42E01E';
				return Promise.resolve({ supported });
			}
		};
		const codec = h264ConstrainedBaseline(1280, 720);
		const result = await fakeEncoder.isConfigSupported({ codec });
		expect(result.supported).toBe(true);
		expect(codec).toBe('avc1.42E01F');
		expect(callCount).toBe(1);
	});
});

describe('probeOpfsSyncAccessHandleInWorker', () => {
	it('returns unsupported when Worker is unavailable', async () => {
		const origWorker = globalThis.Worker;
		// Assign `undefined` rather than `delete` — `delete` throws on a
		// non-configurable global (e.g. `globalThis.Worker` in a browser-mode run),
		// whereas assignment is portable. (Claude review.)
		// @ts-expect-error -- testing absence
		globalThis.Worker = undefined;
		try {
			const result = await probeOpfsSyncAccessHandleInWorker();
			expect(result).toBe('unsupported');
		} finally {
			globalThis.Worker = origWorker;
		}
	});
});

describe('recordingAvailable / selectCaptureMode (main-frames fallback, B5/T5.5)', () => {
	const withCapture = (overrides: Partial<CapabilityProbeResult['capture']>) => {
		const base = probeResultFor('core-webgpu');
		return { ...base, capture: { ...base.capture, ...overrides } };
	};

	it('returns true on a fully capable core-webgpu profile', () => {
		expect(
			recordingAvailable(
				withCapture({
					transferableMediaStreamTrack: 'supported',
					mediaStreamTrackProcessor: 'supported'
				})
			)
		).toBe(true);
	});

	it('returns true when transfer is unsupported but MSTP is supported (main-frames fallback)', () => {
		// The off-main-thread main-frames path needs only MediaStreamTrackProcessor,
		// so recording stays available without Transferable MediaStreamTrack.
		expect(
			recordingAvailable(
				withCapture({
					transferableMediaStreamTrack: 'unsupported',
					mediaStreamTrackProcessor: 'supported'
				})
			)
		).toBe(true);
	});

	it("tolerates transferableMediaStreamTrack 'unknown'", () => {
		expect(
			recordingAvailable(
				withCapture({
					transferableMediaStreamTrack: 'unknown',
					mediaStreamTrackProcessor: 'supported'
				})
			)
		).toBe(true);
	});

	it('returns false when MSTP is unsupported (the universal requirement of both paths)', () => {
		expect(
			recordingAvailable(
				withCapture({
					transferableMediaStreamTrack: 'supported',
					mediaStreamTrackProcessor: 'unsupported'
				})
			)
		).toBe(false);
	});

	it('selects worker-track only when transfer is supported, else main-frames', () => {
		expect(selectCaptureMode(withCapture({ transferableMediaStreamTrack: 'supported' }))).toBe(
			'worker-track'
		);
		expect(selectCaptureMode(withCapture({ transferableMediaStreamTrack: 'unsupported' }))).toBe(
			'main-frames'
		);
		// 'unknown' takes the safe main-frames path — never risks a DataCloneError.
		expect(selectCaptureMode(withCapture({ transferableMediaStreamTrack: 'unknown' }))).toBe(
			'main-frames'
		);
	});

	it('keeps Program Mode gated on transferable tracks (no main-frames path there)', () => {
		// Recording degrades without transfer, but Program Mode still transfers every
		// source track into the worker, so it stays unsupported.
		const noTransfer = withCapture({
			transferableMediaStreamTrack: 'unsupported',
			mediaStreamTrackProcessor: 'supported'
		});
		expect(recordingAvailable(noTransfer)).toBe(true);
		expect(deriveProgramModeSupport(noTransfer)).toBe('unsupported');
		expect(
			deriveProgramModeSupport(withCapture({ transferableMediaStreamTrack: 'supported' }))
		).toBe('supported');
	});
});
