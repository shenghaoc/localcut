import { PROJECT_SCHEMA_VERSION, parseSourceDescriptor, type SourceDescriptor } from '../project';
import {
	BUNDLE_SCHEMA_VERSION,
	type BundleAsset,
	type BundleCacheManifest,
	type BundleSourceEntry,
	type BundleSourcePolicy,
	type MediaFingerprint,
	type ProjectBundleManifest
} from './types';
import { generateId } from '../../utils/uuid';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function finiteNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseFingerprint(value: unknown): MediaFingerprint | null {
	if (!isRecord(value)) return null;
	if (value.algorithm !== 'sha-256') return null;
	const digest = requiredString(value.digest);
	if (!digest || !/^[a-f0-9]{64}$/.test(digest)) return null;
	return { algorithm: 'sha-256', digest };
}

function parsePolicy(value: unknown): BundleSourcePolicy | null {
	if (!isRecord(value)) return null;
	if (value.mode === 'embed-media') return { mode: 'embed-media' };
	if (value.mode === 'reference-only') return { mode: 'reference-only' };
	if (value.mode === 'collect-media') {
		return { mode: 'collect-media', relocate: value.relocate === true };
	}
	return null;
}

function parseDescriptor(value: unknown): SourceDescriptor | null {
	return parseSourceDescriptor(value);
}

function parseSourceEntry(value: unknown): BundleSourceEntry | null {
	if (!isRecord(value)) return null;
	const sourceId = requiredString(value.sourceId);
	const descriptor = parseDescriptor(value.descriptor);
	const status =
		value.status === 'embedded' ||
		value.status === 'external-reference' ||
		value.status === 'missing-at-export'
			? value.status
			: null;
	if (!sourceId || !descriptor || !status) return null;
	const mediaAssetId =
		value.mediaAssetId === undefined
			? undefined
			: (requiredString(value.mediaAssetId) ?? undefined);
	return { sourceId, descriptor, mediaAssetId, status };
}

function parseAsset(value: unknown): BundleAsset | null {
	if (!isRecord(value)) return null;
	const assetId = requiredString(value.assetId);
	const kind =
		value.kind === 'media' ||
		value.kind === 'lut' ||
		value.kind === 'caption' ||
		value.kind === 'thumbnail' ||
		value.kind === 'waveform' ||
		value.kind === 'proxy' ||
		value.kind === 'beats'
			? value.kind
			: null;
	const relativePath = requiredString(value.relativePath);
	const byteSize = finiteNumber(value.byteSize);
	const originalFileName = requiredString(value.originalFileName);
	if (
		!assetId ||
		!kind ||
		!relativePath ||
		byteSize === null ||
		!originalFileName ||
		byteSize < 0
	) {
		return null;
	}
	if (!Array.isArray(value.refs) || !value.refs.every((ref) => typeof ref === 'string'))
		return null;
	const fingerprint =
		value.fingerprint === undefined
			? undefined
			: (parseFingerprint(value.fingerprint) ?? undefined);
	const mimeType =
		value.mimeType === undefined || value.mimeType === null || typeof value.mimeType === 'string'
			? value.mimeType
			: undefined;
	return {
		assetId,
		kind,
		relativePath,
		fingerprint,
		byteSize,
		mimeType,
		originalFileName,
		refs: value.refs
	};
}

function parseCacheManifest(value: unknown): BundleCacheManifest | undefined {
	if (!isRecord(value)) return undefined;
	const manifest: BundleCacheManifest = {};
	if (Array.isArray(value.thumbnails)) {
		const thumbnails: BundleCacheManifest['thumbnails'] = [];
		for (const entry of value.thumbnails) {
			if (!isRecord(entry)) return undefined;
			const assetId = requiredString(entry.assetId);
			const key = requiredString(entry.key);
			if (!assetId || !key) return undefined;
			thumbnails.push({ assetId, key });
		}
		manifest.thumbnails = thumbnails;
	}
	if (Array.isArray(value.waveforms)) {
		const waveforms: NonNullable<BundleCacheManifest['waveforms']> = [];
		for (const entry of value.waveforms) {
			if (!isRecord(entry)) return undefined;
			const assetId = requiredString(entry.assetId);
			const sourceId = requiredString(entry.sourceId);
			const bucketCount = finiteNumber(entry.bucketCount);
			if (!assetId || !sourceId || bucketCount === null) return undefined;
			waveforms.push({ assetId, sourceId, bucketCount });
		}
		manifest.waveforms = waveforms;
	}
	if (Array.isArray(value.proxies)) {
		const proxies: NonNullable<BundleCacheManifest['proxies']> = [];
		for (const entry of value.proxies) {
			if (!isRecord(entry)) return undefined;
			const assetId = requiredString(entry.assetId);
			const sourceId = requiredString(entry.sourceId);
			const width = finiteNumber(entry.width);
			const height = finiteNumber(entry.height);
			if (!assetId || !sourceId || width === null || height === null) return undefined;
			proxies.push({ assetId, sourceId, width, height });
		}
		manifest.proxies = proxies;
	}
	if (Array.isArray(value.beats)) {
		const beats: NonNullable<BundleCacheManifest['beats']> = [];
		for (const entry of value.beats) {
			if (!isRecord(entry)) return undefined;
			const assetId = requiredString(entry.assetId);
			const sourceId = requiredString(entry.sourceId);
			if (!assetId || !sourceId) return undefined;
			beats.push({ assetId, sourceId });
		}
		manifest.beats = beats;
	}
	return manifest;
}

