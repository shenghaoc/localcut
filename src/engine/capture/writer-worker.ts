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
	byteOffset: number;
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

interface ScanSessionsMessage {
	type: 'scan-sessions';
}

interface DiscardSessionMessage {
	type: 'discard-session';
	sessionId: string;
}

type WriterMessage = WriteChunkMessage | WriteHeaderMessage | WriteFinalizeMessage | WriteEpochMessage | WriteSourceEndedMessage | ScanSessionsMessage | DiscardSessionMessage;

interface ChunkAckMessage {
	type: 'chunk-ack';
	sourceId: string;
}

interface ChunkErrorMessage {
	type: 'chunk-error';
	sourceId: string;
	error: string;
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

type ClientMessage = ChunkAckMessage | ChunkErrorMessage | RecoveryListMessage;

interface OpenFile {
	handle: FileSystemSyncAccessHandle;
	file: string;
}

class CaptureWriter {
	private sessions = new Map<string, Map<string, OpenFile>>();
	private manifestHandles = new Map<string, FileSystemSyncAccessHandle>();
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

	private async handleWriteHeader(sessionId: string, sources: Array<{ sourceId: string; kind: string }>, chunkTargetS: number): Promise<void> {
		const root = await navigator.storage.getDirectory();
		const sessionDir = `capture/${sessionId}`;
		let dirHandle: FileSystemDirectoryHandle;
		try {
			dirHandle = await root.getDirectoryHandle(sessionDir);
		} catch {
			dirHandle = await root.getDirectoryHandle(sessionDir, { create: true });
		}

		const fileMap = new Map<string, OpenFile>();
		for (const src of sources) {
			const fileName = `${src.kind === 'screen' || src.kind === 'webcam' ? 'video' : 'audio'}-${src.sourceId}.mp4`;
			const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
			const access = await (fileHandle as FileSystemFileHandle).createSyncAccessHandle();
			fileMap.set(src.sourceId, { handle: access, file: fileName });
		}

		const manifestHandle = await dirHandle.getFileHandle('manifest.ndjson', { create: true });
		const manifestAccess = await (manifestHandle as FileSystemFileHandle).createSyncAccessHandle();

		this.sessions.set(sessionId, fileMap);
		this.manifestHandles.set(sessionId, manifestAccess);

		const header = JSON.stringify({
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
		manifestAccess.flush();
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
		openFile.handle.write(msg.data, { at: msg.byteOffset });
		// 2. Flush data
		openFile.handle.flush();
		// 3. Append manifest record
		const record = JSON.stringify(msg.record) + '\n';
		const encoded = new TextEncoder().encode(record);
		manifestAccess.write(encoded.buffer as ArrayBuffer, { at: manifestAccess.getSize() });
		// 4. Flush manifest
		manifestAccess.flush();

		// 5. Send ACK back to pipeline worker
		this.post({ type: 'chunk-ack', sourceId: msg.sourceId });
	}

	private async handleFinalize(sessionId: string, reason: string): Promise<void> {
		const manifestAccess = this.manifestHandles.get(sessionId);
		if (manifestAccess) {
			const record = JSON.stringify({
				kind: 'finalize',
				endedAtIso: new Date().toISOString(),
				reason
			}) + '\n';
			const encoded = new TextEncoder().encode(record);
			manifestAccess.write(encoded.buffer as ArrayBuffer, { at: manifestAccess.getSize() });
			manifestAccess.flush();
			manifestAccess.close();
		}

		const fileMap = this.sessions.get(sessionId);
		if (fileMap) {
			for (const [, openFile] of fileMap) {
				try { openFile.handle.close(); } catch {}
			}
		}

		this.sessions.delete(sessionId);
		this.manifestHandles.delete(sessionId);
	}

	private async handleScanSessions(): Promise<void> {
		try {
			const root = await navigator.storage.getDirectory();
			let captureDir: FileSystemDirectoryHandle;
			try {
				captureDir = await root.getDirectoryHandle('capture');
			} catch {
				this.post({ type: 'recovery-list', sessions: [] });
				return;
			}

			const sessions: RecoveryListMessage['sessions'] = [];
			const dirs = captureDir as unknown as AsyncIterable<[string, FileSystemDirectoryHandle]>;
			for await (const [name, dirHandle] of dirs) {
				let hasFinalize = false;
				let totalBytes = 0;
				let sourceCount = 0;
				let startedAtIso = '';
				let firstTs: number | null = null;
				let lastTs: number | null = null;
				try {
					const manifestHandle = await dirHandle.getFileHandle('manifest.ndjson');
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
						} catch {}
					}
				} catch {}

				if (!hasFinalize) {
					const recoveredDurationS = (firstTs !== null && lastTs !== null)
						? (lastTs - firstTs) / 1_000_000
						: 0;
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
		try {
			const root = await navigator.storage.getDirectory();
			await root.removeEntry(`capture/${sessionId}`, { recursive: true });
		} catch {}
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
