import {
	deserializeProject,
	sourceDescriptorMismatchReasons,
	type ProjectDoc,
	type SourceDescriptor
} from '../project';
import { fingerprintBlob, fingerprintsEqual } from './fingerprint';
import { addIntegrityItem, createEmptyIntegrityReport, integrityItem } from './integrity';
import { assertProjectSchemaSupported, parseBundleManifest } from './manifest';
import { MANIFEST_PATH, PROJECT_PATH } from './paths';
import type { BundleDirectorySink } from './sinks';
import type { BundleImportResult, BundleJobProgress, ProjectBundleManifest } from './types';

export interface ImportBundleOptions {
	onProgress?: (progress: BundleJobProgress) => void;
	isCancelled?: () => boolean;
	attachSource: (
		descriptor: SourceDescriptor,
		file: File
	) => Promise<{ ok: true } | { ok: false; message: string }>;
}

async function loadManifestAndProject(
	sink: BundleDirectorySink
): Promise<
	| { ok: true; manifest: ProjectBundleManifest; doc: ProjectDoc }
	| {
			ok: false;
			reason: string;
			code: 'corrupt-json' | 'unsupported-bundle-schema' | 'unsupported-project-schema';
	  }
> {
	const manifestText = await sink.readText(MANIFEST_PATH);
	if (!manifestText) {
		return { ok: false, reason: 'Bundle is missing manifest.json.', code: 'corrupt-json' };
	}

	let manifestJson: unknown;
	try {
		manifestJson = JSON.parse(manifestText);
	} catch {
		return { ok: false, reason: 'Bundle manifest.json is corrupt.', code: 'corrupt-json' };
	}

	const manifestResult = parseBundleManifest(manifestJson);
	if (!manifestResult.ok) {
		const unsupported = manifestResult.reason.includes('Unsupported bundle');
		return {
			ok: false,
			reason: manifestResult.reason,
			code: unsupported ? 'unsupported-bundle-schema' : 'corrupt-json'
		};
	}

	const projectText = await sink.readText(PROJECT_PATH);
	if (!projectText) {
		return { ok: false, reason: 'Bundle is missing project.json.', code: 'corrupt-json' };
	}

	let projectJson: unknown;
	try {
		projectJson = JSON.parse(projectText);
	} catch {
		return { ok: false, reason: 'Bundle project.json is corrupt.', code: 'corrupt-json' };
	}

	const projectResult = deserializeProject(projectJson);
	if (!projectResult.ok) {
		return { ok: false, reason: projectResult.reason, code: 'unsupported-project-schema' };
	}

	if (!assertProjectSchemaSupported(projectResult.doc.schemaVersion)) {
		return {
			ok: false,
			reason: `Unsupported project schemaVersion ${projectResult.doc.schemaVersion}.`,
			code: 'unsupported-project-schema'
		};
	}

	return { ok: true, manifest: manifestResult.manifest, doc: projectResult.doc };
}

