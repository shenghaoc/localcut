import type { BundleSourcePolicySnapshot, BundleIntegrityReportSnapshot } from '../../protocol';
import type { ClipLut } from '../lut';
import { loadStoredProject, type StoredSourceRecord } from '../persistence';
import { serializeProject, type ProjectDoc } from '../project';
import { BundleJobCanceledError } from './errors';
import { exportProjectBundle } from './export';
import { importProjectBundle } from './import';
import { createFsDirectorySink } from './sinks';
import type { BundleIntegrityReport, BundleSourcePolicy } from './types';

export interface BundleWorkerContext {
	getProjectId: () => string;
	getDisplayName: () => string;
	getProjectState: () => {
		timeline: ProjectDoc['timeline'];
		captionTracks: ProjectDoc['captionTracks'];
		transitions: ProjectDoc['transitions'];
		markers: ProjectDoc['markers'];
		masterGain: number;
		exportSettings?: ProjectDoc['exportSettings'];
		sources: ProjectDoc['sources'];
		customAnimCaptionPresets?: ProjectDoc['customAnimCaptionPresets'];
	};
	resolveSourceFile: (sourceId: string) => Promise<File | null>;
	collectLuts: () => readonly ClipLut[];
	attachSourceFile: (
		descriptor: import('../project').SourceDescriptor,
		file: File,
		persist: boolean
	) => Promise<{ ok: true } | { ok: false; message: string }>;
	applyImportedDoc: (doc: ProjectDoc, boundSourceIds: readonly string[]) => Promise<void>;
	currentProjectIsEmpty: () => boolean;
	projectHasRestorableContent: (doc: ProjectDoc) => boolean;
	postProgress: (
		jobId: string,
		phase: string,
		bytesDone: number,
		bytesTotal: number | null
	) => void;
	postIntegrity: (jobId: string, report: BundleIntegrityReportSnapshot) => void;
	postImportResult: (jobId: string, ok: boolean, projectId?: string, reason?: string) => void;
	postReplacePrompt: (jobId: string, message: string) => void;
}

interface BundleJobState {
	cancelled: boolean;
}

const jobs = new Map<string, BundleJobState>();
const pendingReplace = new Map<
	string,
	{ resolve: (action: 'replace' | 'cancel') => void; reject: (error: Error) => void }
>();

function toReportSnapshot(report: BundleIntegrityReport): BundleIntegrityReportSnapshot {
	return report;
}

function policyFromSnapshot(policy: BundleSourcePolicySnapshot): BundleSourcePolicy {
	return policy;
}

export function cancelBundleJob(jobId: string): void {
	const job = jobs.get(jobId);
	if (job) job.cancelled = true;
	const pending = pendingReplace.get(jobId);
	if (pending) {
		pending.resolve('cancel');
		pendingReplace.delete(jobId);
	}
}

export function resolveBundleReplaceDecision(jobId: string, action: 'replace' | 'cancel'): void {
	const pending = pendingReplace.get(jobId);
	if (!pending) return;
	pending.resolve(action);
	pendingReplace.delete(jobId);
}

async function needsReplaceConfirmation(ctx: BundleWorkerContext): Promise<boolean> {
	if (!ctx.currentProjectIsEmpty()) return true;
	const loaded = await loadStoredProject();
	if (loaded.ok && loaded.doc && ctx.projectHasRestorableContent(loaded.doc)) return true;
	return false;
}

function waitForReplaceDecision(jobId: string): Promise<'replace' | 'cancel'> {
	return new Promise<'replace' | 'cancel'>((resolve, reject) => {
		pendingReplace.set(jobId, { resolve, reject });
	});
}

