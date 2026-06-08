import type { ProjectDoc, SourceDescriptor } from '../project';

/** Independent from `ProjectDoc.schemaVersion` — governs manifest + on-disk layout. */
export const BUNDLE_SCHEMA_VERSION = 1;

export type BundleSourcePolicy =
	| { mode: 'embed-media' }
	| { mode: 'reference-only' }
	| { mode: 'collect-media'; relocate: boolean };

export interface MediaFingerprint {
	algorithm: 'sha-256';
	digest: string;
}

export type BundleAssetKind = 'media' | 'lut' | 'caption' | 'thumbnail' | 'waveform' | 'proxy';

export interface BundleAsset {
	assetId: string;
	kind: BundleAssetKind;
	relativePath: string;
	fingerprint?: MediaFingerprint;
	byteSize: number;
	mimeType?: string | null;
	originalFileName: string;
	refs: readonly string[];
}

export interface BundleSourceEntry {
	sourceId: string;
	descriptor: SourceDescriptor;
	mediaAssetId?: string;
	status: 'embedded' | 'external-reference' | 'missing-at-export';
}

export interface BundleCacheManifest {
	thumbnails?: { assetId: string; key: string }[];
	waveforms?: { sourceId: string; assetId: string; bucketCount: number }[];
	proxies?: { sourceId: string; assetId: string; width: number; height: number }[];
}

export interface ProjectBundleManifest {
	bundleSchemaVersion: typeof BUNDLE_SCHEMA_VERSION;
	bundleId: string;
	createdAt: string;
	appVersion: string;
	projectSchemaVersion: number;
	projectId: string;
	displayName: string;
	policy: BundleSourcePolicy;
	sources: readonly BundleSourceEntry[];
	assets: readonly BundleAsset[];
	cacheManifest?: BundleCacheManifest;
}

export type BundleIntegrityCode =
	| 'ok'
	| 'missing-file'
	| 'size-mismatch'
	| 'fingerprint-mismatch'
	| 'descriptor-mismatch'
	| 'corrupt-json'
	| 'unsupported-bundle-schema'
	| 'unsupported-project-schema'
	| 'unsupported-operation'
	| 'cache-stale';

export interface BundleIntegrityItem {
	code: BundleIntegrityCode;
	severity: 'info' | 'warning' | 'error';
	sourceId?: string;
	assetId?: string;
	relativePath?: string;
	message: string;
	details?: Record<string, string | number | boolean | null>;
}

export interface BundleIntegrityReport {
	bundleId: string;
	ok: boolean;
	items: readonly BundleIntegrityItem[];
	summary: {
		sourcesEmbedded: number;
		sourcesOffline: number;
		assetsVerified: number;
		assetsFailed: number;
		cachesSkipped: number;
	};
}

export interface BundleExportInput {
	doc: ProjectDoc;
	displayName: string;
	policy: BundleSourcePolicy;
	resolveSourceFile: (sourceId: string) => Promise<File | null>;
	collectLuts: () => readonly import('../lut').ClipLut[];
}

export interface BundleImportResult {
	ok: boolean;
	doc?: ProjectDoc;
	report: BundleIntegrityReport;
	reason?: string;
	boundSourceIds: readonly string[];
}

export interface BundleJobProgress {
	phase: string;
	bytesDone: number;
	bytesTotal: number | null;
}
