import type { EncodedPacket } from 'mediabunny';
import type {
	CaptureSourceKind,
	CaptureSourceSnapshot,
	CaptureStopReason,
	CaptureSourceStatusSnapshot
} from '../../protocol';
import type { PauseResumePair } from './pause-resume';
import { TrackPipeline, type TrackPipelineCallbacks } from './track-pipeline';

export interface CaptureSessionCallbacks {
	onStatusChange(status: {
		state: 'idle' | 'armed' | 'recording' | 'paused' | 'stopping';
		elapsedUs: number;
		bytesWritten: number;
		remainingSeconds: number | null;
		sources: CaptureSourceStatusSnapshot[];
	}): void;
	onError(sourceId: string | null, code: string, detail: string): void;
	onLanded(sessionId: string, trackIds: string[]): void;
}

interface SourceEntry {
	sourceId: string;
	kind: CaptureSourceKind;
	label: string;
	pipeline: TrackPipeline;
	encoderConfigLabel: string;
	hwAccel: 'prefer-hardware' | 'no-preference';
	state: 'capturing' | 'stopping' | 'ended' | 'error';
	preEncodeDrops: number;
	bytesWritten: number;
	firstSampleUs: number | null;
	lastSampleUs: number | null;
	width?: number;
	height?: number;
	frameRate?: number | null;
	captureMode: 'full' | 'region' | 'element';
	sourceAddedPending: boolean;
}

interface WriterChunkAckMessage {
	type: 'chunk-ack';
	sourceId: string;
}

interface WriterChunkErrorMessage {
	type: 'chunk-error';
	sourceId: string;
	error: string;
}

type WriterPortMessage = WriterChunkAckMessage | WriterChunkErrorMessage;

export class CaptureSession {
	readonly sessionId: string;
	private startedAtIso = '';
	private sources = new Map<string, SourceEntry>();
	private state: 'idle' | 'armed' | 'recording' | 'paused' | 'stopping' = 'idle';
	private startTime = 0;
	private epochUs: number | null = null;
	private totalBytesWritten = 0;
	private lastEncodedFrameTs = 0;
	private pendingResumeRecord = false;
	private pendingPauseAtUs: number | null = null;
	private pauseResumePairs: PauseResumePair[] = [];
	private pausedAt = 0;
	private accumulatedPausedUs = 0;
	private pauseDrain: Promise<void> | null = null;
	private abort = new AbortController();
	private callbacks: CaptureSessionCallbacks;
	private writerPort: MessagePort | null;
	private readonly writerMessageHandler = (event: MessageEvent<WriterPortMessage>) => {
		const message = event.data;
		switch (message.type) {
			case 'chunk-ack':
				this.handleChunkAck(message.sourceId);
				break;
			case 'chunk-error':
				this.handleSourceError(message.sourceId, message.error);
				break;
		}
	};

	constructor(sessionId: string, callbacks: CaptureSessionCallbacks, writerPort?: MessagePort) {
		this.sessionId = sessionId;
		this.callbacks = callbacks;
		this.writerPort = writerPort ?? null;
		if (this.writerPort) {
			this.writerPort.addEventListener('message', this.writerMessageHandler);
		}
	}

	addSource(
		sourceId: string,
		kind: CaptureSourceKind,
		label: string,
		track: MediaStreamTrack,
		videoEncodeConfig?: VideoEncoderConfig,
		audioEncodeConfig?: AudioEncoderConfig,
		sourceInfo: { width?: number; height?: number; frameRate?: number | null } = {}
	): void {
		const pipelineCallbacks: TrackPipelineCallbacks = {
			onEncodedChunk: (srcId, packet, fromUs, toUs, keyFrame, preEncodeDrops) => {
				this.routeChunk(srcId, packet, fromUs, toUs, keyFrame, preEncodeDrops);
			},
			onChunkAck: () => {},
			onEncodeError: (srcId, error) => {
				this.handleSourceError(srcId, error);
			},
			onAudioOverrun: (srcId) => {
				this.handleAudioOverrun(srcId);
			},
			onPipelineEnded: (srcId) => {
				this.handlePipelineEnded(srcId);
			}
		};

		const pipeline = new TrackPipeline({
			sourceId,
			kind,
			track,
			videoEncodeConfig,
			audioEncodeConfig,
			callbacks: pipelineCallbacks,
			abort: this.abort
		});

		const hwAccel =
			videoEncodeConfig?.hardwareAcceleration === 'prefer-hardware'
				? ('prefer-hardware' as const)
				: ('no-preference' as const);

		const sourceAddedPending = this.state === 'recording' || this.state === 'paused';
		const entry: SourceEntry = {
			sourceId,
			kind,
			label,
			pipeline,
			encoderConfigLabel: this.configLabel(kind, videoEncodeConfig, audioEncodeConfig),
			hwAccel,
			state: 'capturing',
			preEncodeDrops: 0,
			bytesWritten: 0,
			firstSampleUs: null,
			lastSampleUs: null,
			width: sourceInfo.width,
			height: sourceInfo.height,
			frameRate: sourceInfo.frameRate,
			captureMode: 'full',
			sourceAddedPending
		};
		this.sources.set(sourceId, entry);
		if (this.state === 'recording') {
			entry.pipeline.start(this.keyframeIntervalUs());
		}
	}

