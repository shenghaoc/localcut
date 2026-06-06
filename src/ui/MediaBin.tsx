import { createEffect, For, Show } from 'solid-js';
import { Film, Image as ImageIcon, Music2, Plus, Trash2 } from 'lucide-solid';
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

function formatDuration(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
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
    return `${asset.video.width}×${asset.video.height}${fps}`;
  }
  return asset.mimeType ?? 'media';
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
              return (
                <li
                  class={`media-bin-item${offline() ? ' is-offline' : ''}`}
                  draggable={!offline()}
                  onDragStart={(event) => {
                    if (offline() || !event.dataTransfer) {
                      event.preventDefault();
                      return;
                    }
                    event.dataTransfer.setData(ASSET_DRAG_MIME, asset.sourceId);
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  title={`${asset.fileName} · ${summarize(asset)}`}
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
                      {summarize(asset)} · {formatDuration(asset.durationS)} · {formatSize(asset.byteSize)}
                      <Show when={offline()}> · offline</Show>
                    </span>
                  </div>
                  <div class="media-bin-actions">
                    <button
                      type="button"
                      class="media-bin-button"
                      onClick={() => props.onPlace(asset.sourceId)}
                      disabled={offline()}
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
