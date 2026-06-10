import type { CaptureSource } from '../protocol';

export interface CaptureStreams {
	videoStream: ReadableStream<VideoFrame>;
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

	if (!videoStream) {
		// Clean up if no video
		mediaStream.getTracks().forEach((t) => t.stop());
		throw new Error('No video track available in the captured stream.');
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
