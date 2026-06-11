import { describe, expect, it } from 'vite-plus/test';
import {
	canonicalExportSettingsForCache,
	exportSettingsHash,
	hashString,
	hashStableValue,
	proxySettingsHash,
	renderCacheEntryMatchesKey,
	renderCacheKeyHash,
	sourceConformanceHash,
	sourceFingerprintFromDescriptor,
	stableStringify
} from './cache-key';
import { RENDER_CACHE_SCHEMA_VERSION, type RenderCacheKey } from './cache-types';
import type { ExportSettings, SourceDescriptorSnapshot } from '../protocol';

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
