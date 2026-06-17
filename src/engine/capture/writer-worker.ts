/// <reference lib="webworker" />

/**
 * Dedicated writer worker for capture sessions.
 *
 * Owns all `FileSystemSyncAccessHandle` I/O — one handle per track file plus
 * one for `manifest.ndjson`. Receives transferred `ArrayBuffer` chunks from the
 * pipeline worker via a `MessagePort` (set up by the main thread so the two
 * workers can talk directly without main-thread relay).
 *
 * Write ordering per chunk: data write → data flush → manifest append → manifest flush.
 * After flush, sends a `chunk-ack` back to the pipeline worker for backpressure.
 */

interface WriteChunkMessage {
	type: 'write-chunk';
	sessionId: string;
	sourceId: string;
	file: string;
	data: ArrayBuffer;
	record: {
		kind: 'chunk';
		sourceId: string;
		file: string;
		byteOffset: number;
		byteLength: number;
		fromUs: number;
		toUs: number;
		keyFrame: boolean;
		preEncodeDrops: number;
	};
}

interface WriteHeaderMessage {
	type: 'write-header';
	sessionId: string;
	sources: Array<{ sourceId: string; kind: string }>;
	chunkTargetS: number;
}

interface WriteFinalizeMessage {
	type: 'write-finalize';
	sessionId: string;
	reason: string;
}

interface WriteEpochMessage {
	type: 'write-epoch';
	sessionId: string;
	epochUs: number;
}

interface WriteSourceEndedMessage {
	type: 'write-source-ended';
	sessionId: string;
	sourceId: string;
	reason: string;
}

interface WritePauseMessage {
	type: 'write-pause';
	sessionId: string;
	atUs: number;
}

interface WriteResumeMessage {
	type: 'write-resume';
	sessionId: string;
	atUs: number;
}

interface WriteSourceAddedMessage {
	type: 'write-source-added';
	sessionId: string;
	source: Record<string, unknown>;
	atUs: number;
}

interface WriteSourceRegionAppliedMessage {
	type: 'write-source-region-applied';
	sessionId: string;
	sourceId: string;
	mode: 'crop' | 'element';
	atUs: number;
}

interface WriteSceneSwitchMessage {
	type: 'write-scene-switch';
	sessionId: string;
	sceneId: string;
	atUs: number;
}

interface ScanSessionsMessage {
	type: 'scan-sessions';
}

interface DiscardSessionMessage {
	type: 'discard-session';
	sessionId: string;
}

interface WriteEventBatchMessage {
	type: 'write-event-batch';
	sessionId: string;
	/** CaptureEventLogEntry[] — JSON-serialised one per line into events.ndjson. */
	entries: ReadonlyArray<Record<string, unknown>>;
}

type WriterMessage =
	| WriteChunkMessage
	| WriteHeaderMessage
	| WriteFinalizeMessage
	| WriteEpochMessage
	| WriteSourceEndedMessage
	| WritePauseMessage
	| WriteResumeMessage
	| WriteSourceAddedMessage
	| WriteSourceRegionAppliedMessage
	| WriteSceneSwitchMessage
	| WriteEventBatchMessage
	| ScanSessionsMessage
	| DiscardSessionMessage;

interface ChunkAckMessage {
	type: 'chunk-ack';
	sourceId: string;
}

interface ChunkErrorMessage {
	type: 'chunk-error';
	sourceId: string;
	error: string;
}

interface FinalizeAckMessage {
	type: 'finalize-ack';
	sessionId: string;
}

interface RecoveryListMessage {
	type: 'recovery-list';
	sessions: Array<{
		sessionId: string;
		startedAtIso: string;
		sourceCount: number;
		recoveredDurationS: number;
		totalBytes: number;
	}>;
}

type ClientMessage = ChunkAckMessage | ChunkErrorMessage | FinalizeAckMessage | RecoveryListMessage;

interface OpenFile {
	handle: FileSystemSyncAccessHandle;
	file: string;
}

class CaptureWriter {
	private sessions = new Map<string, Map<string, OpenFile>>();
	private manifestHandles = new Map<string, FileSystemSyncAccessHandle>();
	/** Phase 41 own-tab DOM events sidecar; one append-only handle per session. */
	private eventHandles = new Map<string, FileSystemSyncAccessHandle>();
	/** Batches that arrived before `write-header` opened the events handle. The
	 *  writer's per-message handlers are async-concurrent — a `write-event-batch`
	 *  posted just after `capture-dom-tap-init` can land at the writer before its
	 *  preceding `write-header` has finished opening files. Buffer the batch and
	 *  drain on handleWriteHeader to avoid silently dropping early events. */
	private pendingEventBatches = new Map<string, WriteEventBatchMessage[]>();
	private port: MessagePort | null = null;

