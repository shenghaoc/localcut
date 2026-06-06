export interface CompatibilityMetadata {
  fileName: string;
  mimeType: string;
  duration: number;
  width: number;
  height: number;
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

/**
 * Extract basic metadata via a one-shot HTMLVideoElement probe.
 * Compatibility-only path — separate from the accelerated worker pipeline.
 */
export async function extractCompatibilityMetadata(file: File): Promise<CompatibilityMetadata> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    if (video.readyState < 1) {
      await waitForEvent(video, 'loadedmetadata');
    }
    return {
      fileName: file.name,
      mimeType: file.type || 'video/mp4',
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
