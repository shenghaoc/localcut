import { createSignal, For, Show } from 'solid-js';
import { Popover } from '@ark-ui/solid/popover';
import { FileOutput } from 'lucide-solid';
import { Button, buttonVariants } from './components/button';
import type { InterchangeFormat } from '../protocol';

export interface InterchangeVideoTrack {
	id: string;
	name: string;
	clipCount: number;
}

interface InterchangeMenuProps {
	hasTimeline: boolean;
	videoTracks: readonly InterchangeVideoTrack[];
	warnings: readonly string[];
	lastMessage: string | null;
	onExport: (format: InterchangeFormat, trackId?: string) => void;
}

/**
 * Phase 48 timeline interchange: OTIO + cuts-only EDL exports. Available on
 * every capability tier — the worker emits text and the save is a plain
 * download, so the only gate is having a non-empty timeline.
 */
export function InterchangeMenu(props: InterchangeMenuProps) {
	const [open, setOpen] = createSignal(false);
	const [edlTrackId, setEdlTrackId] = createSignal<string | null>(null);

	const defaultEdlTrack = () =>
		props.videoTracks.find((track) => track.clipCount > 0) ?? props.videoTracks[0] ?? null;
	const selectedEdlTrack = () => {
		const picked = props.videoTracks.find((track) => track.id === edlTrackId());
		return picked ?? defaultEdlTrack();
	};

	return (
		<Popover.Root
			open={open()}
			onOpenChange={(details) => setOpen(details.open)}
			positioning={{ placement: 'bottom-end', gutter: 8 }}
		>
			<Popover.Trigger
				class={buttonVariants({ variant: 'outline' })}
				disabled={!props.hasTimeline}
				title={
					props.hasTimeline
						? 'Export the timeline for other editors (.otio / .edl)'
						: 'Add clips to the timeline to export interchange files'
				}
			>
				<FileOutput size={14} aria-hidden="true" />
				Interchange
			</Popover.Trigger>
			<Popover.Positioner>
				<Popover.Content class="export-popover bundle-popover">
					<div class="export-popover-header">
						<h2 class="export-popover-title">Timeline interchange</h2>
						<p class="export-popover-subtitle">
							Cuts, markers, and transitions for other editors. Effects and looks stay LocalCut-only
							metadata.
						</p>
					</div>
					<div class="bundle-actions">
						<Button variant="default" onClick={() => props.onExport('otio')}>
							Export Timeline (.otio)
						</Button>
						<Show when={props.videoTracks.length > 1}>
							<label class="bundle-collect-row">
								EDL track
								<select
									value={selectedEdlTrack()?.id ?? ''}
									onChange={(event) => setEdlTrackId(event.currentTarget.value)}
								>
									<For each={props.videoTracks}>
										{(track) => (
											<option value={track.id}>
												{track.name} ({track.clipCount} clip{track.clipCount === 1 ? '' : 's'})
											</option>
										)}
									</For>
								</select>
							</label>
						</Show>
						<Button
							variant="outline"
							disabled={!selectedEdlTrack()}
							onClick={() => props.onExport('edl', selectedEdlTrack()?.id)}
						>
							Export EDL (.edl)
						</Button>
					</div>
					<Show when={props.lastMessage || props.warnings.length > 0}>
						<div class="bundle-status" aria-live="polite">
							<Show when={props.lastMessage}>
								<p>{props.lastMessage}</p>
							</Show>
							<Show when={props.warnings.length > 0}>
								<ul>
									<For each={props.warnings.slice(0, 8)}>{(warning) => <li>{warning}</li>}</For>
								</ul>
							</Show>
						</div>
					</Show>
				</Popover.Content>
			</Popover.Positioner>
		</Popover.Root>
	);
}