	init(port: MessagePort): void {
		this.port = port;
		port.onmessage = (event: MessageEvent<WriterMessage>) => {
			void this.handleMessage(event.data);
		};
	}

	private async handleMessage(msg: WriterMessage): Promise<void> {
		try {
			switch (msg.type) {
				case 'write-header':
					await this.handleWriteHeader(msg.sessionId, msg.sources, msg.chunkTargetS);
					break;
				case 'write-chunk':
					await this.handleWriteChunk(msg);
					break;
				case 'write-epoch':
					await this.appendManifest(msg.sessionId, { kind: 'epoch', epochUs: msg.epochUs });
					break;
				case 'write-source-ended':
					await this.appendManifest(msg.sessionId, {
						kind: 'source-ended',
						sourceId: msg.sourceId,
						reason: msg.reason
					});
					break;
				case 'write-pause':
					await this.appendManifest(msg.sessionId, {
						kind: 'pause',
						atUs: msg.atUs
					});
					break;
				case 'write-resume':
					await this.appendManifest(msg.sessionId, {
						kind: 'resume',
						atUs: msg.atUs
					});
					break;
				case 'write-source-added':
					await this.appendManifest(msg.sessionId, {
						kind: 'source-added',
						source: msg.source,
						atUs: msg.atUs
					});
					break;
				case 'write-source-region-applied':
					await this.appendManifest(msg.sessionId, {
						kind: 'source-region-applied',
						sourceId: msg.sourceId,
						mode: msg.mode,
						atUs: msg.atUs
					});
					break;
				case 'write-scene-switch':
					await this.appendManifest(msg.sessionId, {
						kind: 'scene-switch',
						sceneId: msg.sceneId,
						atUs: msg.atUs
					});
					break;
				case 'write-event-batch':
					await this.handleWriteEventBatch(msg);
					break;
				case 'write-finalize':
					await this.handleFinalize(msg.sessionId, msg.reason);
					break;
				case 'scan-sessions':
					await this.handleScanSessions();
					break;
				case 'discard-session':
					await this.handleDiscard(msg.sessionId);
					break;
			}
		} catch (err) {
			const raw = msg as unknown as Record<string, unknown>;
			const srcId = raw.sourceId !== undefined ? String(raw.sourceId) : '';
			this.post({
				type: 'chunk-error',
				sourceId: srcId,
				error: String(err)
			});
		}
	}

	private async getOrCreateCaptureDir(): Promise<FileSystemDirectoryHandle> {
		const root = await navigator.storage.getDirectory();
		return await root.getDirectoryHandle('capture', { create: true });
	}

	private async getOrCreateSessionDir(sessionId: string): Promise<FileSystemDirectoryHandle> {
		const captureDir = await this.getOrCreateCaptureDir();
		return await captureDir.getDirectoryHandle(sessionId, { create: true });
	}

	private async handleWriteHeader(
		sessionId: string,
		sources: Array<{ sourceId: string; kind: string }>,
		chunkTargetS: number
	): Promise<void> {
		const dirHandle = await this.getOrCreateSessionDir(sessionId);

		const fileMap = new Map<string, OpenFile>();
		const openFiles: OpenFile[] = [];
		let manifestAccess: FileSystemSyncAccessHandle | null = null;
		try {
			for (const src of sources) {
				const fileName = `${src.kind === 'screen' || src.kind === 'webcam' ? 'video' : 'audio'}-${src.sourceId}.mp4`;
				const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
				const access = await (fileHandle as FileSystemFileHandle).createSyncAccessHandle();
				const openFile = { handle: access, file: fileName };
				fileMap.set(src.sourceId, openFile);
				openFiles.push(openFile);
			}

			const manifestHandle = await dirHandle.getFileHandle('manifest.ndjson', { create: true });
			manifestAccess = await (manifestHandle as FileSystemFileHandle).createSyncAccessHandle();

			// Phase 41 own-tab DOM events sidecar — opened alongside the manifest so
			// recovery scan can find it without a separate probe. Lifetime mirrors the
			// session: closed in handleFinalize (and best-effort on the error path).
			let eventsAccess: FileSystemSyncAccessHandle | null = null;
			try {
				const eventsHandle = await dirHandle.getFileHandle('events.ndjson', { create: true });
				eventsAccess = await (eventsHandle as FileSystemFileHandle).createSyncAccessHandle();
				this.eventHandles.set(sessionId, eventsAccess);
				// Drain any batches that arrived before the events handle was open.
				const pending = this.pendingEventBatches.get(sessionId);
				if (pending && pending.length > 0) {
					this.pendingEventBatches.delete(sessionId);
					for (const batch of pending) {
						try {
							await this.writeEventBatch(eventsAccess, batch.entries);
						} catch {
							// Sidecar non-fatal — drop the batch and keep going.
						}
					}
				}
			} catch {
				// Events sidecar is non-fatal: track recovery and recording itself must
				// not depend on the events file existing. We just skip it on failure.
				this.pendingEventBatches.delete(sessionId);
			}

			this.sessions.set(sessionId, fileMap);
			this.manifestHandles.set(sessionId, manifestAccess);

			const header =
				JSON.stringify({
					kind: 'header',
					version: 1,
					sessionId,
					startedAtIso: new Date().toISOString(),
					epochUs: null,
					sources: sources.map((s) => ({ sourceId: s.sourceId, kind: s.kind })),
					chunkTargetS
				}) + '\n';

			const encoded = new TextEncoder().encode(header);
			manifestAccess.write(encoded.buffer as ArrayBuffer, { at: manifestAccess.getSize() });
			await manifestAccess.flush();
		} catch (error) {
			for (const openFile of openFiles) {
				try {
					openFile.handle.close();
				} catch {
					// best-effort cleanup on the error path; the original error is rethrown
				}
			}
			if (manifestAccess) {
				try {
					manifestAccess.close();
				} catch {
					// best-effort cleanup on the error path; the original error is rethrown
				}
			}
			const eventsAccess = this.eventHandles.get(sessionId);
			if (eventsAccess) {
				try {
					eventsAccess.close();
				} catch {
					// best-effort cleanup on the error path; the original error is rethrown
				}
				this.eventHandles.delete(sessionId);
			}
			this.pendingEventBatches.delete(sessionId);
			this.sessions.delete(sessionId);
			this.manifestHandles.delete(sessionId);
			throw error;
		}
	}

