import { createEffect, For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Popover } from '@ark-ui/solid/popover';
import {
	AlertTriangle,
	Film,
	Gauge,
	Image as ImageIcon,
	Info,
	Music2,
	Plus,
	Trash2
} from 'lucide-solid';
import { formatClock } from '../lib/format';
import type { MediaAssetSnapshot } from '../protocol';
import type { ThumbnailEntry } from './thumbnail-store';

/** dataTransfer MIME used when dragging a bin asset onto a timeline track. */
export const ASSET_DRAG_MIME = 'application/x-localcut-asset';

interface MediaBinProps {
	assets: () => MediaAssetSnapshot[];
	unresolvedIds: () => Set<string>;
	getThumbnail: (sourceId: string, timestamp: number) => ThumbnailEntry | null;
	thumbnailVersion: () => number;
	requestThumbnails: (sourceId: string, timestamps: number[]) => void;
	onPlace: (sourceId: string) => void;
	onRemove: (sourceId: string) => void;
}

const THUMB_W = 64;
const THUMB_H = 36;

function formatSize(bytes: number): string {
	const mb = bytes / 1_000_000;
	if (mb >= 10) return `${mb.toFixed(0)} MB`;
	if (mb >= 1) return `${mb.toFixed(1)} MB`;
	return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

function summarize(asset: MediaAssetSnapshot): string {
	if (asset.kind === 'image' && asset.video) {
		return `${asset.video.width}×${asset.video.height} still`;
	}
	if (asset.kind === 'audio' && asset.audio) {
		return `${asset.audio.channels}ch · ${Math.round(asset.audio.sampleRate / 1000)} kHz`;
	}
	if (asset.video) {
		const fps = asset.video.frameRate ? ` · ${Math.round(asset.video.frameRate)}fps` : '';
		const rotation = asset.video.rotationDeg ? ` · ${asset.video.rotationDeg}°` : '';
		const rateMode = asset.video.frameRateMode === 'variable' ? ' · VFR' : '';
		return `${asset.video.width}×${asset.video.height}${fps}${rotation}${rateMode}`;
	}
	return asset.mimeType ?? 'media';
}

function healthMessages(asset: MediaAssetSnapshot): string[] {
	return asset.health?.warnings.map((warning) => warning.message) ?? [];
}

function proxyLabel(asset: MediaAssetSnapshot): string | null {
	const proxy = asset.proxy;
	if (!proxy || proxy.status === 'not-generated' || proxy.status === 'disabled') return null;
	if (proxy.status === 'recommended')
		return proxy.reason ?? 'Proxy recommended for smoother preview.';
	if (proxy.status === 'ready' && proxy.width && proxy.height)
		return `Proxy ready · ${proxy.width}×${proxy.height}`;
	if (proxy.status === 'generating') {
		const progress = proxy.progress !== undefined ? ` · ${Math.round(proxy.progress * 100)}%` : '';
		return `Generating proxy${progress}`;
	}
	return `Proxy ${proxy.status}`;
}

function metaRows(asset: MediaAssetSnapshot): { label: string; value: string }[] {
	const rows: { label: string; value: string }[] = [];
	const v = asset.video;
	const a = asset.audio;
	if (v) {
		rows.push({ label: 'Resolution', value: `${v.width}×${v.height}` });
		if (v.frameRate) {
			const fps =
				v.frameRate % 1 === 0 ? `${v.frameRate}` : v.frameRate.toFixed(2).replace(/\.?0+$/, '');
			const mode = v.frameRateMode === 'variable' ? ' (variable)' : '';
			rows.push({ label: 'Frame rate', value: `${fps} fps${mode}` });
		}
		if (v.rotationDeg) rows.push({ label: 'Rotation', value: `${v.rotationDeg}°` });
		if (v.codec) rows.push({ label: 'Video codec', value: v.codec });
	}
	if (a) {
		const parts: string[] = [`${a.channels} ch`];
		if (a.sampleRate) parts.push(`${(a.sampleRate / 1000).toFixed(1)} kHz`);
		if (a.codec) parts.push(a.codec);
		rows.push({ label: 'Audio', value: parts.join(' · ') });
	}
	rows.push({ label: 'Duration', value: formatClock(asset.durationS) });
	rows.push({ label: 'File size', value: formatSize(asset.byteSize) });
	if (asset.mimeType) rows.push({ label: 'Type', value: asset.mimeType });
	return rows;
}

function MetaInfoPopover(props: { asset: MediaAssetSnapshot }) {
	const proxy = () => proxyLabel(props.asset);
	return (
		<Popover.Root positioning={{ placement: 'right-start', gutter: 8 }}>
			<Popover.Trigger
				type="button"
				class="media-bin-button"
				aria-label={`File details for ${props.asset.fileName}`}
				title="Show file details"
			>
				<Info size={13} aria-hidden="true" />
			</Popover.Trigger>
			<Portal>
				<Popover.Positioner>
					<Popover.Content class="media-info-popover panel">
						<p class="media-info-filename">{props.asset.fileName}</p>
						<dl class="media-info-rows">
							<For each={metaRows(props.asset)}>
								{(row) => (
									<>
										<dt class="media-info-label">{row.label}</dt>
										<dd class="media-info-value">{row.value}</dd>
									</>
								)}
							</For>
						</dl>
						<Show when={(props.asset.health?.warnings.length ?? 0) > 0}>
							<ul class="media-info-health">
								<For each={props.asset.health?.warnings}>
									{(w) => (
										<li class={`media-info-health-item is-${w.severity}`}>
											<AlertTriangle size={11} aria-hidden="true" />
											<span>{w.message}</span>
										</li>
									)}
								</For>
							</ul>
						</Show>
						<Show when={proxy()} keyed>
							{(label) => (
								<p class="media-info-proxy">
									<Gauge size={11} aria-hidden="true" />
									<span>{label}</span>
								</p>
							)}
						</Show>
					</Popover.Content>
				</Popover.Positioner>
			</Portal>
		</Popover.Root>
	);
}

/** Single bin thumbnail: requests one frame and draws the transferred bitmap. */
function BinThumbnail(props: {
	asset: MediaAssetSnapshot;
	offline: boolean;
	getThumbnail: MediaBinProps['getThumbnail'];
	thumbnailVersion: () => number;
	requestThumbnails: MediaBinProps['requestThumbnails'];
}) {
	let canvas: HTMLCanvasElement | undefined;

	// Sample ~10% in (capped at 2s, never past the end) so the bin thumbnail
	// isn't always the first frame — which is often black/letterboxed.
	const sampleTime = () => {
		const d = Math.max(0, props.asset.durationS);
		return Math.min(d * 0.1, 2, Math.max(0, d - 0.05));
	};

	createEffect(() => {
		props.thumbnailVersion();
		if (props.offline || props.asset.kind === 'audio') return;
		const time = sampleTime();
		const entry = props.getThumbnail(props.asset.sourceId, time);
		if (!entry) {
			props.requestThumbnails(props.asset.sourceId, [time]);
			return;
		}
		const ctx = canvas?.getContext('2d');
		if (!ctx || !canvas) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		const scale = Math.min(canvas.width / entry.width, canvas.height / entry.height);
		const w = entry.width * scale;
		const h = entry.height * scale;
		ctx.drawImage(entry.bitmap, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
	});

	return (
		<Show
			when={props.asset.kind !== 'audio'}
			fallback={
				<div class="media-bin-thumb is-audio" aria-hidden="true">
					<Music2 size={16} />
				</div>
			}
		>
			<canvas
				class="media-bin-thumb"
				width={THUMB_W}
				height={THUMB_H}
				ref={(el) => {
					canvas = el;
				}}
				aria-hidden="true"
			/>
		</Show>
	);
}

export function MediaBin(props: MediaBinProps) {
	return (
		<section class="media-bin panel" aria-label="Media bin">
			<header class="media-bin-header">
				<span class="media-bin-title">Media</span>
				<span class="media-bin-count">{props.assets().length}</span>
			</header>
			<Show
				when={props.assets().length > 0}
				fallback={<p class="media-bin-empty">Import clips, images, or audio to build your bin.</p>}
			>
				<ul class="media-bin-list">
					<For each={props.assets()}>
						{(asset) => {
							const offline = () => props.unresolvedIds().has(asset.sourceId);
							const blocked = () => asset.health?.status === 'blocked';
							const health = () => healthMessages(asset);
							const proxy = () => proxyLabel(asset);
							return (
								<li
									class={`media-bin-item${offline() ? ' is-offline' : ''}${blocked() ? ' is-blocked' : ''}`}
									draggable={!offline() && !blocked()}
									onDragStart={(event) => {
										if (offline() || blocked() || !event.dataTransfer) {
											event.preventDefault();
											return;
										}
										event.dataTransfer.setData(ASSET_DRAG_MIME, asset.sourceId);
										event.dataTransfer.effectAllowed = 'copy';
									}}
									title={`${asset.fileName} · ${summarize(asset)}${health().length > 0 ? ` · ${health().join(' · ')}` : ''}`}
								>
									<BinThumbnail
										asset={asset}
										offline={offline()}
										getThumbnail={props.getThumbnail}
										thumbnailVersion={props.thumbnailVersion}
										requestThumbnails={props.requestThumbnails}
									/>
									<div class="media-bin-meta">
										<span class="media-bin-name">
											{asset.kind === 'video' ? (
												<Film size={12} aria-hidden="true" />
											) : asset.kind === 'image' ? (
												<ImageIcon size={12} aria-hidden="true" />
											) : (
												<Music2 size={12} aria-hidden="true" />
											)}
											<span class="media-bin-name-text">{asset.fileName}</span>
										</span>
										<span class="media-bin-sub">
											{summarize(asset)} · {formatClock(asset.durationS)} ·{' '}
											{formatSize(asset.byteSize)}
											<Show when={offline()}> · offline</Show>
										</span>
										<Show when={health().length > 0}>
											<ul class="media-bin-health">
												<For each={asset.health?.warnings ?? []}>
													{(warning) => (
														<li class={`media-bin-health-item is-${warning.severity}`}>
															<AlertTriangle size={11} aria-hidden="true" />
															<span>{warning.message}</span>
														</li>
													)}
												</For>
											</ul>
										</Show>
										<Show when={proxy()} keyed>
											{(label) => (
												<span class="media-bin-proxy">
													<Gauge size={11} aria-hidden="true" />
													<span>{label}</span>
												</span>
											)}
										</Show>
									</div>
									<div class="media-bin-actions">
										<MetaInfoPopover asset={asset} />
										<button
											type="button"
											class="media-bin-button"
											onClick={() => props.onPlace(asset.sourceId)}
											disabled={offline() || blocked()}
											aria-label={`Add ${asset.fileName} to timeline`}
											title="Add to timeline"
										>
											<Plus size={13} aria-hidden="true" />
										</button>
										<button
											type="button"
											class="media-bin-button is-danger"
											onClick={() => props.onRemove(asset.sourceId)}
											aria-label={`Remove ${asset.fileName} from bin`}
											title="Remove from bin"
										>
											<Trash2 size={13} aria-hidden="true" />
										</button>
									</div>
								</li>
							);
						}}
					</For>
				</ul>
			</Show>
		</section>
	);
}
