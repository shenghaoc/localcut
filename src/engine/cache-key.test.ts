import { describe, expect, it } from 'vite-plus/test';
import {
	buildClipDependencyKey,
	canonicalExportSettingsForCache,
	exportSettingsHash,
	hashString,
	hashStableValue,
	hashTimeRemap,
	interpolationHash,
	proxySettingsHash,
	renderCacheEntryMatchesKey,
	renderCacheKeyHash,
	sourceConformanceHash,
	sourceFingerprintFromDescriptor,
	stableStringify
} from './cache-key';
import { RENDER_CACHE_SCHEMA_VERSION, type RenderCacheKey } from './cache-types';
import type { ExportSettings, SourceDescriptorSnapshot, TimeRemapSnapshot } from '../protocol';

function sourceFixture(patch: Partial<SourceDescriptorSnapshot> = {}): SourceDescriptorSnapshot {
	return {
		sourceId: 'source-1',
		fileName: 'camera-a.mp4',
		kind: 'video',
		byteSize: 500_000_000,
		durationS: 60,
		mimeType: 'video/mp4',
		adapterId: 'mediabunny',
		timing: {
			normalizedStartS: 0,
			durationS: 60,
			video: { trackId: 'v1', firstTimestampS: 0, lastTimestampS: 60, durationS: 60 },
			audio: { trackId: 'a1', firstTimestampS: 0.1, lastTimestampS: 60.1, durationS: 60 },
			avOffsetS: 0.1,
			frameRateMode: 'constant'
		},
		video: {
			width: 3840,
			height: 2160,
			frameRate: 29.97,
			frameRateMode: 'constant',
			rotationDeg: 0,
			trackStartS: 0,
			trackDurationS: 60,
			codec: 'avc1.640028',
			canDecode: true
		},
		audio: {
			channels: 2,
			sampleRate: 48_000,
			trackStartS: 0.1,
			trackDurationS: 60,
			codec: 'mp4a.40.2',
			canDecode: true
		},
		...patch
	};
}

function renderKey(patch: Partial<RenderCacheKey> = {}): RenderCacheKey {
	return {
		schemaVersion: RENDER_CACHE_SCHEMA_VERSION,
		rendererVersion: 'renderer-v1',
		mode: 'preview',
		sourceMode: 'original',
		timelineRange: { startS: 0, endS: 4 },
		frameRate: 30,
		outputSize: { width: 1280, height: 720 },
		colorPipelineHash: 'colour-a',
		layerGraphHash: 'layers-a',
		sourceFingerprints: [
			{ sourceId: 'source-b', fingerprint: 'fingerprint-b', conformanceHash: 'conf-b' },
			{ sourceId: 'source-a', fingerprint: 'fingerprint-a', conformanceHash: 'conf-a' }
		],
		clipDependencies: [
			{
				trackId: 'track-2',
				clipId: 'clip-b',
				sourceId: 'source-b',
				startS: 2,
				durationS: 2,
				inPointS: 0,
				effectsHash: 'effects-b',
				transformHash: 'transform-b'
			},
			{
				trackId: 'track-1',
				clipId: 'clip-a',
				sourceId: 'source-a',
				startS: 0,
				durationS: 4,
				inPointS: 1,
				effectsHash: 'effects-a',
				transformHash: 'transform-a',
				titleTextureHash: 'title-a',
				lutHash: 'lut-a',
				keyframeHash: 'kf-a'
			}
		],
		transitionHashes: ['transition-b', 'transition-a'],
		titleTextureHashes: ['title-a'],
		lutHashes: ['lut-a'],
		keyframeHashes: ['kf-a'],
		...patch
	};
}

describe('stableStringify', () => {
	it('is stable across object insertion order', () => {
		expect(stableStringify({ b: 2, a: 1 })).toBe(stableStringify({ a: 1, b: 2 }));
		expect(hashStableValue('test', { b: 2, a: [3, 1] })).toBe(
			hashStableValue('test', { a: [3, 1], b: 2 })
		);
	});

	it('uses a SHA-256 digest for persisted hash identities', () => {
		expect(hashString('hello')).toBe(
			'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
		);
	});
});

describe('source fingerprinting', () => {
	it('changes on source identity and conformance changes', () => {
		const source = sourceFixture();
		expect(sourceFingerprintFromDescriptor(source)).not.toBe(
			sourceFingerprintFromDescriptor(sourceFixture({ byteSize: source.byteSize + 1 }))
		);
		expect(
			sourceFingerprintFromDescriptor(
				sourceFixture({ fingerprint: { algorithm: 'sha-256', digest: 'a'.repeat(64) } })
			)
		).not.toBe(
			sourceFingerprintFromDescriptor(
				sourceFixture({ fingerprint: { algorithm: 'sha-256', digest: 'b'.repeat(64) } })
			)
		);
		expect(sourceConformanceHash(source)).not.toBe(
			sourceConformanceHash(sourceFixture({ timing: { ...source.timing!, avOffsetS: 0.5 } }))
		);
	});
});

