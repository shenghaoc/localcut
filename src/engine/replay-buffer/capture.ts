import type { CaptureConfig, CaptureSessionState, CaptureSource } from '../../protocol';
import type { RingBuffer } from './ring-buffer';

export interface CaptureSession {
	state: CaptureSessionState;
	config: CaptureConfig;
}

export function createCaptureSession(
	source: CaptureSource,
	hasVideo: boolean,
	hasAudio: boolean,
	config: CaptureConfig,
): CaptureSession {
	return {
		state: {
			active: true,
			sourceLabel: source === 'display' ? 'Screen Capture' : 'Camera',
			source,
			hasVideo,
			hasAudio,
			resolution: hasVideo ? { width: config.width, height: config.height } : null,
			frameRate: hasVideo ? config.framerate : null,
			elapsedS: 0,
		},
		config,
	};
}

export function getDefaultCaptureConfig(): CaptureConfig {
	return {
		videoCodec: 'avc1.42001f',
		audioCodec: 'mp4a.40.2',
		videoBitrate: 5_000_000,
		audioBitrate: 128_000,
		width: 1920,
		height: 1080,
		framerate: 30,
		sampleRate: 48000,
		numberOfChannels: 2,
	};
}

export interface CaptureState {
	session: CaptureSession | null;
	ringBuffer: RingBuffer;
	captureStartTime: number;
}

export function captureProbeMediaStreamTrackProcessor(): boolean {
	return typeof MediaStreamTrackProcessor !== 'undefined';
}