	private async handleWriteChunk(msg: WriteChunkMessage): Promise<void> {
		const fileMap = this.sessions.get(msg.sessionId);
		const manifestAccess = this.manifestHandles.get(msg.sessionId);
		if (!fileMap || !manifestAccess) {
			throw new Error(`Session ${msg.sessionId} not found`);
		}

		const openFile = fileMap.get(msg.sourceId);
		if (!openFile) {
			throw new Error(`Source ${msg.sourceId} not found in session ${msg.sessionId}`);
		}

		// 1. Write data
		const byteOffset = openFile.handle.getSize();
		openFile.handle.write(msg.data, { at: byteOffset });
		// 2. Flush data
		await openFile.handle.flush();
		// 3. Append manifest record
		const record =
			JSON.stringify({ ...msg.record, byteOffset, byteLength: msg.data.byteLength }) + '\n';
		const encoded = new TextEncoder().encode(record);
		manifestAccess.write(encoded.buffer as ArrayBuffer, { at: manifestAccess.getSize() });
		// 4. Flush manifest
		await manifestAccess.flush();

		// 5. Send ACK back to pipeline worker
		this.post({ type: 'chunk-ack', sourceId: msg.sourceId });
	}

	private async handleWriteEventBatch(msg: WriteEventBatchMessage): Promise<void> {
		// Events sidecar is non-fatal: a missing handle, a write failure, a flush
		// failure must never surface as `chunk-error` (the pipeline worker would
		// treat that as a source failure). Catch everything inside this method and
		// drop the batch silently — the session's media tracks are unaffected.
		try {
			const eventsAccess = this.eventHandles.get(msg.sessionId);
			if (!eventsAccess) {
				// `write-header` may not have completed yet — the writer's handleMessage
				// is async-concurrent. Buffer the batch and let handleWriteHeader flush
				// it once the events handle opens. Sessions that never get a header
				// (header failure path) have their pending batches dropped on
				// handleFinalize / handleDiscard.
				let pending = this.pendingEventBatches.get(msg.sessionId);
				if (!pending) {
					pending = [];
					this.pendingEventBatches.set(msg.sessionId, pending);
				}
				if (msg.entries.length > 0) pending.push(msg);
				return;
			}
			if (msg.entries.length === 0) return;
			await this.writeEventBatch(eventsAccess, msg.entries);
		} catch {
			// Swallow — sidecar failure must not take down the session.
		}
	}

	private async writeEventBatch(
		eventsAccess: FileSystemSyncAccessHandle,
		entries: WriteEventBatchMessage['entries']
	): Promise<void> {
		let payload = '';
		for (const entry of entries) {
			payload += JSON.stringify(entry) + '\n';
		}
		const encoded = new TextEncoder().encode(payload);
		// Pass the Uint8Array directly so byteLength tracks the encoded bytes
		// exactly, not the (possibly larger) underlying ArrayBuffer. SyncAccessHandle
		// accepts any BufferSource, so this is both safer and more idiomatic than
		// reaching for `.buffer`.
		eventsAccess.write(encoded, { at: eventsAccess.getSize() });
		await eventsAccess.flush();
	}