export async function importProjectBundle(
	sink: BundleDirectorySink,
	options: ImportBundleOptions
): Promise<BundleImportResult> {
	const loaded = await loadManifestAndProject(sink);
	if (!loaded.ok) {
		const report = addIntegrityItem(
			createEmptyIntegrityReport('unknown'),
			integrityItem(loaded.code, 'error', loaded.reason)
		);
		return { ok: false, report, reason: loaded.reason, boundSourceIds: [] };
	}

	const { manifest, doc } = loaded;
	let report = createEmptyIntegrityReport(manifest.bundleId);
	const boundSourceIds: string[] = [];
	const assetById = new Map(manifest.assets.map((asset) => [asset.assetId, asset]));

	options.onProgress?.({ phase: 'validate', bytesDone: 0, bytesTotal: null });

	for (const entry of manifest.sources) {
		if (options.isCancelled?.()) break;
		const descriptor = entry.descriptor;
		if (entry.status !== 'embedded' || !entry.mediaAssetId) {
			report = addIntegrityItem(
				report,
				integrityItem(
					'missing-file',
					'warning',
					`Source ${descriptor.fileName} is not embedded in this bundle.`,
					{
						sourceId: descriptor.sourceId
					}
				)
			);
			continue;
		}

		const asset = assetById.get(entry.mediaAssetId);
		if (!asset) {
			report = addIntegrityItem(
				report,
				integrityItem('missing-file', 'error', `Missing asset record for ${descriptor.fileName}.`, {
					sourceId: descriptor.sourceId,
					assetId: entry.mediaAssetId
				})
			);
			continue;
		}

		const blob = await sink.readBlob(asset.relativePath);
		if (!blob) {
			report = addIntegrityItem(
				report,
				integrityItem('missing-file', 'error', `Missing media file ${asset.relativePath}.`, {
					sourceId: descriptor.sourceId,
					assetId: asset.assetId,
					relativePath: asset.relativePath
				})
			);
			continue;
		}

		if (blob.size !== asset.byteSize) {
			report = addIntegrityItem(
				report,
				integrityItem('size-mismatch', 'error', `Size mismatch for ${descriptor.fileName}.`, {
					sourceId: descriptor.sourceId,
					assetId: asset.assetId,
					relativePath: asset.relativePath,
					details: { expected: asset.byteSize, actual: blob.size }
				})
			);
			continue;
		}

		if (asset.fingerprint) {
			let actual;
			try {
				actual = await fingerprintBlob(blob);
			} catch (e) {
				report = addIntegrityItem(
					report,
					integrityItem(
						'fingerprint-mismatch',
						'error',
						`Failed to compute fingerprint for ${descriptor.fileName}: ${e instanceof Error ? e.message : String(e)}`,
						{
							sourceId: descriptor.sourceId,
							assetId: asset.assetId,
							relativePath: asset.relativePath
						}
					)
				);
				continue;
			}
			if (!fingerprintsEqual(actual, asset.fingerprint)) {
				report = addIntegrityItem(
					report,
					integrityItem(
						'fingerprint-mismatch',
						'error',
						`Fingerprint mismatch for ${descriptor.fileName}.`,
						{
							sourceId: descriptor.sourceId,
							assetId: asset.assetId,
							relativePath: asset.relativePath
						}
					)
				);
				continue;
			}
		}

		const file = new File([blob], asset.originalFileName, {
			type: asset.mimeType ?? descriptor.mimeType ?? undefined
		});
		const attach = await options.attachSource(descriptor, file);
		if (!attach.ok) {
			report = addIntegrityItem(
				report,
				integrityItem('descriptor-mismatch', 'error', attach.message, {
					sourceId: descriptor.sourceId,
					assetId: asset.assetId
				})
			);
			continue;
		}

		boundSourceIds.push(descriptor.sourceId);
		report = addIntegrityItem(
			report,
			integrityItem('ok', 'info', `Bound ${descriptor.fileName}.`, {
				sourceId: descriptor.sourceId,
				assetId: asset.assetId
			})
		);
	}

	const expectsEmbeddedMedia = manifest.sources.some((entry) => entry.status === 'embedded');
	const ok = !expectsEmbeddedMedia || boundSourceIds.length > 0 || doc.sources.length === 0;
	return {
		ok,
		doc,
		report,
		boundSourceIds,
		reason:
			!ok && expectsEmbeddedMedia && doc.sources.length > 0
				? 'No media could be bound from the bundle.'
				: undefined
	};
}

/** Pre-flight validation without binding media — used for integrity-only passes. */
export async function validateProjectBundle(
	sink: BundleDirectorySink
): Promise<BundleImportResult> {
	const loaded = await loadManifestAndProject(sink);
	if (!loaded.ok) {
		const report = addIntegrityItem(
			createEmptyIntegrityReport('unknown'),
			integrityItem(loaded.code, 'error', loaded.reason)
		);
		return { ok: false, report, reason: loaded.reason, boundSourceIds: [] };
	}
	return importProjectBundle(sink, {
		attachSource: async (descriptor, file) => {
			const reasons = sourceDescriptorMismatchReasons(descriptor, {
				fileName: file.name,
				byteSize: file.size,
				durationS: descriptor.durationS,
				video: descriptor.video,
				audio: descriptor.audio,
				timing: descriptor.timing
			});
			if (reasons.length > 0) {
				return { ok: false, message: `Descriptor mismatch: ${reasons.join(', ')}.` };
			}
			return { ok: true };
		}
	});
}
