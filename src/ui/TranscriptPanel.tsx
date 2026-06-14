import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js';
import { Trash2 } from 'lucide-solid';
import { TRANSCRIPT_WINDOW_RADIUS, computeSegmentWindow } from './transcript-window';
import type {
	CaptionDiagnosticSnapshot,
	CaptionExportSettingsSnapshot,
	CaptionPresetIdSnapshot,
	CaptionTrackSnapshot,
	CaptionStyleSnapshot
} from '../protocol';

interface TranscriptPanelProps {
	captionTracks: CaptionTrackSnapshot[];
	diagnostics: readonly CaptionDiagnosticSnapshot[];
	playheadTime: number;
	selectedTrackId: string | null;
	selectedSegmentIds: readonly string[];
	onSelectTrack: (trackId: string | null) => void;
	onSelectSegmentIds: (segmentIds: string[]) => void;
	onImport: (file: File, trackId?: string) => void;
	onExport: (settings: CaptionExportSettingsSnapshot) => void;
	onDeleteTrack: (trackId: string) => void;
	onDeleteTracks: (trackIds: readonly string[]) => void;
	onSetTrack: (
		trackId: string,
		patch: {
			name?: string;
			language?: string | null;
			burnedIn?: boolean;
			visible?: boolean;
			defaultStyle?: Partial<CaptionStyleSnapshot>;
		}
	) => void;
	onSetSegmentText: (trackId: string, segmentId: string, text: string) => void;
	onSetSegmentTiming: (trackId: string, segmentId: string, start: number, end: number) => void;
	onSetSegmentStyle: (
		trackId: string,
		segmentId: string,
		style: Partial<CaptionStyleSnapshot>
	) => void;
	onSplit: (trackId: string, segmentId: string, time: number) => void;
	onMerge: (trackId: string, segmentIds: readonly string[]) => void;
	onDelete: (trackId: string, segmentIds: readonly string[]) => void;
	onSnap: (trackId: string, segmentId: string, edge: 'start' | 'end' | 'both') => void;
}

const PRESETS: { value: CaptionPresetIdSnapshot; label: string }[] = [
	{ value: 'subtitle', label: 'Subtitle' },
	{ value: 'lower-third', label: 'Lower Third' },
	{ value: 'note', label: 'Note' }
];

function formatTime(value: number): string {
	return value.toFixed(2);
}