	private async handleFinalize(sessionId: string, reason: string): Promise<void> {
		const manifestAccess = this.manifestHandles.get(sessionId);
		if (manifestAccess) {
			const record =
				JSON.stringify({
					kind: 'finalize',
					endedAtIso: new Date().toISOString(),
					reason
				}) + '\n';
			const encoded = new TextEncoder().encode(record);
			manifestAccess.write(encoded.buffer as ArrayBuffer, { at: manifestAccess.getSize() });
			await manifestAccess.flush();
			manifestAccess.close();
		}

		// Drop any orphaned pending batches (a session may finalize before
		// `write-header` ever opened the events handle).
		this.pendingEventBatches.delete(sessionId);

		const eventsAccess = this.eventHandles.get(sessionId);
		if (eventsAccess) {
			try {
				eventsAccess.close();
			} catch {
				// best-effort close — finalize must release every handle it can
			}
			this.eventHandles.delete(sessionId);
		}

		const fileMap = this.sessions.get(sessionId);
		if (fileMap) {
			for (const [, openFile] of fileMap) {
				try {
					openFile.handle.close();
				} catch {
					// best-effort close — finalize must release every handle it can
				}
			}
		}

		this.sessions.delete(sessionId);
		this.manifestHandles.delete(sessionId);
		// finalize-ack also doubles as the sidecar-ready signal — at this point
		// events.ndjson is flushed + closed alongside the manifest, so a reader
		// can safely consume both. worker.ts forwards `capture-events-sidecar-ready`
		// to main right after `capture-landed`, using the same handshake.
		this.post({ type: 'finalize-ack', sessionId });
	}

	private async handleScanSessions(): Promise<void> {
		try {
			let captureDir: FileSystemDirectoryHandle;
			try {
				captureDir = await this.getOrCreateCaptureDir();
			} catch {
				this.post({ type: 'recovery-list', sessions: [] });
				return;
			}

			const sessions: RecoveryListMessage['sessions'] = [];
			const dirs = captureDir as unknown as AsyncIterable<[string, FileSystemHandle]>;
			for await (const [name, dirHandle] of dirs) {
				if (dirHandle.kind !== 'directory') continue;
				let hasFinalize = false;
				let totalBytes = 0;
				let sourceCount = 0;
				let startedAtIso = '';
				let firstTs: number | null = null;
				let lastTs: number | null = null;
				try {
					const manifestHandle = await (dirHandle as FileSystemDirectoryHandle).getFileHandle(
						'manifest.ndjson'
					);
					const file = await (manifestHandle as FileSystemFileHandle).getFile();
					const text = await file.text();
					const lines = text.trim().split('\n');
					for (const line of lines) {
						try {
							const record = JSON.parse(line);
							if (record.kind === 'finalize') hasFinalize = true;
							if (record.kind === 'chunk') {
								totalBytes += record.byteLength ?? 0;
								if (firstTs === null || record.fromUs < firstTs) firstTs = record.fromUs;
								if (lastTs === null || record.toUs > lastTs) lastTs = record.toUs;
							}
							if (record.kind === 'header') {
								sourceCount = (record.sources ?? []).length;
								startedAtIso = record.startedAtIso ?? '';
							}
						} catch {
							// skip malformed manifest records; recovery uses what parses
						}
					}
				} catch {
					// unreadable manifest — treat the session as having no records
				}

				if (!hasFinalize) {
					const recoveredDurationS =
						firstTs !== null && lastTs !== null ? (lastTs - firstTs) / 1_000_000 : 0;
					sessions.push({
						sessionId: name,
						startedAtIso,
						sourceCount,
						recoveredDurationS,
						totalBytes
					});
				}
			}

			this.post({ type: 'recovery-list', sessions });
		} catch {
			this.post({ type: 'recovery-list', sessions: [] });
		}
	}

	private async handleDiscard(sessionId: string): Promise<void> {
		this.pendingEventBatches.delete(sessionId);
		try {
			const captureDir = await this.getOrCreateCaptureDir();
			await captureDir.removeEntry(sessionId, { recursive: true });
		} catch {
			// discard is best-effort; a missing session needs no cleanup
		}
	}

	private async appendManifest(sessionId: string, record: Record<string, unknown>): Promise<void> {
		const manifestAccess = this.manifestHandles.get(sessionId);
		if (!manifestAccess) return;
		const line = JSON.stringify(record) + '\n';
		const encoded = new TextEncoder().encode(line);
		manifestAccess.write(encoded.buffer as ArrayBuffer, { at: manifestAccess.getSize() });
		manifestAccess.flush();
	}

	private post(msg: ClientMessage): void {
		if (this.port) {
			this.port.postMessage(msg);
		}
	}
}

const writer = new CaptureWriter();

self.addEventListener('message', (event: MessageEvent<{ type: 'init'; port: MessagePort }>) => {
	if (event.data.type === 'init' && event.data.port) {
		writer.init(event.data.port);
	}
});
