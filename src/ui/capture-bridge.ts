import type { CaptureSource } from '../protocol';

export interface CaptureStreams {
	/** Absent for an audio-only capture (R1.2). */
	videoStream?: ReadableStream<VideoFrame>;
	audioStream?: ReadableStream<AudioData>;
	mediaStream: MediaStream;
	sourceLabel: string;
	hasVideo: boolean;
	hasAudio: boolean;
	videoTrackSettings?: MediaTrackSettings;
}

export function probeMediaStreamTrackProcessor(): boolean {
	return typeof MediaStreamTrackProcessor !== 'undefined';
}

export async function startCapture(source: CaptureSource): Promise<CaptureStreams> {
	if (!probeMediaStreamTrackProcessor()) {
		throw new Error('MediaStreamTrackProcessor is not supported in this browser.');
	}
	if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
		throw new Error('Media capture requires a secure (HTTPS) browsing context.');
	}
	let mediaStream: MediaStream;

	if (source === 'display') {
		mediaStream = await navigator.mediaDevices.getDisplayMedia({
			video: true,
			audio: true,
		});
	} else {
		mediaStream = await navigator.mediaDevices.getUserMedia({
			video: true,
			audio: true,
		});
	}

	const videoTrack = mediaStream.getVideoTracks()[0] ?? null;
	const audioTrack = mediaStream.getAudioTracks()[0] ?? null;

	let videoStream: ReadableStream<VideoFrame> | undefined;
	let audioStream: ReadableStream<AudioData> | undefined;

	if (videoTrack) {
		const processor = new MediaStreamTrackProcessor({ track: videoTrack });
		videoStream = processor.readable;
	}

	if (audioTrack) {
		const processor = new MediaStreamTrackProcessor({ track: audioTrack });
		audioStream = processor.readable as unknown as ReadableStream<AudioData>;
	}

	// R1.2: a missing video or audio track must not block capturing the other;
	// only a stream with no usable tracks at all is an error.
	if (!videoStream && !audioStream) {
		mediaStream.getTracks().forEach((t) => t.stop());
		throw new Error('The captured stream has no video or audio tracks.');
	}

	return {
		videoStream,
		audioStream,
		mediaStream,
		sourceLabel: source === 'display' ? 'Screen Capture' : 'Camera',
		hasVideo: videoTrack !== null,
		hasAudio: audioTrack !== null,
		videoTrackSettings: videoTrack?.getSettings(),
	};
}

export function stopCaptureStreams(stream: MediaStream): void {
	stream.getTracks().forEach((t) => t.stop());
}

export function attachStreamToVideoElement(
	stream: MediaStream,
	element: HTMLVideoElement,
): void {
	element.srcObject = stream;
	element.muted = true;
	element.play().catch(() => {
		// Autoplay may be blocked — user can manually play
	});
}
