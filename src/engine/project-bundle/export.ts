import { serializeCubeLut, type ClipLut } from '../lut';
import type { ProjectDoc, SourceDescriptor } from '../project';
import { throwIfBundleJobCanceled } from './errors';
import { fingerprintBlob } from './fingerprint';
import { serializeProjectDocForBundle } from './serialize-doc';
import { addIntegrityItem, createEmptyIntegrityReport, integrityItem } from './integrity';
import { defaultAppVersion, makeAssetId, makeBundleId, serializeBundleManifest } from './manifest';
import {
	lutRelativePath,
	MANIFEST_PATH,
	mediaRelativePath,
	PROJECT_OTIO_PATH,
	PROJECT_PATH
} from './paths';
import { serializeTimelineToOtio } from '../interchange/otio';
import type { BundleDirectorySink } from './sinks';
import type {
	BundleAsset,
	BundleCacheManifest,
	BundleIntegrityReport,
	BundleJobProgress,
	BundleSourceEntry,
	BundleSourcePolicy,
	MediaFingerprint,
	ProjectBundleManifest
} from './types';

export interface ExportBundleOptions {
	doc: ProjectDoc;
	displayName: string;
	policy: BundleSourcePolicy;
	resolveSourceFile: (sourceId: string) => Promise<File | null>;
	collectLuts: () => readonly ClipLut[];
	renderCoverAsset?: () => Promise<Blob | null>;
	/**
	 * Optional: return the cached beat-analysis JSON text for the source's
	 * fingerprint, or null if none. Phase 34: when present and embedding,
	 * the bundle gains a 'beats' asset per source so a future import can
	 * restore results without re-analysing (R2.3).
	 */
	resolveBeatCache?: (sourceId: string, fingerprint: MediaFingerprint) => Promise<string | null>;
	onProgress?: (progress: BundleJobProgress) => void;
	isCancelled?: () => boolean;
}

function beatCacheRelativePath(fingerprint: MediaFingerprint): string {
	return `cache/beats/${fingerprint.digest.slice(0, 16)}.beats.json`;
}

