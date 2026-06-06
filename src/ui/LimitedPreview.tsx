interface LimitedPreviewProps {
  thumbnailUrl: string;
  fileName: string;
  width: number;
  height: number;
  duration: number;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/** Reduced-resolution compatibility preview — separate from the accelerated WebGPU path. */
export function LimitedPreview(props: LimitedPreviewProps) {
  return (
    <div class="limited-preview" aria-label="Compatibility preview">
      <img
        class="limited-preview-image"
        src={props.thumbnailUrl}
        alt={`Compatibility thumbnail for ${props.fileName}`}
        width={props.width}
        height={props.height}
      />
      <div class="limited-preview-meta">
        <span class="limited-preview-badge">Compatibility preview</span>
        <span class="limited-preview-copy">
          {props.fileName} · {props.width}×{props.height} · {formatDuration(props.duration)}
        </span>
      </div>
    </div>
  );
}