export async function runExportProjectBundle(
	ctx: BundleWorkerContext,
	jobId: string,
	policy: BundleSourcePolicySnapshot,
	outputDir: FileSystemDirectoryHandle
): Promise<void> {
	jobs.set(jobId, { cancelled: false });
	const job = jobs.get(jobId)!;
	const sink = createFsDirectorySink(outputDir);
	const state = ctx.getProjectState();
	const doc = serializeProject({
		projectId: ctx.getProjectId(),
		timeline: state.timeline,
		captionTracks: state.captionTracks,
		transitions: state.transitions,
		markers: state.markers,
		sources: state.sources,
		masterGain: state.masterGain,
		exportSettings: state.exportSettings,
		customAnimCaptionPresets: state.customAnimCaptionPresets
	});

	try {
		const { report } = await exportProjectBundle(sink, {
			doc,
			displayName: ctx.getDisplayName(),
			policy: policyFromSnapshot(policy),
			resolveSourceFile: ctx.resolveSourceFile,
			collectLuts: ctx.collectLuts,
			isCancelled: () => job.cancelled,
			onProgress: ({ phase, bytesDone, bytesTotal }) => {
				ctx.postProgress(jobId, phase, bytesDone, bytesTotal);
			}
		});
		ctx.postIntegrity(jobId, toReportSnapshot(report));
		ctx.postImportResult(
			jobId,
			report.ok,
			ctx.getProjectId(),
			report.ok ? 'Project bundle exported.' : 'Export finished with integrity warnings.'
		);
	} catch (error) {
		if (error instanceof BundleJobCanceledError) {
			ctx.postImportResult(jobId, false, undefined, 'Bundle job canceled.');
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		const digestStreamUnavailable = message.includes('DigestStream');
		const userMessage = digestStreamUnavailable
			? 'Large media files require DigestStream for fingerprinting; this browser cannot export embedded bundles with files over 64 KiB.'
			: message;
		ctx.postIntegrity(jobId, {
			bundleId: jobId,
			ok: false,
			items: [
				{
					code: digestStreamUnavailable ? 'unsupported-operation' : 'corrupt-json',
					severity: 'error',
					message: userMessage
				}
			],
			summary: {
				sourcesEmbedded: 0,
				sourcesOffline: 0,
				assetsVerified: 0,
				assetsFailed: 1,
				cachesSkipped: 0
			}
		});
		ctx.postImportResult(jobId, false, undefined, userMessage);
	} finally {
		jobs.delete(jobId);
	}
}

export async function runCollectProjectMedia(
	ctx: BundleWorkerContext,
	jobId: string,
	relocate: boolean,
	outputDir: FileSystemDirectoryHandle
): Promise<void> {
	await runExportProjectBundle(ctx, jobId, { mode: 'collect-media', relocate }, outputDir);
}

export async function runImportProjectBundle(
	ctx: BundleWorkerContext,
	jobId: string,
	bundleDir: FileSystemDirectoryHandle,
	replaceConfirmed?: boolean
): Promise<void> {
	jobs.set(jobId, { cancelled: false });
	const job = jobs.get(jobId)!;
	const sink = createFsDirectorySink(bundleDir);

	try {
		if (!replaceConfirmed && (await needsReplaceConfirmation(ctx))) {
			ctx.postReplacePrompt(jobId, 'Importing will replace the current project. Continue?');
			const decision = await waitForReplaceDecision(jobId);
			if (decision === 'cancel' || job.cancelled) {
				ctx.postImportResult(jobId, false, undefined, 'Import canceled.');
				return;
			}
		}

		const result = await importProjectBundle(sink, {
			isCancelled: () => job.cancelled,
			onProgress: ({ phase, bytesDone, bytesTotal }) => {
				ctx.postProgress(jobId, phase, bytesDone, bytesTotal);
			},
			attachSource: async (descriptor, file) => {
				const attached = await ctx.attachSourceFile(descriptor, file, true);
				return attached.ok ? { ok: true } : { ok: false, message: attached.message };
			}
		});

		ctx.postIntegrity(jobId, toReportSnapshot(result.report));

		if (!result.ok || !result.doc) {
			ctx.postImportResult(jobId, false, undefined, result.reason ?? 'Import failed.');
			return;
		}

		await ctx.applyImportedDoc(result.doc, result.boundSourceIds);
		ctx.postImportResult(jobId, true, result.doc.projectId, 'Imported portable project bundle.');
	} catch (error) {
		if (error instanceof BundleJobCanceledError) {
			ctx.postImportResult(jobId, false, undefined, 'Bundle job canceled.');
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		ctx.postImportResult(jobId, false, undefined, message);
	} finally {
		jobs.delete(jobId);
		pendingReplace.delete(jobId);
	}
}

export function makeStoredSourceResolver(
	loadStored: (sourceId: string) => Promise<StoredSourceRecord | null>,
	fileFromHandle: (handle: FileSystemFileHandle) => Promise<File | null>
): (sourceId: string) => Promise<File | null> {
	return async (sourceId: string) => {
		const stored = await loadStored(sourceId).catch(() => null);
		if (stored?.file) return stored.file;
		if (stored?.fileHandle) return fileFromHandle(stored.fileHandle);
		return null;
	};
}