export type ParseManifestResult =
	| { ok: true; manifest: ProjectBundleManifest }
	| { ok: false; reason: string };

function parseManifestV1(value: Record<string, unknown>): ParseManifestResult {
	const bundleId = requiredString(value.bundleId);
	const createdAt = requiredString(value.createdAt);
	const appVersion = requiredString(value.appVersion);
	const projectId = requiredString(value.projectId);
	const displayName = requiredString(value.displayName);
	const projectSchemaVersion = finiteNumber(value.projectSchemaVersion);
	const policy = parsePolicy(value.policy);
	if (
		!bundleId ||
		!createdAt ||
		!appVersion ||
		!projectId ||
		!displayName ||
		projectSchemaVersion === null ||
		!policy
	) {
		return { ok: false, reason: 'Bundle manifest is missing required fields.' };
	}
	if (!Array.isArray(value.sources) || !Array.isArray(value.assets)) {
		return { ok: false, reason: 'Bundle manifest sources/assets are invalid.' };
	}

	const sources: BundleSourceEntry[] = [];
	for (const entry of value.sources) {
		const parsed = parseSourceEntry(entry);
		if (!parsed) return { ok: false, reason: 'Bundle manifest contains an invalid source entry.' };
		sources.push(parsed);
	}

	const assets: BundleAsset[] = [];
	for (const entry of value.assets) {
		const parsed = parseAsset(entry);
		if (!parsed) return { ok: false, reason: 'Bundle manifest contains an invalid asset entry.' };
		assets.push(parsed);
	}

	const cacheManifest =
		value.cacheManifest === undefined ? undefined : parseCacheManifest(value.cacheManifest);
	if (value.cacheManifest !== undefined && !cacheManifest) {
		return { ok: false, reason: 'Bundle cache manifest is invalid.' };
	}

	return {
		ok: true,
		manifest: {
			bundleSchemaVersion: BUNDLE_SCHEMA_VERSION,
			bundleId,
			createdAt,
			appVersion,
			projectSchemaVersion,
			projectId,
			displayName,
			policy,
			sources,
			assets,
			cacheManifest
		}
	};
}

export function migrateBundle(
	manifest: ProjectBundleManifest,
	from: number,
	to: number
): ProjectBundleManifest {
	if (from !== to) {
		throw new Error(`No bundle migration from v${from} to v${to}.`);
	}
	return manifest;
}

export function parseBundleManifest(value: unknown): ParseManifestResult {
	if (!isRecord(value)) return { ok: false, reason: 'Bundle manifest is not an object.' };
	const bundleSchemaVersion = finiteNumber(value.bundleSchemaVersion);
	if (bundleSchemaVersion === null) {
		return { ok: false, reason: 'Bundle manifest is missing bundleSchemaVersion.' };
	}
	if (bundleSchemaVersion > BUNDLE_SCHEMA_VERSION) {
		return { ok: false, reason: `Unsupported bundle schemaVersion ${bundleSchemaVersion}.` };
	}
	if (bundleSchemaVersion < 1) {
		return { ok: false, reason: `Unsupported bundle schemaVersion ${bundleSchemaVersion}.` };
	}

	let manifest: ProjectBundleManifest;
	if (bundleSchemaVersion === 1) {
		const parsed = parseManifestV1(value);
		if (!parsed.ok) return parsed;
		manifest = parsed.manifest;
	} else {
		return { ok: false, reason: `Unsupported bundle schemaVersion ${bundleSchemaVersion}.` };
	}

	let version = bundleSchemaVersion;
	while (version < BUNDLE_SCHEMA_VERSION) {
		manifest = migrateBundle(manifest, version, version + 1);
		version += 1;
	}
	return { ok: true, manifest };
}

export function serializeBundleManifest(manifest: ProjectBundleManifest): string {
	return JSON.stringify(manifest, null, 2);
}

export function makeBundleId(): string {
	return `bundle-${generateId()}`;
}

export function makeAssetId(): string {
	return `asset-${generateId()}`;
}

export function defaultAppVersion(): string {
	return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
}

export function assertProjectSchemaSupported(projectSchemaVersion: number): boolean {
	return projectSchemaVersion <= PROJECT_SCHEMA_VERSION;
}
