import { serializeCubeLut, type ClipLut } from '../lut';
import type { ProjectDoc, SourceDescriptor } from '../project';
import { throwIfBundleJobCanceled } from './errors';
import { fingerprintBlob } from './fingerprint';
import { serializeProjectDocForBundle } from './serialize-doc';
import { addIntegrityItem, createEmptyIntegrityReport, integrityItem } from './integrity';
import { defaultAppVersion, makeAssetId, makeBundleId, serializeBundleManifest } from './manifest';
import { lutRelativePath, MANIFEST_PATH, mediaRelativePath, PROJECT_PATH } from './paths';
import type { BundleDirectorySink } from './sinks';
import type {
	BundleAsset,
	BundleIntegrityReport,
	BundleJobProgress,
	BundleSourceEntry,
	BundleSourcePolicy,
	ProjectBundleManifest
} from './types';

export interface ExportBundleOptions {
	doc: ProjectDoc;
	displayName: string;
	policy: BundleSourcePolicy;
	resolveSourceFile: (sourceId: string) => Promise<File | null>;
	collectLuts: () => readonly ClipLut[];
	onProgress?: (progress: BundleJobProgress) => void;
	isCancelled?: () => boolean;
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

	throwIfBundleJobCanceled(options.isCancelled);

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
		assets
	};

	progress('project');
	await sink.writeText(PROJECT_PATH, serializeProjectDocForBundle(options.doc));

	progress('manifest');
	await sink.writeText(MANIFEST_PATH, serializeBundleManifest(manifest));
	return { manifest, report };
}
