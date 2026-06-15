import type { ExportSettings } from '../protocol';

export const CACHE_SCHEMA_VERSION = 1;
export const RENDER_CACHE_SCHEMA_VERSION = 1;

export type CacheCategory =
	| 'proxies'
	| 'render-chunks'
	| 'thumbnails'
	| 'filmstrips'
	| 'waveforms'
	| 'metadata';

export interface TimeRange {
	readonly startS: number;
	readonly endS: number;
}

export interface CacheDiagnostic {
	readonly code: string;
	readonly message: string;
	readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export type ProxyAssetStatus = 'queued' | 'generating' | 'ready' | 'stale' | 'failed' | 'deleted';

export interface ProxyGenerationSettings {
	readonly width: number;
	readonly height: number;
	readonly fps: number;
	readonly videoBitrate: number;
	readonly container: 'mp4' | 'webm';
	readonly videoCodec: 'h264' | 'vp9' | 'av1';
	readonly audioCodec: 'aac' | 'opus' | 'none';
}

export interface ProxyAsset {
	readonly proxyId: string;
	readonly sourceId: string;
	readonly sourceFingerprint: string;
	readonly sourceConformanceHash: string;
	readonly settingsHash: string;
	readonly status: ProxyAssetStatus;
	readonly container: 'mp4' | 'webm';
	readonly videoCodec: 'h264' | 'vp9' | 'av1';
	readonly audioCodec: 'aac' | 'opus' | 'none';
	readonly width: number;
	readonly height: number;
	readonly fps: number;
	readonly videoBitrate: number;
	readonly durationS: number;
	readonly byteSize: number;
	readonly cachePath: string;
	readonly createdAt: number;
	readonly lastUsedAt: number;
	readonly diagnostics: readonly CacheDiagnostic[];
}

export interface CategoryUsage {
	readonly proxies: number;
	readonly renderChunks: number;
	readonly thumbnails: number;
	readonly filmstrips: number;
	readonly waveforms: number;
	readonly metadata: number;
}

export interface CacheUsageSnapshot {
	readonly totalBytes: number;
	readonly quotaBytes: number | null;
	readonly freeBytes: number | null;
	readonly categories: CategoryUsage;
	readonly warning: 'ok' | 'near-limit' | 'over-budget' | 'storage-pressure';
}

export interface SourceDependencyKey {
	readonly sourceId: string;
	readonly fingerprint: string;
	readonly conformanceHash: string;
	readonly proxyAssetHash?: string;
}

export interface ClipDependencyKey {
	readonly trackId: string;
	readonly clipId: string;
	readonly sourceId: string;
	readonly startS: number;
	readonly durationS: number;
	readonly inPointS: number;
	readonly effectsHash: string;
	readonly transformHash: string;
	readonly lutHash?: string;
	readonly titleTextureHash?: string;
	readonly keyframeHash?: string;
	readonly audioHash?: string;
	/** Phase 35: SHA-256 hex of canonical remap JSON; absent = identity speed. */
	readonly timeRemapHash?: string;
}

export interface RenderCacheKey {
	readonly schemaVersion: typeof RENDER_CACHE_SCHEMA_VERSION;
	readonly rendererVersion: string;
	readonly mode: 'preview' | 'export';
	readonly sourceMode: 'original' | 'proxy';
	readonly timelineRange: TimeRange;
	readonly frameRate: number;
	readonly outputSize: { readonly width: number; readonly height: number };
	readonly colorPipelineHash: string;
	readonly layerGraphHash: string;
	readonly sourceFingerprints: readonly SourceDependencyKey[];
	readonly clipDependencies: readonly ClipDependencyKey[];
	readonly transitionHashes: readonly string[];
	readonly titleTextureHashes: readonly string[];
	readonly lutHashes: readonly string[];
	readonly keyframeHashes: readonly string[];
	readonly exportSettingsHash?: string;
	readonly previewSettingsHash?: string;
	/** Phase 37: interpolation dependency hash. Set when interpolation is enabled. */
	readonly interpolationHash?: string;
}

export interface RenderCacheOutputDescriptor {
	readonly container: 'mp4' | 'webm' | 'frame-sequence';
	readonly codec: 'h264' | 'vp9' | 'av1' | 'raw-frame';
	readonly width: number;
	readonly height: number;
	readonly fps: number;
	readonly bitrate?: number;
}

export interface RenderCacheDependencySummary {
	readonly sourceIds: readonly string[];
	readonly clipIds: readonly string[];
	readonly trackIds: readonly string[];
	readonly transitionIds: readonly string[];
	readonly titleHashes: readonly string[];
	readonly lutHashes: readonly string[];
	readonly keyframeHashes: readonly string[];
	readonly exportSettings?: ExportSettings;
}

export interface CacheDependencyIndex {
	readonly bySourceId: Readonly<Record<string, readonly string[]>>;
	readonly byClipId: Readonly<Record<string, readonly string[]>>;
	readonly byTrackId: Readonly<Record<string, readonly string[]>>;
	readonly byTransitionId: Readonly<Record<string, readonly string[]>>;
	readonly byTitleHash: Readonly<Record<string, readonly string[]>>;
	readonly byLutHash: Readonly<Record<string, readonly string[]>>;
	readonly byKeyframeHash: Readonly<Record<string, readonly string[]>>;
	/** Phase 35: entries keyed by timeRemapHash. */
	readonly byTimeRemapHash: Readonly<Record<string, readonly string[]>>;
}

export interface RenderCacheEntry {
	readonly entryId: string;
	readonly keyHash: string;
	readonly key: RenderCacheKey;
	readonly timelineRange: TimeRange;
	readonly frameRange: { readonly startFrame: number; readonly frameCount: number };
	readonly output: RenderCacheOutputDescriptor;
	readonly dependencies: RenderCacheDependencySummary;
	readonly chunkPath: string;
	readonly byteSize: number;
	readonly status: 'writing' | 'ready' | 'stale' | 'failed' | 'deleted';
	readonly createdAt: number;
	readonly lastUsedAt: number;
	readonly diagnostics: readonly CacheDiagnostic[];
}

export interface ProxyManifest {
	readonly schemaVersion: typeof CACHE_SCHEMA_VERSION;
	readonly cacheVersion: string;
	readonly projectId: string;
	readonly generatedAt: number;
	readonly assetsBySourceFingerprint: Readonly<Record<string, readonly ProxyAsset[]>>;
	readonly renderEntriesByKeyHash: Readonly<Record<string, readonly RenderCacheEntry[]>>;
	readonly dependencyIndex: CacheDependencyIndex;
	readonly usage: CacheUsageSnapshot;
}

export interface CacheBudget {
	readonly maxBytes: number;
	readonly minFreeBytes: number;
	readonly warnAtBytes: number;
	readonly evictAtBytes: number;
	readonly categorySoftLimits: {
		readonly proxies: number;
		readonly renderChunks: number;
		readonly thumbnails: number;
		readonly filmstrips: number;
		readonly waveforms: number;
		readonly metadata: number;
	};
	readonly protectedRanges: readonly TimeRange[];
	readonly pinnedProxyIds: readonly string[];
}

export const DEFAULT_CACHE_BUDGET: CacheBudget = {
	maxBytes: 8 * 1024 * 1024 * 1024,
	minFreeBytes: 2 * 1024 * 1024 * 1024,
	warnAtBytes: 6 * 1024 * 1024 * 1024,
	evictAtBytes: 7 * 1024 * 1024 * 1024,
	categorySoftLimits: {
		proxies: 4 * 1024 * 1024 * 1024,
		renderChunks: 3 * 1024 * 1024 * 1024,
		thumbnails: 256 * 1024 * 1024,
		filmstrips: 512 * 1024 * 1024,
		waveforms: 128 * 1024 * 1024,
		metadata: 64 * 1024 * 1024
	},
	protectedRanges: [],
	pinnedProxyIds: []
};