	async start(chunkDurationS: number): Promise<void> {
		const sourceHeaders = [...this.sources.values()].map((entry) => ({
			sourceId: entry.sourceId,
			kind: entry.kind
		}));
		this.state = 'recording';
		this.startedAtIso = new Date().toISOString();
		this.startTime = performance.now();
		if (this.writerPort) {
			this.writerPort.postMessage({
				type: 'write-header',
				sessionId: this.sessionId,
				sources: sourceHeaders,
				chunkTargetS: chunkDurationS
			});
		}

		const keyframeIntervalUs = Math.round(chunkDurationS * 1_000_000);
		this.currentKeyframeIntervalUs = keyframeIntervalUs;
		for (const [, entry] of this.sources) {
			entry.pipeline.start(keyframeIntervalUs);
		}

		this.emitStatus();
	}

	async stop(reason: CaptureStopReason = 'user-stop'): Promise<void> {
		if (this.state !== 'recording' && this.state !== 'paused') return;
		if (this.state === 'paused') {
			this.finishPausedInterval();
		}
		this.state = 'stopping';
		this.emitStatus();
		if (this.pauseDrain) {
			await this.pauseDrain.catch(() => {});
		}

		for (const [, entry] of this.sources) {
			try {
				await entry.pipeline.stop();
			} catch {
				// best-effort stop — keep stopping the remaining sources
			}
		}
		if (this.writerPort) {
			this.writerPort.postMessage({
				type: 'write-finalize',
				sessionId: this.sessionId,
				reason
			});
		}

		this.state = 'idle';
		this.emitStatus();
	}

	/**
	 * Phase 42: Pause capture — suspends MSTP reader loops by pausing
	 * each source pipeline. The pipeline remains alive (not stopped)
	 * so it can be resumed. Writes a pause manifest record.
	 */
	async pause(): Promise<void> {
		if (this.state !== 'recording' || this.pauseDrain) return;
		this.pausedAt = performance.now();
		this.state = 'paused';
		this.emitStatus();
		const pauseDrain = (async () => {
			const pausePromises: Promise<void>[] = [];
			for (const [, entry] of this.sources) {
				if (entry.state === 'capturing') {
					pausePromises.push(entry.pipeline.pause());
				}
			}
			await Promise.all(pausePromises);
			if (this.writerPort) {
				this.writerPort.postMessage({
					type: 'write-pause',
					sessionId: this.sessionId,
					atUs: this.lastEncodedFrameTs
				});
			}
			this.pendingPauseAtUs = this.lastEncodedFrameTs;
		})();
		this.pauseDrain = pauseDrain;
		try {
			await pauseDrain;
		} finally {
			if (this.pauseDrain === pauseDrain) {
				this.pauseDrain = null;
			}
			if (this.state === 'paused') {
				this.emitStatus();
			}
		}
	}

	/**
	 * Phase 42: Resume capture — restarts MSTP reader loops for all
	 * sources that were capturing before the pause. A resume manifest
	 * record will be written when the first new frame is encoded.
	 */
	async resume(): Promise<void> {
		if (this.state !== 'paused') return;
		if (this.pauseDrain) {
			await this.pauseDrain.catch(() => {});
		}
		if (this.state !== 'paused') return;
		this.finishPausedInterval();
		this.pendingResumeRecord = true;
		this.state = 'recording';
		for (const [, entry] of this.sources) {
			if (entry.state === 'capturing' && entry.firstSampleUs !== null) {
				await entry.pipeline.resume();
			} else if (entry.state === 'capturing') {
				entry.pipeline.start(this.keyframeIntervalUs());
			}
		}
		this.emitStatus();
	}

