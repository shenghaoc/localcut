import type { CaptureConfig, CaptureSessionState, CaptureSource } from '../../protocol';

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

// H.264 High 4.2 covers 1080p60; the worker probes this and the fallbacks in
// CAPTURE_VIDEO_CODEC_FALLBACKS with VideoEncoder.isConfigSupported at the
// captured resolution before configuring.
export function getDefaultCaptureConfig(): CaptureConfig {
	return {
		videoCodec: 'avc1.64002a',
		audioCodec: 'mp4a.40.2',
		videoBitrate: 8_000_000,
		audioBitrate: 128_000,
		width: 1920,
		height: 1080,
		framerate: 30,
		sampleRate: 48000,
		numberOfChannels: 2,
	};
}

/** Tried in order when the preferred codec string is unsupported. */
export const CAPTURE_VIDEO_CODEC_FALLBACKS = ['avc1.64002a', 'avc1.42e02a', 'avc1.42002a'] as const;