function coverRelativePath(displayName: string): { relativePath: string; fileName: string } {
	const stem =
		displayName
			.trim()
			.replace(/[^A-Za-z0-9._-]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'project';
	const fileName = `${stem}.cover.jpg`;
	return { relativePath: `cover/${fileName}`, fileName };
}

function shouldEmbedMedia(policy: BundleSourcePolicy): boolean {
	return policy.mode === 'embed-media' || policy.mode === 'collect-media';
}

export async function exportProjectBundle(
	sink: BundleDirectorySink,
	options: ExportBundleOptions
): Promise<{ manifest: ProjectBundleManifest; report: BundleIntegrityReport }> {
	const bundleId = makeBundleId();
	let report = createEmptyIntegrityReport(bundleId);
	const assets: BundleAsset[] = [];
	const sources: BundleSourceEntry[] = [];
	const digestToAsset = new Map<string, BundleAsset>();
	let bytesDone = 0;
	let bytesTotal = 0;

	const progress = (phase: string, delta?: number) => {
		if (delta) bytesDone += delta;
		options.onProgress?.({ phase, bytesDone, bytesTotal: bytesTotal > 0 ? bytesTotal : null });
	};

	let mediaBytesAccumulated = 0;

	const embed = shouldEmbedMedia(options.policy);
	for (const descriptor of options.doc.sources) {
		bytesTotal += descriptor.byteSize;
	}
	for (const lut of options.collectLuts()) {
		bytesTotal += lut.values.byteLength;
	}

	for (const descriptor of options.doc.sources) {
		throwIfBundleJobCanceled(options.isCancelled);
		const entry: BundleSourceEntry = {
			sourceId: descriptor.sourceId,
			descriptor: { ...descriptor },
			status: 'external-reference'
		};

		if (!embed) {
			sources.push(entry);
			report = addIntegrityItem(
				report,
				integrityItem('ok', 'info', `Referenced ${descriptor.fileName} without embedding.`, {
					sourceId: descriptor.sourceId
				})
			);
			continue;
		}

		const file = await options.resolveSourceFile(descriptor.sourceId);
		if (!file) {
			entry.status = 'missing-at-export';
			sources.push(entry);
			report = addIntegrityItem(
				report,
				integrityItem(
					'missing-file',
					'warning',
					`Source ${descriptor.fileName} was offline at export.`,
					{
						sourceId: descriptor.sourceId
					}
				)
			);
			continue;
		}

		progress('fingerprint', 0);
		const fingerprint = await fingerprintBlob(file, {
			onProgress: (n) =>
				options.onProgress?.({ phase: 'fingerprint', bytesDone: n, bytesTotal: file.size })
		});
		const withFingerprint: SourceDescriptor = { ...descriptor, fingerprint };
		entry.descriptor = withFingerprint;

		let asset = digestToAsset.get(fingerprint.digest);
		if (!asset) {
			const relativePath = mediaRelativePath(fingerprint, file.name);
			asset = {
				assetId: makeAssetId(),
				kind: 'media',
				relativePath,
				fingerprint,
				byteSize: file.size,
				mimeType: file.type || descriptor.mimeType,
				originalFileName: file.name,
				refs: [descriptor.sourceId]
			};
			let fileBytesDone = 0;
			await sink.writeBlob(relativePath, file, (n) => {
				const delta = n - fileBytesDone;
				fileBytesDone = n;
				mediaBytesAccumulated += delta;
				options.onProgress?.({
					phase: 'media',
					bytesDone: mediaBytesAccumulated,
					bytesTotal: bytesTotal > 0 ? bytesTotal : null
				});
			});
			digestToAsset.set(fingerprint.digest, asset);
			assets.push(asset);
			report = addIntegrityItem(
				report,
				integrityItem('ok', 'info', `Embedded ${file.name}.`, {
					assetId: asset.assetId,
					sourceId: descriptor.sourceId
				})
			);
		} else {
			asset = { ...asset, refs: [...asset.refs, descriptor.sourceId] };
			digestToAsset.set(fingerprint.digest, asset);
			const index = assets.findIndex((a) => a.assetId === asset!.assetId);
			if (index >= 0) assets[index] = asset;
			report = addIntegrityItem(
				report,
				integrityItem('ok', 'info', `Reused embedded media for ${descriptor.fileName}.`, {
					assetId: asset.assetId,
					sourceId: descriptor.sourceId
				})
			);
		}

		entry.mediaAssetId = asset.assetId;
		entry.status = 'embedded';
		sources.push(entry);
	}

	// Phase 34: embed each source's beat cache (if any) alongside the media so
	// importing a bundle on another machine skips re-analysis. Each beat-cache
	// JSON gets its own BundleAsset; the cacheManifest.beats entry maps the
	// source back to the asset on import.
	const beatsManifest: NonNullable<BundleCacheManifest['beats']> = [];
	if (embed && options.resolveBeatCache) {
		for (const sourceEntry of sources) {
			if (sourceEntry.status !== 'embedded') continue;
			const fingerprint = sourceEntry.descriptor.fingerprint;
			if (!fingerprint) continue;
			throwIfBundleJobCanceled(options.isCancelled);
			let text: string | null = null;
			try {
				text = await options.resolveBeatCache(sourceEntry.sourceId, fingerprint);
			} catch {
				// Missing/unreadable beat cache must not fail the whole export.
				text = null;
			}
			if (!text) continue;
			const blob = new Blob([text], { type: 'application/json' });
			const beatBlobFingerprint = await fingerprintBlob(blob);
			const relativePath = beatCacheRelativePath(beatBlobFingerprint);
			const asset: BundleAsset = {
				assetId: makeAssetId(),
				kind: 'beats',
				relativePath,
				fingerprint: beatBlobFingerprint,
				byteSize: blob.size,
				mimeType: 'application/json',
				originalFileName: `${sourceEntry.descriptor.fileName}.beats.json`,
				refs: [sourceEntry.sourceId]
			};
			await sink.writeBlob(relativePath, blob);
			assets.push(asset);
			beatsManifest.push({ sourceId: sourceEntry.sourceId, assetId: asset.assetId });
		}
	}

	if (embed) {
		const lutByKey = new Map<string, ClipLut>();
		for (const lut of options.collectLuts()) {
			if (!lutByKey.has(lut.key)) lutByKey.set(lut.key, lut);
		}
		for (const lut of lutByKey.values()) {
			throwIfBundleJobCanceled(options.isCancelled);
			const cubeText = serializeCubeLut(lut);
			const blob = new Blob([cubeText], { type: 'text/plain' });
			const fingerprint = await fingerprintBlob(blob);
			let asset = digestToAsset.get(`lut:${fingerprint.digest}`);
			if (!asset) {
				const relativePath = lutRelativePath(fingerprint, lut.fileName);
				asset = {
					assetId: makeAssetId(),
					kind: 'lut',
					relativePath,
					fingerprint,
					byteSize: blob.size,
					mimeType: 'text/plain',
					originalFileName: lut.fileName,
					refs: [lut.key]
				};
				await sink.writeBlob(relativePath, blob);
				digestToAsset.set(`lut:${fingerprint.digest}`, asset);
				assets.push(asset);
			}
		}
	}

	if (options.doc.cover && options.renderCoverAsset) {
		throwIfBundleJobCanceled(options.isCancelled);
		progress('cover');
		try {
			const blob = await options.renderCoverAsset();
			if (blob) {
				const fingerprint = await fingerprintBlob(blob);
				const { relativePath, fileName } = coverRelativePath(options.displayName);
				await sink.writeBlob(relativePath, blob);
				assets.push({
					assetId: makeAssetId(),
					kind: 'cover',
					relativePath,
					fingerprint,
					byteSize: blob.size,
					mimeType: blob.type || 'image/jpeg',
					originalFileName: fileName,
					refs: ['project-cover']
				});
			} else {
				report = addIntegrityItem(
					report,
					integrityItem(
						'cover-export-failed',
						'warning',
						'Cover metadata is saved, but no cover JPEG asset was available to bundle.'
					)
				);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			report = addIntegrityItem(
				report,
				integrityItem('cover-export-failed', 'warning', `Failed to write cover asset: ${message}`)
			);
		}
	}

	throwIfBundleJobCanceled(options.isCancelled);

	const cacheManifest: BundleCacheManifest | undefined =
		beatsManifest.length > 0 ? { beats: beatsManifest } : undefined;

	const manifest: ProjectBundleManifest = {
		bundleSchemaVersion: 1,
		bundleId,
		createdAt: new Date().toISOString(),
		appVersion: defaultAppVersion(),
		projectSchemaVersion: options.doc.schemaVersion,
		projectId: options.doc.projectId,
		displayName: options.displayName,
		policy: options.policy,
		sources,
		assets,
		cacheManifest
	};

	progress('project');
	await sink.writeText(PROJECT_PATH, serializeProjectDocForBundle(options.doc));

	// Derived interchange artifact (Phase 48); project.json stays
	// authoritative and a failure here must not fail the bundle.
	progress('interchange');
	try {
		const mediaPathBySourceId = new Map<string, string>();
		for (const entry of sources) {
			if (!entry.mediaAssetId) continue;
			const asset = assets.find((item) => item.assetId === entry.mediaAssetId);
			if (asset) mediaPathBySourceId.set(entry.sourceId, asset.relativePath);
		}
		const otio = serializeTimelineToOtio(
			// Source entries carry the fingerprints computed during this export.
			{ ...options.doc, sources: sources.map((entry) => entry.descriptor) },
			{
				displayName: options.displayName,
				appVersion: defaultAppVersion(),
				resolveTargetUrl: (sourceId) => mediaPathBySourceId.get(sourceId) ?? null
			}
		);
		await sink.writeText(PROJECT_OTIO_PATH, otio.text);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		report = addIntegrityItem(
			report,
			integrityItem(
				'interchange-export-failed',
				'warning',
				`Failed to write ${PROJECT_OTIO_PATH}: ${message} — project.json is unaffected.`,
				{ relativePath: PROJECT_OTIO_PATH }
			)
		);
	}

	progress('manifest');
	await sink.writeText(MANIFEST_PATH, serializeBundleManifest(manifest));
	return { manifest, report };
}