describe('proxySettingsHash', () => {
	it('captures proxy encode settings', () => {
		const settings = {
			width: 1280,
			height: 720,
			fps: 30,
			videoBitrate: 4_000_000,
			container: 'mp4' as const,
			videoCodec: 'h264' as const,
			audioCodec: 'aac' as const
		};
		expect(proxySettingsHash(settings)).not.toBe(proxySettingsHash({ ...settings, width: 960 }));
	});
});

describe('exportSettingsHash', () => {
	function exportSettings(patch: Partial<ExportSettings> = {}): ExportSettings {
		return {
			preset: 'quality',
			codec: 'h264',
			container: 'mp4',
			width: 1920,
			height: 1080,
			fps: 30,
			videoBitrate: 8_000_000,
			...patch
		};
	}

	it('treats implicit and explicit original source mode as the same cache input', () => {
		const implicitOriginal = exportSettings();
		const explicitOriginal = exportSettings({ sourceMode: 'original' });

		expect(canonicalExportSettingsForCache(explicitOriginal)).not.toHaveProperty('sourceMode');
		expect(exportSettingsHash(implicitOriginal)).toBe(exportSettingsHash(explicitOriginal));
		expect(exportSettingsHash(implicitOriginal)).not.toBe(
			exportSettingsHash(exportSettings({ sourceMode: 'proxy' }))
		);
	});
});

describe('renderCacheKeyHash', () => {
	it('sorts unordered dependencies before hashing', () => {
		const a = renderKey();
		const b = renderKey({
			sourceFingerprints: [...a.sourceFingerprints].reverse(),
			clipDependencies: [...a.clipDependencies].reverse(),
			transitionHashes: [...a.transitionHashes].reverse()
		});
		expect(renderCacheKeyHash(a)).toBe(renderCacheKeyHash(b));
	});

	it('changes when render dependencies change', () => {
		const key = renderKey();
		expect(renderCacheKeyHash(key)).not.toBe(
			renderCacheKeyHash(renderKey({ sourceMode: 'proxy' }))
		);
		expect(renderCacheKeyHash(key)).not.toBe(
			renderCacheKeyHash(renderKey({ outputSize: { width: 1920, height: 1080 } }))
		);
		expect(renderCacheKeyHash(key)).not.toBe(
			renderCacheKeyHash(renderKey({ titleTextureHashes: ['title-b'] }))
		);
		expect(renderCacheKeyHash(key)).not.toBe(
			renderCacheKeyHash(renderKey({ lutHashes: ['lut-b'] }))
		);
		expect(renderCacheKeyHash(key)).not.toBe(
			renderCacheKeyHash(renderKey({ keyframeHashes: ['kf-b'] }))
		);
		expect(renderCacheKeyHash(key)).not.toBe(
			renderCacheKeyHash(renderKey({ rendererVersion: 'renderer-v2' }))
		);
	});

	it('uses the full canonical key as the render-cache correctness gate', () => {
		const requestedKey = renderKey();
		const differentKey = renderKey({ rendererVersion: 'renderer-v2' });

		expect(
			renderCacheEntryMatchesKey(
				{
					keyHash: renderCacheKeyHash(requestedKey),
					key: differentKey
				},
				requestedKey
			)
		).toBe(false);
	});
});

