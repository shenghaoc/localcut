import { formatClock } from '../lib/format';

interface LimitedPreviewProps {
	thumbnailUrl: string;
	fileName: string;
	width: number;
	height: number;
	duration: number;
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
					{props.fileName} · {props.width}×{props.height} · {formatClock(props.duration)}
				</span>
			</div>
		</div>
	);
}
