const THUMBNAIL_SEEK_SECONDS = 0.05;

export interface CompatibilityThumbnail {
  url: string;
  width: number;
  height: number;
  revoke: () => void;
}

function waitForEvent(target: EventTarget, type: string): Promise<Event> {
  return new Promise((resolve, reject) => {
    const onSuccess = (event: Event) => {
      cleanup();
      resolve(event);
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Failed while waiting for ${type}.`));
    };
    const cleanup = () => {
      target.removeEventListener(type, onSuccess);
      target.removeEventListener('error', onError);
    };
    target.addEventListener(type, onSuccess, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

function scaleToMaxEdge(width: number, height: number, maxEdge: number) {
  if (width <= 0 || height <= 0) return { width: maxEdge, height: Math.round(maxEdge * 9 / 16) };
  const scale = maxEdge / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Decode-only reduced-resolution thumbnail for the limited tier.
 * Uses HTMLVideoElement + Canvas2D (explicit compatibility path, not accelerated preview).
 */
export async function extractCompatibilityThumbnail(
  file: File,
  maxEdge = 640,
): Promise<CompatibilityThumbnail> {
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
    video.currentTime = Math.min(THUMBNAIL_SEEK_SECONDS, Math.max(0, video.duration - 0.001));
    if (video.readyState < 2) {
      await waitForEvent(video, 'seeked');
    }

    const target = scaleToMaxEdge(video.videoWidth, video.videoHeight, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas2D is unavailable for compatibility preview.');
    }
    ctx.drawImage(video, 0, 0, target.width, target.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob) {
      throw new Error('Failed to encode compatibility thumbnail.');
    }
    const thumbUrl = URL.createObjectURL(blob);
    return {
      url: thumbUrl,
      width: target.width,
      height: target.height,
      revoke: () => URL.revokeObjectURL(thumbUrl),
    };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
