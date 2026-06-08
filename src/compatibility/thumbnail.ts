import { waitForEvent } from './video-events';

const THUMBNAIL_SEEK_SECONDS = 0.05;

export interface CompatibilityThumbnail {
	url: string;
	width: number;
	height: number;
	revoke: () => void;
}

export interface CompatibilityPreviewResult {
	fileName: string;
	mimeType: string;
	duration: number;
	sourceWidth: number;
	sourceHeight: number;
	thumbnail: CompatibilityThumbnail;
}

function scaleToMaxEdge(width: number, height: number, maxEdge: number) {
	if (width <= 0 || height <= 0) return { width: maxEdge, height: Math.round((maxEdge * 9) / 16) };
	const scale = maxEdge / Math.max(width, height);
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

/**
 * Decode-only reduced-resolution preview for the limited tier.
 * Uses one HTMLVideoElement + Canvas2D (explicit compatibility path, not accelerated preview).
 */
export async function extractCompatibilityPreview(
	file: File,
	maxEdge = 640
): Promise<CompatibilityPreviewResult> {
	const url = URL.createObjectURL(file);
	const video = document.createElement('video');
	video.preload = 'auto';
	video.muted = true;
	video.playsInline = true;
	video.src = url;

	try {
		if (video.readyState < 1) {
			await waitForEvent(video, 'loadedmetadata');
		}

		const duration = Number.isFinite(video.duration) ? video.duration : 0;
		const sourceWidth = video.videoWidth;
		const sourceHeight = video.videoHeight;

		const seekTime = Math.min(THUMBNAIL_SEEK_SECONDS, Math.max(0, duration - 0.001));
		if (seekTime !== video.currentTime) {
			video.currentTime = seekTime;
			await waitForEvent(video, 'seeked');
		}

		const target = scaleToMaxEdge(sourceWidth, sourceHeight, maxEdge);
		const canvas = document.createElement('canvas');
		canvas.width = target.width;
		canvas.height = target.height;
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			throw new Error('Canvas2D is unavailable for compatibility preview.');
		}
		ctx.drawImage(video, 0, 0, target.width, target.height);
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, 'image/jpeg', 0.82)
		);
		if (!blob) {
			throw new Error('Failed to encode compatibility thumbnail.');
		}
		const thumbUrl = URL.createObjectURL(blob);
		return {
			fileName: file.name,
			mimeType: file.type || 'video/mp4',
			duration,
			sourceWidth,
			sourceHeight,
			thumbnail: {
				url: thumbUrl,
				width: target.width,
				height: target.height,
				revoke: () => URL.revokeObjectURL(thumbUrl)
			}
		};
	} finally {
		video.removeAttribute('src');
		video.load();
		URL.revokeObjectURL(url);
	}
}
