/**
 * Frame Interpolation controls — Phase 37.
 *
 * Thin renderer over interpolation availability and model status.
 * Shows the synthesize option (when Phase 35 speed ramps land), model
 * load affordance, time estimate, and fps-upconvert export toggle.
 * Disabled states carry specific reasons per R11.3.
 */

import { Show, type Component } from 'solid-js';
import type { InterpolationAvailability, InterpolationModelStatus } from '../protocol';

export interface InterpolationControlsProps {
	availability: InterpolationAvailability;
	modelStatus: InterpolationModelStatus;
	modelSizeBytes: number | null;
	estimateMs: number | null;
	onLoadModel: () => void;
	onPreviewSegment: () => void;
	/** fps-upconvert toggle for export dialog. */
	fpsUpconvertEnabled: boolean;
	onFpsUpconvertToggle: (enabled: boolean) => void;
	targetFps: number;
	onTargetFpsChange: (fps: number) => void;
	motionBlurEnabled: boolean;
	onMotionBlurToggle: (enabled: boolean) => void;
	motionBlurSupported: boolean;
}

function formatBytes(bytes: number | null): string {
	if (bytes === null) return '—';
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${Math.round(bytes / 1024)} KB`;
}

function formatEstimate(ms: number | null): string {
	if (ms === null) return '—';
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.round((ms % 60_000) / 1000);
	return `${minutes}m ${seconds}s`;
}

export const InterpolationControls: Component<InterpolationControlsProps> = (props) => {
	const isUnavailable = () => props.availability.state === 'unavailable';
	const isExportOnly = () => props.availability.state === 'export-only';
	const canPreview = () => props.availability.state === 'preview-and-export';
	const canExport = () =>
		props.availability.state === 'preview-and-export' || props.availability.state === 'export-only';
	const reason = () => ('reason' in props.availability ? props.availability.reason : null);

	const modelLoaded = () => props.modelStatus === 'loaded';
	const modelLoading = () => props.modelStatus === 'loading';

	return (
		<div class="interpolation-controls" role="group" aria-label="Frame Interpolation">
			<div class="interpolation-controls__header">
				<span class="interpolation-controls__title">Frame Interpolation (ML)</span>
				<Show when={reason()}>
					<span
						class="interpolation-controls__reason"
						role="status"
						aria-live="polite"
						aria-atomic="true"
					>
						{reason()}
					</span>
				</Show>
			</div>

			<Show when={!isUnavailable()}>
				{/* Model load affordance */}
				<div class="interpolation-controls__model">
					<Show
						when={modelLoaded()}
						fallback={
							<button
								type="button"
								class="interpolation-controls__load-btn"
								disabled={modelLoading()}
								onClick={props.onLoadModel}
								aria-label={
									modelLoading()
										? 'Loading interpolation model…'
										: `Load interpolation model (${formatBytes(props.modelSizeBytes)})`
								}
							>
								{modelLoading() ? 'Loading…' : `Load model (${formatBytes(props.modelSizeBytes)})`}
							</button>
						}
					>
						<span class="interpolation-controls__model-status">Model loaded</span>
					</Show>
				</div>

				{/* Time estimate */}
				<Show when={props.estimateMs !== null}>
					<div class="interpolation-controls__estimate">
						<span>Estimated time: {formatEstimate(props.estimateMs)}</span>
						<Show when={props.availability.state !== 'unavailable'}>
							<span class="interpolation-controls__accelerator">
								({props.availability.state !== 'unavailable' ? props.availability.accelerator : ''})
							</span>
						</Show>
					</div>
				</Show>

				{/* Preview (high tier only) */}
				<Show when={canPreview()}>
					<button
						type="button"
						class="interpolation-controls__preview-btn"
						disabled={!modelLoaded()}
						onClick={() => props.onPreviewSegment()}
						aria-label="Preview interpolated segment"
					>
						Preview interpolated segment
					</button>
				</Show>

				{/* Export controls */}
				<Show when={canExport()}>
					<div class="interpolation-controls__export">
						<label class="interpolation-controls__toggle">
							<input
								type="checkbox"
								checked={props.fpsUpconvertEnabled}
								onChange={(e) => props.onFpsUpconvertToggle(e.currentTarget.checked)}
								disabled={!modelLoaded()}
							/>
							<span>FPS upconvert at export</span>
						</label>

						<Show when={props.fpsUpconvertEnabled}>
							<div class="interpolation-controls__fps">
								<label>
									Target FPS:
									<input
										type="number"
										min={1}
										max={240}
										value={props.targetFps}
										onChange={(e) =>
											props.onTargetFpsChange(parseInt(e.currentTarget.value, 10) || 60)
										}
										disabled={!modelLoaded()}
									/>
								</label>
							</div>
						</Show>

						<Show when={props.motionBlurSupported}>
							<label class="interpolation-controls__toggle">
								<input
									type="checkbox"
									checked={props.motionBlurEnabled}
									onChange={(e) => props.onMotionBlurToggle(e.currentTarget.checked)}
									disabled={!modelLoaded()}
								/>
								<span>Motion blur</span>
							</label>
						</Show>

						<Show when={isExportOnly()}>
							<span
								class="interpolation-controls__slow-label"
								role="status"
								aria-live="polite"
								aria-atomic="true"
							>
								Export only — preview requires the accelerated tier
							</span>
						</Show>
					</div>
				</Show>
			</Show>
		</div>
	);
};