function parseTime(value: string, fallback: number): number {
	const trimmed = value.trim();
	if (trimmed === '') return fallback;
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function cueLabel(count: number): string {
	return `${count} cue${count === 1 ? '' : 's'}`;
}

function trackMeta(track: CaptionTrackSnapshot): string {
	const language = track.language ? track.language.toUpperCase() : 'AUTO';
	const subtitleState = track.burnedIn ? 'subtitles on' : 'sidecar';
	const visibility = track.visible ? 'visible' : 'hidden';
	return `${cueLabel(track.segments.length)} · ${language} · ${subtitleState} · ${visibility}`;
}

interface GeneratedTrackInfo {
	createdAt: Date | null;
	label: string;
}

function generatedTrackInfo(track: CaptionTrackSnapshot): GeneratedTrackInfo | null {
	if (!track.generatedBy) return null;
	try {
		const parsed = JSON.parse(track.generatedBy) as {
			generatedBy?: unknown;
			engine?: unknown;
			createdAt?: unknown;
		};
		if (parsed.generatedBy !== 'auto-captions-phase-29') return null;
		const createdAt =
			typeof parsed.createdAt === 'string' && Number.isFinite(Date.parse(parsed.createdAt))
				? new Date(parsed.createdAt)
				: null;
		const engine = typeof parsed.engine === 'string' ? parsed.engine : 'auto captions';
		return {
			createdAt,
			label: engine === 'litert-whisper' ? 'Auto captions' : engine
		};
	} catch {
		return null;
	}
}

function formatGeneratedAt(info: GeneratedTrackInfo | null): string {
	if (!info?.createdAt) return 'Generated';
	return `Generated ${info.createdAt.toLocaleString([], {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	})}`;
}

function trackDuration(track: CaptionTrackSnapshot): string {
	const end = track.segments.reduce(
		(max, segment) => Math.max(max, segment.start + segment.duration),
		0
	);
	return end > 0 ? `${end.toFixed(1)} s` : '0.0 s';
}

export function TranscriptPanel(props: TranscriptPanelProps) {
	let importInput: HTMLInputElement | undefined;
	const activeTrack = createMemo(
		() =>
			props.captionTracks.find((track) => track.id === props.selectedTrackId) ??
			props.captionTracks[0] ??
			null
	);
	const activeSegment = createMemo(() => {
		const track = activeTrack();
		if (!track) return null;
		return (
			track.segments.find((segment) => segment.id === props.selectedSegmentIds[0]) ??
			track.segments[0] ??
			null
		);
	});
	const [draftText, setDraftText] = createSignal('');

	// Memoize the selection as a Set so per-row membership is O(1) instead of an
	// O(segments × selection) `Array.includes` scan during render.
	const selectedIdSet = createMemo(() => new Set(props.selectedSegmentIds));

	// Window the rendered rows around the active/playhead segment so large caption
	// files (thousands of segments) never materialize every row at once.
	const activeSegmentIndex = createMemo(() => {
		const track = activeTrack();
		if (!track || track.segments.length === 0) return 0;
		const selectedId = props.selectedSegmentIds[0];
		if (selectedId) {
			const byId = track.segments.findIndex((segment) => segment.id === selectedId);
			if (byId >= 0) return byId;
		}
		// Fall back to the segment under the playhead. Caption segments are sorted by
		// start time, so binary search keeps this O(log N) — playheadTime updates ~60×
		// per second during playback and would otherwise rescan the whole track.
		const t = props.playheadTime;
		let low = 0;
		let high = track.segments.length - 1;
		let byTime = -1;
		while (low <= high) {
			const mid = (low + high) >> 1;
			const segment = track.segments[mid]!;
			if (t >= segment.start && t < segment.start + segment.duration) {
				byTime = mid;
				break;
			} else if (t < segment.start) {
				high = mid - 1;
			} else {
				low = mid + 1;
			}
		}
		return byTime >= 0 ? byTime : 0;
	});
	// Manual paging anchor: lets the user reach caption rows outside the
	// active/playhead-centered window (B5 windowing would otherwise make distant
	// rows unreachable in a long SRT/WebVTT import). Cleared whenever the selection
	// or active track changes so selecting a segment recenters the view.
	const [viewAnchor, setViewAnchor] = createSignal<number | null>(null);
	createEffect(
		on([() => props.selectedSegmentIds[0], () => activeTrack()?.id], () => setViewAnchor(null))
	);
	const windowCenter = createMemo(() => viewAnchor() ?? activeSegmentIndex());
	const segmentWindow = createMemo(() =>
		computeSegmentWindow(activeTrack()?.segments.length ?? 0, windowCenter())
	);
	function pageWindow(direction: -1 | 1): void {
		const total = activeTrack()?.segments.length ?? 0;
		const { start, end } = segmentWindow();
		const next =
			direction < 0
				? Math.max(0, start - TRANSCRIPT_WINDOW_RADIUS)
				: Math.min(total - 1, end - 1 + TRANSCRIPT_WINDOW_RADIUS);
		setViewAnchor(next);
	}
	const visibleSegments = createMemo(() => {
		const track = activeTrack();
		if (!track) return [];
		const { start, end } = segmentWindow();
		return track.segments.slice(start, end);
	});

	const exportStem = createMemo(() => {
		const track = activeTrack();
		if (!track) return 'captions';
		return track.name.trim().replace(/\s+/g, '-').toLowerCase() || 'captions';
	});
	const autoCaptionTracks = createMemo(() =>
		props.captionTracks
			.map((track, index) => ({ track, index, info: generatedTrackInfo(track) }))
			.filter((entry) => entry.info !== null)
	);
	const olderAutoCaptionTrackIds = createMemo(() => {
		const tracks = autoCaptionTracks();
		if (tracks.length < 2) return [];
		let latest = tracks[0]!;
		for (const entry of tracks.slice(1)) {
			const entryTime = entry.info?.createdAt?.getTime() ?? entry.index;
			const latestTime = latest.info?.createdAt?.getTime() ?? latest.index;
			if (entryTime > latestTime) latest = entry;
		}
		return tracks
			.filter((entry) => entry.track.id !== latest.track.id)
			.map((entry) => entry.track.id);
	});

	createEffect(() => {
		setDraftText(activeSegment()?.text ?? '');
	});

	function toggleSegment(segmentId: string, checked: boolean): void {
		const next = new Set(props.selectedSegmentIds);
		if (checked) next.add(segmentId);
		else next.delete(segmentId);
		props.onSelectSegmentIds([...next]);
	}

	return (
		<section class="panel transcript-panel">
			<div class="transcript-header">
				<div>
					<h2 class="panel-title">Transcript</h2>
					<p class="transcript-subtitle">Caption tracks and timing</p>
				</div>
				<div class="transcript-actions">
					<Show when={olderAutoCaptionTrackIds().length > 0}>
						<button
							type="button"
							class="button danger transcript-bulk-delete"
							title={`Delete ${olderAutoCaptionTrackIds().length} older auto-caption track${olderAutoCaptionTrackIds().length === 1 ? '' : 's'} and keep the newest run`}
							aria-label={`Delete ${olderAutoCaptionTrackIds().length} older auto-caption track${olderAutoCaptionTrackIds().length === 1 ? '' : 's'} and keep the newest run`}
							onClick={() => props.onDeleteTracks(olderAutoCaptionTrackIds())}
						>
							<Trash2 size={14} aria-hidden="true" />
							Keep latest ({olderAutoCaptionTrackIds().length})
						</button>
					</Show>
					<button type="button" class="button secondary" onClick={() => importInput?.click()}>
						Import
					</button>
					<input
						ref={importInput}
						class="sr-only"
						type="file"
						accept=".srt,.vtt,text/vtt,application/x-subrip"
						onChange={(event) => {
							const file = event.currentTarget.files?.[0];
							if (file) props.onImport(file, activeTrack()?.id);
							event.currentTarget.value = '';
						}}
					/>
					<button
						type="button"
						class="button secondary"
						disabled={!activeTrack()}
						onClick={() =>
							activeTrack() &&
							props.onExport({
								trackId: activeTrack()!.id,
								formats: ['srt', 'webvtt'],
								range: { mode: 'full-track' },
								fileStem: exportStem()
							})
						}
					>
						Export
					</button>
				</div>
			</div>

			<Show
				when={props.captionTracks.length > 0}
				fallback={<p class="placeholder-text">Import SRT or WebVTT to start a caption track.</p>}
			>
				<Show when={activeTrack()}>
					{(track) => {
						const info = () => generatedTrackInfo(track());
						return (
							<div class="transcript-active-summary">
								<div class="transcript-active-copy">
									<span class="transcript-kicker">Active track</span>
									<strong>{track().name}</strong>
									<span class="transcript-active-meta">
										<span>
											{cueLabel(track().segments.length)} · {trackDuration(track())} ·{' '}
											{track().language ? track().language!.toUpperCase() : 'AUTO'}
										</span>
										<Show when={autoCaptionTracks().length > 1}>
											<span>
												{autoCaptionTracks().length} generated runs ·{' '}
												{olderAutoCaptionTrackIds().length} older
											</span>
										</Show>
									</span>
								</div>
								<div class="transcript-active-badges">
									<Show when={info()}>
										{(generated) => (
											<>
												<span class="transcript-pill">{generated().label}</span>
												<span class="transcript-muted">{formatGeneratedAt(generated())}</span>
											</>
										)}
									</Show>
								</div>
							</div>
						);
					}}
				</Show>

				<div class="transcript-track-list">
					<For each={props.captionTracks}>
						{(track) => {
							const info = () => generatedTrackInfo(track);
							return (
								<div
									class={`transcript-track-card${activeTrack()?.id === track.id ? ' is-active' : ''}`}
								>
									<button
										type="button"
										class="transcript-track-main"
										onClick={() => {
											props.onSelectTrack(track.id);
											props.onSelectSegmentIds(track.segments[0] ? [track.segments[0].id] : []);
										}}
									>
										<span class="transcript-track-name">
											{track.name}
											<Show when={info()}>
												<span class="transcript-track-chip">{info()!.label}</span>
											</Show>
										</span>
										<span class="transcript-track-meta">
											{trackMeta(track)} · {trackDuration(track)}
										</span>
										<Show when={info()}>
											{(generated) => (
												<span class="transcript-track-meta">{formatGeneratedAt(generated())}</span>
											)}
										</Show>
									</button>
									<button
										type="button"
										class="transcript-icon-button danger"
										title={`Delete ${track.name}`}
										aria-label={`Delete ${track.name}`}
										onClick={() => props.onDeleteTrack(track.id)}
									>
										<Trash2 size={14} aria-hidden="true" />
									</button>
								</div>
							);
						}}
					</For>
				</div>

				<Show when={activeTrack()}>
					{(track) => (
						<>
							<div class="transcript-track-controls">
								<label>
									<span>Name</span>
									<input
										value={track().name}
										onChange={(event) =>
											props.onSetTrack(track().id, { name: event.currentTarget.value })
										}
									/>
								</label>
								<label>
									<span>Language</span>
									<input
										value={track().language ?? ''}
										placeholder="en"
										onChange={(event) =>
											props.onSetTrack(track().id, { language: event.currentTarget.value || null })
										}
									/>
								</label>
								<label class="transcript-inline-check">
									<input
										type="checkbox"
										checked={track().burnedIn}
										onChange={(event) =>
											props.onSetTrack(track().id, { burnedIn: event.currentTarget.checked })
										}
									/>
									<span>Subtitles</span>
								</label>
								<label class="transcript-inline-check">
									<input
										type="checkbox"
										checked={track().visible}
										onChange={(event) =>
											props.onSetTrack(track().id, { visible: event.currentTarget.checked })
										}
									/>
									<span>Visible</span>
								</label>
								<label>
									<span>Preset</span>
									<select
										value={track().defaultStyle.presetId ?? 'subtitle'}
										onChange={(event) =>
											props.onSetTrack(track().id, {
												defaultStyle: {
													presetId: event.currentTarget.value as CaptionPresetIdSnapshot
												}
											})
										}
									>
										<For each={PRESETS}>
											{(preset) => <option value={preset.value}>{preset.label}</option>}
										</For>
									</select>
								</label>
								<label>
									<span>Font size</span>
									<input
										type="number"
										min="16"
										max="160"
										value={track().defaultStyle.overrides?.fontSizePx ?? 64}
										onChange={(event) =>
											props.onSetTrack(track().id, {
												defaultStyle: {
													overrides: {
														...track().defaultStyle.overrides,
														fontSizePx: Number(event.currentTarget.value)
													}
												}
											})
										}
									/>
								</label>
							</div>

							<div class="transcript-workspace">
								<div class="transcript-list-pane">
									<div class="transcript-section-header">
										<span>Segments</span>
										<span>{cueLabel(track().segments.length)}</span>
									</div>
									<div class="transcript-segment-list">
										<Show when={segmentWindow().before > 0}>
											<button
												type="button"
												class="transcript-window-hint"
												onClick={() => pageWindow(-1)}
											>
												Show {segmentWindow().before} earlier
											</button>
										</Show>
										<For each={visibleSegments()}>
											{(segment, index) => (
												<div
													class={`transcript-row${selectedIdSet().has(segment.id) ? ' is-selected' : ''}`}
												>
													<input
														class="transcript-row-select"
														type="checkbox"
														aria-label={`Select segment ${segmentWindow().start + index() + 1}`}
														checked={selectedIdSet().has(segment.id)}
														onChange={(event) =>
															toggleSegment(segment.id, event.currentTarget.checked)
														}
													/>
													<button
														type="button"
														class="transcript-row-main"
														onClick={() => {
															props.onSelectTrack(track().id);
															props.onSelectSegmentIds([segment.id]);
															setDraftText(segment.text);
														}}
													>
														<span class="transcript-row-index">
															#{segmentWindow().start + index() + 1}
														</span>
														<span class="transcript-time">
															{formatTime(segment.start)} -{' '}
															{formatTime(segment.start + segment.duration)}
														</span>
														<span class="transcript-text">{segment.text}</span>
													</button>
												</div>
											)}
										</For>
										<Show when={segmentWindow().after > 0}>
											<button
												type="button"
												class="transcript-window-hint"
												onClick={() => pageWindow(1)}
											>
												Show {segmentWindow().after} later
											</button>
										</Show>
									</div>
								</div>

								<div class="transcript-editor-pane">
									<Show
										when={activeSegment()}
										fallback={<p class="placeholder-text">No segment selected.</p>}
									>
										{(segment) => (
											<div class="transcript-editor">
												<div class="transcript-section-header">
													<span>Edit segment</span>
													<span>
														{formatTime(segment().start)} -{' '}
														{formatTime(segment().start + segment().duration)}
													</span>
												</div>
												<label>
													<span>Text</span>
													<textarea
														value={draftText()}
														rows={5}
														onInput={(event) => setDraftText(event.currentTarget.value)}
														onBlur={() =>
															props.onSetSegmentText(track().id, segment().id, draftText())
														}
													/>
												</label>
												<div class="transcript-timing-grid">
													<label>
														<span>Start</span>
														<input
															value={formatTime(segment().start)}
															onChange={(event) =>
																props.onSetSegmentTiming(
																	track().id,
																	segment().id,
																	parseTime(event.currentTarget.value, segment().start),
																	segment().start + segment().duration
																)
															}
														/>
													</label>
													<label>
														<span>End</span>
														<input
															value={formatTime(segment().start + segment().duration)}
															onChange={(event) =>
																props.onSetSegmentTiming(
																	track().id,
																	segment().id,
																	segment().start,
																	parseTime(
																		event.currentTarget.value,
																		segment().start + segment().duration
																	)
																)
															}
														/>
													</label>
													<label>
														<span>Color</span>
														<input
															type="color"
															value={
																segment().style?.overrides?.color ??
																track().defaultStyle.overrides?.color ??
																'#ffffff'
															}
															onChange={(event) =>
																props.onSetSegmentStyle(track().id, segment().id, {
																	overrides: { color: event.currentTarget.value }
																})
															}
														/>
													</label>
													<label>
														<span>Background</span>
														<input
															type="color"
															value={
																segment().style?.overrides?.backgroundColor ??
																track().defaultStyle.overrides?.backgroundColor ??
																'#000000'
															}
															onChange={(event) =>
																props.onSetSegmentStyle(track().id, segment().id, {
																	overrides: { backgroundColor: event.currentTarget.value }
																})
															}
														/>
													</label>
												</div>
												<div class="transcript-editor-actions">
													<button
														type="button"
														class="button secondary"
														onClick={() =>
															props.onSplit(track().id, segment().id, props.playheadTime)
														}
													>
														Split at playhead
													</button>
													<button
														type="button"
														class="button secondary"
														disabled={props.selectedSegmentIds.length < 2}
														onClick={() => props.onMerge(track().id, props.selectedSegmentIds)}
													>
														Merge selected
													</button>
													<button
														type="button"
														class="button secondary"
														onClick={() => props.onSnap(track().id, segment().id, 'start')}
													>
														Snap start
													</button>
													<button
														type="button"
														class="button secondary"
														onClick={() => props.onSnap(track().id, segment().id, 'end')}
													>
														Snap end
													</button>
													<button
														type="button"
														class="button secondary"
														onClick={() => props.onSnap(track().id, segment().id, 'both')}
													>
														Snap both
													</button>
													<button
														type="button"
														class="button danger"
														onClick={() =>
															props.onDelete(
																track().id,
																props.selectedSegmentIds.length > 0
																	? props.selectedSegmentIds
																	: [segment().id]
															)
														}
													>
														Delete
													</button>
												</div>
											</div>
										)}
									</Show>
								</div>
							</div>
						</>
					)}
				</Show>
			</Show>

			<Show when={props.diagnostics.length > 0}>
				<div class="transcript-diagnostics" role="status" aria-live="polite">
					<For each={props.diagnostics.slice(0, 6)}>
						{(diag) => <p class={`transcript-diagnostic is-${diag.severity}`}>{diag.message}</p>}
					</For>
				</div>
			</Show>
		</section>
	);
}
