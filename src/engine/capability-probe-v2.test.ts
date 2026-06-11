import { describe, expect, it } from 'vite-plus/test';
import {
	anyAudioDecodeSupported,
	anyAudioEncodeSupported,
	anyVideoDecodeSupported,
	anyVideoEncodeSupported,
	deriveCapabilityTierV2,
	exportConstraintsForProbe
} from './capability-probe-v2';
import { compatAdapterProbeResult, probeResultFor } from './compatibility/capability-fixtures';

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