	private routeChunk(
		sourceId: string,
		packet: EncodedPacket,
		fromUs: number,
		toUs: number,
		keyFrame: boolean,
		preEncodeDrops: number
	): void {
		const entry = this.sources.get(sourceId);
		if (!entry) return;

		entry.preEncodeDrops += preEncodeDrops;
		entry.bytesWritten += packet.byteLength;
		this.totalBytesWritten += packet.byteLength;
		this.lastEncodedFrameTs = Math.max(this.lastEncodedFrameTs, toUs);
		entry.lastSampleUs = Math.max(entry.lastSampleUs ?? toUs, toUs);

		// Write the resume manifest record on the first encoded frame after resume.
		if (this.pendingResumeRecord) {
			this.pendingResumeRecord = false;
			if (this.pendingPauseAtUs !== null) {
				this.pauseResumePairs.push({ pauseAtUs: this.pendingPauseAtUs, resumeAtUs: fromUs });
				this.pendingPauseAtUs = null;
			}
			if (this.writerPort) {
				this.writerPort.postMessage({
					type: 'write-resume',
					sessionId: this.sessionId,
					atUs: fromUs
				});
			}
		}

		if (entry.firstSampleUs === null) {
			entry.firstSampleUs = fromUs;
			this.updateEpoch();
		}
		if (entry.sourceAddedPending) {
			entry.sourceAddedPending = false;
			this.writerPort?.postMessage({
				type: 'write-source-added',
				sessionId: this.sessionId,
				source: this.sourceSnapshot(entry),
				atUs: fromUs
			});
		}

		if (this.writerPort) {
			const file = `${entry.kind === 'screen' || entry.kind === 'webcam' ? 'video' : 'audio'}-${sourceId}.mp4`;
			const record = {
				kind: 'chunk' as const,
				sourceId,
				file,
				byteLength: packet.byteLength,
				fromUs,
				toUs,
				keyFrame,
				preEncodeDrops
			};
			this.writerPort.postMessage(
				{
					type: 'write-chunk',
					sessionId: this.sessionId,
					sourceId,
					file,
					data: packet.data.buffer,
					record
				},
				[packet.data.buffer]
			);
		}

		this.emitStatus();
	}

	private handleChunkAck(sourceId: string): void {
		const entry = this.sources.get(sourceId);
		if (!entry) return;
		entry.pipeline.onChunkAck();
	}

	private handleSourceError(sourceId: string, _error: string): void {
		const entry = this.sources.get(sourceId);
		if (entry) {
			entry.state = 'error';
		}
		this.emitStatus();

		const remainingVideo = [...this.sources.values()].filter(
			(s) =>
				(s.kind === 'screen' || s.kind === 'webcam') && s.state !== 'error' && s.state !== 'ended'
		);
		if (remainingVideo.length === 0 && this.state === 'recording') {
			this.stop('error').catch(() => {});
		}
	}

	private handleAudioOverrun(_sourceId: string): void {
		this.stop('audio-overrun').catch(() => {});
	}

	private handlePipelineEnded(sourceId: string): void {
		const entry = this.sources.get(sourceId);
		if (entry) {
			entry.state = 'ended';
			if (this.writerPort) {
				this.writerPort.postMessage({
					type: 'write-source-ended',
					sessionId: this.sessionId,
					sourceId,
					reason: 'pipeline-ended'
				});
			}
		}
		const allEnded = [...this.sources.values()].every(
			(s) => s.state === 'ended' || s.state === 'error'
		);
		if (allEnded && (this.state === 'recording' || this.state === 'paused')) {
			this.stop('user-stop').catch(() => {});
		}
	}

	private updateEpoch(): void {
		const firstSamples = [...this.sources.values()]
			.filter((s) => s.firstSampleUs !== null)
			.map((s) => s.firstSampleUs!);
		if (firstSamples.length === 0) return;
		const epochUs = Math.min(...firstSamples);
		if (epochUs === this.epochUs) return;
		this.epochUs = epochUs;
		// Recovery takes the last epoch record; it can only decrease as late
		// sources report earlier first samples.
		this.writerPort?.postMessage({ type: 'write-epoch', sessionId: this.sessionId, epochUs });
	}

	private configLabel(
		kind: CaptureSourceKind,
		videoConfig?: VideoEncoderConfig,
		audioConfig?: AudioEncoderConfig
	): string {
		if (kind === 'screen' || kind === 'webcam') {
			return videoConfig?.codec ?? 'h264';
		}
		return audioConfig?.codec ?? 'opus';
	}

