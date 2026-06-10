import type { EncodedPacket } from 'mediabunny';
import type {
	CaptureSourceKind,
	CaptureSourceSnapshot,
	CaptureStopReason,
	CaptureSourceStatusSnapshot
} from '../../protocol';
import { TrackPipeline, type TrackPipelineCallbacks } from './track-pipeline';

export interface CaptureSessionCallbacks {
	onStatusChange(status: {
		state: 'idle' | 'armed' | 'recording' | 'stopping';
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
}

export class CaptureSession {
	readonly sessionId: string;
	private startedAtIso = '';
	private sources = new Map<string, SourceEntry>();
	private state: 'idle' | 'armed' | 'recording' | 'stopping' = 'idle';
	private startTime = 0;
	private epochUs: number | null = null;
	private totalBytesWritten = 0;
	private abort = new AbortController();
	private callbacks: CaptureSessionCallbacks;

	constructor(sessionId: string, callbacks: CaptureSessionCallbacks) {
		this.sessionId = sessionId;
		this.callbacks = callbacks;
	}

	addSource(
		sourceId: string,
		kind: CaptureSourceKind,
		label: string,
		track: MediaStreamTrack,
		videoEncodeConfig?: VideoEncoderConfig,
		audioEncodeConfig?: AudioEncoderConfig
	): void {
		const pipelineCallbacks: TrackPipelineCallbacks = {
			onEncodedChunk: (srcId, packet, fromUs, toUs, keyFrame, preEncodeDrops) => {
				void packet;
				void toUs;
				void keyFrame;
				this.handleEncodedChunk(srcId, packet, fromUs, toUs, keyFrame, preEncodeDrops);
			},
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

		const hwAccel = videoEncodeConfig?.hardwareAcceleration === 'prefer-hardware'
			? 'prefer-hardware' as const
			: 'no-preference' as const;

		this.sources.set(sourceId, {
			sourceId,
			kind,
			label,
			pipeline,
			encoderConfigLabel: this.configLabel(kind, videoEncodeConfig, audioEncodeConfig),
			hwAccel,
			state: 'capturing',
			preEncodeDrops: 0,
			bytesWritten: 0,
			firstSampleUs: null
		});
	}

	async start(chunkDurationS: number): Promise<void> {
		void chunkDurationS; // TBD: Mediabunny fragment duration wiring (T6)
		this.state = 'recording';
		this.startedAtIso = new Date().toISOString();
		this.startTime = performance.now();

		for (const [, entry] of this.sources) {
			entry.pipeline.start();
		}

		this.emitStatus();
	}

	async stop(reason: CaptureStopReason = 'user-stop'): Promise<void> {
		void reason; // TBD: manifest finalize reason (T7)
		if (this.state !== 'recording') return;
		this.state = 'stopping';
		this.emitStatus();

		for (const [, entry] of this.sources) {
			try { await entry.pipeline.stop(); } catch {}
		}

		this.state = 'idle';
		this.emitStatus();
	}

	private handleEncodedChunk(
		sourceId: string,
		_packet: EncodedPacket,
		fromUs: number,
		_toUs: number,
		_keyFrame: boolean,
		preEncodeDrops: number
	): void {
		const entry = this.sources.get(sourceId);
		if (!entry) return;

		entry.preEncodeDrops += preEncodeDrops;

		if (entry.firstSampleUs === null) {
			entry.firstSampleUs = fromUs;
			this.updateEpoch();
		}

		this.emitStatus();
	}

	private handleSourceError(sourceId: string, _error: string): void {
		const entry = this.sources.get(sourceId);
		if (entry) {
			entry.state = 'error';
		}
		this.emitStatus();

		const remainingVideo = [...this.sources.values()].filter(
			(s) => (s.kind === 'screen' || s.kind === 'webcam') && s.state !== 'error' && s.state !== 'ended'
		);
		if (remainingVideo.length === 0 && this.state === 'recording') {
			this.stop('error').catch(() => {});
		}
	}

	private handleAudioOverrun(_sourceId: string): void {
		this.stop('audio-overrun').catch(() => {});
	}

	private handlePipelineEnded(_sourceId: string): void {
		const allEnded = [...this.sources.values()].every((s) => s.state === 'ended' || s.state === 'error');
		if (allEnded && this.state === 'recording') {
			this.stop('user-stop').catch(() => {});
		}
	}

	private updateEpoch(): void {
		const firstSamples = [...this.sources.values()]
			.filter((s) => s.firstSampleUs !== null)
			.map((s) => s.firstSampleUs!);
		if (firstSamples.length > 0) {
			this.epochUs = Math.min(...firstSamples);
		}
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

	private emitStatus(): void {
		const now = performance.now();
		const elapsedUs = Math.round((now - this.startTime) * 1000);

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

	reset(): void {
		this.abort.abort();
		for (const [, entry] of this.sources) {
			entry.pipeline.dispose();
		}
		this.sources.clear();
		this.state = 'idle';
		this.totalBytesWritten = 0;
		this.epochUs = null;
	}

	getSourceSnapshots(): CaptureSourceSnapshot[] {
		return [...this.sources.values()].map((s) => ({
			sourceId: s.sourceId,
			kind: s.kind,
			label: s.label,
			encoderConfig: s.encoderConfigLabel,
			hardwareAcceleration: s.hwAccel
		}));
	}

	get stateValue(): 'idle' | 'armed' | 'recording' | 'stopping' { return this.state; }
	get byteCount(): number { return this.totalBytesWritten; }
	get epochValue(): number | null { return this.epochUs; }
	get startedIso(): string { return this.startedAtIso; }
}