describe('time remap cache integration', () => {
	function remap(patch: Partial<TimeRemapSnapshot> = {}): TimeRemapSnapshot {
		return {
			keyframes: [
				{ outTimeS: 0, speed: 1, easing: 'linear' as const },
				{ outTimeS: 2, speed: 2, easing: 'ease' as const }
			],
			pitchPreserve: true,
			sourceDurationS: 4,
			...patch
		};
	}

	it('hashTimeRemap is order-independent on keyframes', () => {
		const a = remap();
		const b = remap({ keyframes: [...a.keyframes].reverse() });
		expect(hashTimeRemap(a)).toBe(hashTimeRemap(b));
	});

	it('hashTimeRemap changes when curve content changes', () => {
		expect(hashTimeRemap(remap())).not.toBe(hashTimeRemap(remap({ pitchPreserve: false })));
		expect(hashTimeRemap(remap())).not.toBe(
			hashTimeRemap(
				remap({
					keyframes: [
						{ outTimeS: 0, speed: 1, easing: 'linear' as const },
						{ outTimeS: 2, speed: 3, easing: 'ease' as const }
					]
				})
			)
		);
	});

	it('buildClipDependencyKey populates timeRemapHash when remap is supplied', () => {
		const base = {
			trackId: 'track-1',
			clipId: 'clip-1',
			sourceId: 'source-1',
			startS: 0,
			durationS: 4,
			inPointS: 0,
			effectsHash: 'effects-a',
			transformHash: 'transform-a'
		};
		const noRemap = buildClipDependencyKey(base);
		const withRemap = buildClipDependencyKey({ ...base, timeRemap: remap() });

		expect(noRemap.timeRemapHash).toBeUndefined();
		expect(withRemap.timeRemapHash).toBe(hashTimeRemap(remap()));
	});

	it('renderCacheKeyHash changes when clipDependencies gain a timeRemapHash', () => {
		const baseDep = buildClipDependencyKey({
			trackId: 'track-1',
			clipId: 'clip-1',
			sourceId: 'source-1',
			startS: 0,
			durationS: 4,
			inPointS: 0,
			effectsHash: 'effects-a',
			transformHash: 'transform-a'
		});
		const remappedDep = buildClipDependencyKey({
			trackId: 'track-1',
			clipId: 'clip-1',
			sourceId: 'source-1',
			startS: 0,
			durationS: 4,
			inPointS: 0,
			effectsHash: 'effects-a',
			transformHash: 'transform-a',
			timeRemap: remap()
		});

		const keyA = renderKey({ clipDependencies: [baseDep] });
		const keyB = renderKey({ clipDependencies: [remappedDep] });
		expect(renderCacheKeyHash(keyA)).not.toBe(renderCacheKeyHash(keyB));
	});
});

describe('interpolationHash', () => {
	it('returns undefined when mode is off', () => {
		expect(
			interpolationHash({
				mode: 'off',
				factorCap: 4,
				modelId: 'film-v1',
				modelVersion: '1.0.0',
				tilingProfileHash: 'abc',
				motionBlur: false
			})
		).toBeUndefined();
	});

	it('returns a hash when mode is slowmo', () => {
		const hash = interpolationHash({
			mode: 'slowmo',
			factorCap: 4,
			rampHash: 'ramp-abc',
			modelId: 'film-v1',
			modelVersion: '1.0.0',
			tilingProfileHash: 'abc',
			motionBlur: false
		});
		expect(typeof hash).toBe('string');
		expect(hash!.length).toBeGreaterThan(0);
	});

	it('returns a hash when mode is fps-upconvert', () => {
		const hash = interpolationHash({
			mode: 'fps-upconvert',
			factorCap: 4,
			targetFps: 60,
			modelId: 'film-v1',
			modelVersion: '1.0.0',
			tilingProfileHash: 'abc',
			motionBlur: false
		});
		expect(typeof hash).toBe('string');
	});

	it('changes when mode changes', () => {
		const base = {
			factorCap: 4,
			modelId: 'film-v1',
			modelVersion: '1.0.0',
			tilingProfileHash: 'abc',
			motionBlur: false
		};
		const hash1 = interpolationHash({ ...base, mode: 'slowmo' });
		const hash2 = interpolationHash({ ...base, mode: 'fps-upconvert' });
		expect(hash1).not.toBe(hash2);
	});

	it('changes when model changes', () => {
		const base = {
			mode: 'slowmo' as const,
			factorCap: 4,
			modelVersion: '1.0.0',
			tilingProfileHash: 'abc',
			motionBlur: false
		};
		const hash1 = interpolationHash({ ...base, modelId: 'film-v1' });
		const hash2 = interpolationHash({ ...base, modelId: 'film-v2' });
		expect(hash1).not.toBe(hash2);
	});

	it('changes when motion blur toggles', () => {
		const base = {
			mode: 'slowmo' as const,
			factorCap: 4,
			modelId: 'film-v1',
			modelVersion: '1.0.0',
			tilingProfileHash: 'abc'
		};
		const hash1 = interpolationHash({ ...base, motionBlur: false });
		const hash2 = interpolationHash({ ...base, motionBlur: true });
		expect(hash1).not.toBe(hash2);
	});

	it('interpolationHash in RenderCacheKey changes key hash', () => {
		const key1 = renderKey({ interpolationHash: undefined });
		const key2 = renderKey({ interpolationHash: 'interp-hash-123' });
		expect(renderCacheKeyHash(key1)).not.toBe(renderCacheKeyHash(key2));
	});
});