	private currentKeyframeIntervalUs = 2_000_000;

	private keyframeIntervalUs(): number {
		return this.currentKeyframeIntervalUs;
	}

	applyRegion(sourceId: string, mode: 'crop' | 'element'): void {
		const entry = this.sources.get(sourceId);
		if (!entry) return;
		entry.captureMode = mode === 'crop' ? 'region' : 'element';
		this.writerPort?.postMessage({
			type: 'write-source-region-applied',
			sessionId: this.sessionId,
			sourceId,
			mode,
			atUs: this.lastEncodedFrameTs
		});
	}

	private emitStatus(): void {
		const now = performance.now();
		const rawElapsedUs = Math.round((now - this.startTime) * 1000);
		const currentPausedUs =
			this.state === 'paused' && this.pausedAt > 0 ? Math.round((now - this.pausedAt) * 1000) : 0;
		const elapsedUs = Math.max(0, rawElapsedUs - this.accumulatedPausedUs - currentPausedUs);

		const sourceStatuses: CaptureSourceStatusSnapshot[] = [...this.sources.values()].map((s) => ({
			sourceId: s.sourceId,
			kind: s.kind,
			label: s.label,
			preEncodeDrops: s.preEncodeDrops,
			bytesWritten: s.bytesWritten,
			state: s.state
		}));

		this.callbacks.onStatusChange({
			state: this.state,
			elapsedUs,
			bytesWritten: this.totalBytesWritten,
			remainingSeconds: null,
			sources: sourceStatuses
		});
	}

	private finishPausedInterval(): void {
		if (this.pausedAt > 0) {
			this.accumulatedPausedUs += Math.round((performance.now() - this.pausedAt) * 1000);
			this.pausedAt = 0;
		}
	}

	reset(): void {
		if (this.writerPort) {
			this.writerPort.removeEventListener('message', this.writerMessageHandler);
		}
		this.abort.abort();
		for (const [, entry] of this.sources) {
			entry.pipeline.dispose();
		}
		this.sources.clear();
		this.state = 'idle';
		this.totalBytesWritten = 0;
		this.lastEncodedFrameTs = 0;
		this.pendingResumeRecord = false;
		this.pendingPauseAtUs = null;
		this.pauseResumePairs = [];
		this.pausedAt = 0;
		this.accumulatedPausedUs = 0;
		this.pauseDrain = null;
		this.epochUs = null;
		this.currentKeyframeIntervalUs = 2_000_000;
	}

	getSourceSnapshots(): CaptureSourceSnapshot[] {
		return [...this.sources.values()].map((s) => this.sourceSnapshot(s));
	}

	private sourceSnapshot(source: SourceEntry): CaptureSourceSnapshot {
		return {
			sourceId: source.sourceId,
			kind: source.kind,
			label: source.label,
			encoderConfig: source.encoderConfigLabel,
			hardwareAcceleration: source.hwAccel,
			width: source.width,
			height: source.height,
			frameRate: source.frameRate
		};
	}

	getLandingSources(): Array<{
		sourceId: string;
		kind: CaptureSourceKind;
		label: string;
		firstSampleUs: number;
		lastSampleUs: number;
		bytesWritten: number;
		width?: number;
		height?: number;
		frameRate?: number | null;
		captureMode: 'full' | 'region' | 'element';
	}> {
		return [...this.sources.values()]
			.filter((s) => s.firstSampleUs !== null && s.lastSampleUs !== null)
			.map((s) => ({
				sourceId: s.sourceId,
				kind: s.kind,
				label: s.label,
				firstSampleUs: s.firstSampleUs!,
				lastSampleUs: s.lastSampleUs!,
				bytesWritten: s.bytesWritten,
				width: s.width,
				height: s.height,
				frameRate: s.frameRate,
				captureMode: s.captureMode
			}));
	}

	getPauseResumePairs(): PauseResumePair[] {
		return this.pauseResumePairs.map((pair) => ({ ...pair }));
	}

	get stateValue(): 'idle' | 'armed' | 'recording' | 'paused' | 'stopping' {
		return this.state;
	}
	get byteCount(): number {
		return this.totalBytesWritten;
	}
	get epochValue(): number | null {
		return this.epochUs;
	}
	get startedIso(): string {
		return this.startedAtIso;
	}
}
