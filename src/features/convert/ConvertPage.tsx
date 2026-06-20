import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
	ArrowLeft,
	Download,
	FileAudio,
	FileVideo,
	Loader2,
	RotateCcw,
	Repeat2,
	Trash2,
	TriangleAlert,
	CheckCircle2,
	Upload,
	X
} from 'lucide-solid';
import { Button } from '../../ui/components/button';
import { formatBytes, formatClock } from '../../lib/format';
import { spawnConvertWorker, type ConvertWorkerPort } from '../../ui/convert-bridge';
import type {
	ConvertFormatId,
	ConvertInputInfo,
	ConvertQuality,
	ConvertWorkerState
} from '../../protocol';
import { CONVERT_FORMATS, convertFormatById, defaultFormatForInput } from './convert-formats';

interface ConvertPageProps {
	onClose: () => void;
	/** Opens the in-app guide section for the converter (closes this view). */
	onOpenGuide?: () => void;
}

type JobStatus =
	| 'probing'
	| 'unreadable'
	| 'ready'
	| 'queued'
	| 'converting'
	| 'done'
	| 'failed'
	| 'canceled';

interface ConvertJob {
	id: string;
	file: File;
	fileName: string;
	info: ConvertInputInfo | null;
	formatId: ConvertFormatId;
	quality: ConvertQuality;
	status: JobStatus;
	fraction: number;
	error: string | null;
	result: { fileName: string; mimeType: string; bytes: number; elapsedSeconds: number } | null;
	output: Blob | null;
}

const VIDEO_FORMATS = CONVERT_FORMATS.filter((f) => f.kind === 'video');
const AUDIO_FORMATS = CONVERT_FORMATS.filter((f) => f.kind === 'audio');
const MEDIA_PICKER_TYPES = [
	{
		description: 'Video and audio files',
		accept: {
			'video/*': ['.mp4', '.mov', '.webm', '.mkv'],
			'audio/*': ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']
		}
	}
];

const QUALITY_LABELS: Record<ConvertQuality, string> = {
	high: 'High quality',
	medium: 'Medium',
	low: 'Low (smaller file)'
};

function newJobId(): string {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: `job-${Math.random().toString(36).slice(2)}`;
}

/**
 * Full-screen media converter, layered over the editor (which stays mounted).
 * Conversion runs in a dedicated worker via Mediabunny; this view owns the
 * batch job list and the worker lifecycle, and never touches the timeline.
 */
export function ConvertPage(props: ConvertPageProps) {
	let pageRef: HTMLElement | undefined;
	let fileInput: HTMLInputElement | undefined;
	let port: ConvertWorkerPort | null = null;

	const [jobs, setJobs] = createStore<ConvertJob[]>([]);
	const [dragging, setDragging] = createSignal(false);
	const [workerError, setWorkerError] = createSignal<string | null>(null);
	// Kept separate from `workerError` so a transient file-picker failure isn't
	// reported as a worker crash (and vice versa).
	const [pickError, setPickError] = createSignal<string | null>(null);
	// Guards against an infinite crash→respawn loop when the worker fails on
	// startup (e.g. an environment incompatibility); reset whenever the worker
	// proves healthy by sending a message.
	let consecutiveCrashes = 0;

	const originalTitle = typeof document !== 'undefined' ? document.title : '';

	const updateJob = (id: string, patch: Partial<ConvertJob>) => {
		setJobs((job) => job.id === id, patch);
	};

	const readyCount = createMemo(() => jobs.filter((j) => j.status === 'ready').length);
	const busy = createMemo(() =>
		jobs.some((j) => j.status === 'converting' || j.status === 'queued')
	);

	/** Runs queued jobs one at a time (only one encoder pipeline active). */
	const pump = () => {
		if (!port) return;
		if (jobs.some((j) => j.status === 'converting')) return;
		const next = jobs.find((j) => j.status === 'queued');
		if (!next) return;
		updateJob(next.id, { status: 'converting', fraction: 0, error: null });
		port.send({
			type: 'convert-start',
			jobId: next.id,
			file: next.file,
			target: { formatId: next.formatId, quality: next.quality }
		});
	};

	const handleState = (msg: ConvertWorkerState) => {
		// Any message means the current worker is alive and talking.
		consecutiveCrashes = 0;
		switch (msg.type) {
			case 'convert-probed': {
				updateJob(msg.jobId, {
					info: msg.info,
					status: 'ready',
					formatId: defaultFormatForInput(msg.info)
				});
				return;
			}
			case 'convert-probe-failed': {
				updateJob(msg.jobId, { status: 'unreadable', error: msg.message });
				return;
			}
			case 'convert-progress': {
				updateJob(msg.jobId, { fraction: msg.fraction });
				return;
			}
			case 'convert-done': {
				const blob = new Blob([msg.output], { type: msg.mimeType });
				updateJob(msg.jobId, {
					status: 'done',
					fraction: 1,
					output: blob,
					result: {
						fileName: msg.fileName,
						mimeType: msg.mimeType,
						bytes: msg.bytes,
						elapsedSeconds: msg.elapsedSeconds
					}
				});
				pump();
				return;
			}
			case 'convert-failed': {
				updateJob(msg.jobId, { status: 'failed', error: msg.message });
				pump();
				return;
			}
			case 'convert-canceled': {
				updateJob(msg.jobId, { status: 'canceled', fraction: 0 });
				pump();
				return;
			}
		}
	};

	const addFiles = (files: readonly File[]) => {
		if (!port) return;
		setPickError(null);
		const added: ConvertJob[] = files.map((file) => ({
			id: newJobId(),
			file,
			fileName: file.name,
			info: null,
			formatId: 'mp4',
			quality: 'high',
			status: 'probing',
			fraction: 0,
			error: null,
			result: null,
			output: null
		}));
		setJobs((list) => [...list, ...added]);
		for (const job of added) {
			port.send({ type: 'convert-probe', jobId: job.id, file: job.file });
		}
	};

	const pickFiles = async () => {
		const picker = (
			window as unknown as {
				showOpenFilePicker?: (options?: unknown) => Promise<{ getFile(): Promise<File> }[]>;
			}
		).showOpenFilePicker;
		if (typeof picker === 'function') {
			setPickError(null);
			try {
				const handles = await picker({ multiple: true, types: MEDIA_PICKER_TYPES });
				const picked = await Promise.all(handles.map((h) => h.getFile()));
				addFiles(picked);
			} catch (error) {
				// AbortError = the user dismissed the picker; nothing to report.
				if (!(error instanceof DOMException && error.name === 'AbortError')) {
					setPickError(
						`Couldn't open the file picker: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}
			return;
		}
		fileInput?.click();
	};

	const convertJob = (id: string) => {
		updateJob(id, { status: 'queued', error: null, result: null, output: null, fraction: 0 });
		pump();
	};

	const convertAll = () => {
		setJobs((j) => j.status === 'ready', { status: 'queued', error: null });
		pump();
	};

	const cancelJob = (id: string) => {
		const job = jobs.find((j) => j.id === id);
		if (!job) return;
		if (job.status === 'converting') {
			port?.send({ type: 'convert-cancel', jobId: id });
		} else if (job.status === 'queued') {
			updateJob(id, { status: 'ready' });
		}
	};

	const removeJob = (id: string) => {
		cancelJob(id);
		setJobs((list) => list.filter((j) => j.id !== id));
	};

	const saveJob = async (job: ConvertJob) => {
		if (!job.output || !job.result) return;
		const suggestedName = job.result.fileName;
		const saver = (
			window as unknown as {
				showSaveFilePicker?: (options?: unknown) => Promise<{
					createWritable(): Promise<{
						write(data: Blob): Promise<void>;
						close(): Promise<void>;
					}>;
				}>;
			}
		).showSaveFilePicker;
		if (typeof saver === 'function') {
			try {
				const descriptor = convertFormatById(job.formatId);
				const handle = await saver({
					suggestedName,
					types: [
						{
							description: `${descriptor.shortLabel} file`,
							accept: { [descriptor.mimeType]: [`.${descriptor.extension}`] }
						}
					]
				});
				const writable = await handle.createWritable();
				await writable.write(job.output);
				await writable.close();
				return;
			} catch (error) {
				if (error instanceof DOMException && error.name === 'AbortError') return;
				// Fall through to the anchor download on any non-abort failure.
			}
		}
		const url = URL.createObjectURL(job.output);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = suggestedName;
		anchor.rel = 'noopener';
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		// Revoking synchronously can truncate the download in some browsers before
		// they've started fetching the blob URL; defer it (matches App.tsx).
		setTimeout(() => URL.revokeObjectURL(url), 10_000);
	};

	// Wired so a worker crash both unsticks in-flight jobs and replaces the dead
	// worker, leaving the view usable (retry, add more files) instead of inert.
	const spawn = () => {
		// Clear any stale crash banner from a previous worker; the fresh one is healthy.
		setWorkerError(null);
		port = spawnConvertWorker(handleState, (message) => {
			setWorkerError(message);
			setJobs((j) => j.status === 'converting' || j.status === 'queued' || j.status === 'probing', {
				status: 'failed',
				error: 'Media converter worker crashed.'
			});
			port?.terminate();
			consecutiveCrashes += 1;
			if (consecutiveCrashes < 3) {
				spawn();
			} else {
				// Give up: drop the dead reference so addFiles/pump bail via their
				// `if (!port)` guards instead of pushing jobs that never get probed.
				port = null;
				setWorkerError('Media converter keeps crashing. Please refresh the page to try again.');
			}
		});
	};

	onMount(() => {
		spawn();
		pageRef?.focus();
		document.title = 'Convert media · LocalCut Studio';
	});

	onCleanup(() => {
		port?.terminate();
		port = null;
		document.title = originalTitle || 'LocalCut Studio';
	});

	return (
		<section
			ref={(el) => {
				pageRef = el;
			}}
			class="convert-page"
			aria-label="Convert media"
			tabIndex={-1}
			onKeyDown={(event) => {
				if (event.key === 'Escape') {
					event.preventDefault();
					props.onClose();
				}
			}}
			onDragOver={(event) => event.preventDefault()}
			onDrop={(event) => {
				// Swallow any drop on the converter overlay so it never bubbles to the
				// editor's window-level importer (which would mutate the timeline behind
				// us). The drop zone's own handler adds files before this runs.
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			<header class="convert-header">
				<Button variant="ghost" onClick={() => props.onClose()}>
					<ArrowLeft size={14} aria-hidden="true" />
					Back to editor
				</Button>
				<p class="convert-header-title">
					<Repeat2 size={14} aria-hidden="true" />
					Convert media
				</p>
			</header>

			<div class="convert-body">
				<div class="convert-intro">
					<h2>Change a file's format</h2>
					<p>
						Convert video and audio files to another format — right here in your browser. Files
						never leave your device, and your timeline isn't touched. Drop files in, pick a format,
						and download the result.
					</p>
				</div>

				<Show when={workerError()}>
					{(message) => (
						<p class="convert-banner convert-banner-error" role="alert">
							<TriangleAlert size={14} aria-hidden="true" />
							{message()}
						</p>
					)}
				</Show>

				<Show when={pickError()}>
					{(message) => (
						<p class="convert-banner convert-banner-error" role="alert">
							<TriangleAlert size={14} aria-hidden="true" />
							{message()}
						</p>
					)}
				</Show>

				<button
					type="button"
					class="convert-dropzone"
					classList={{ 'is-dragging': dragging() }}
					onClick={() => void pickFiles()}
					onDragOver={(event) => {
						event.preventDefault();
						setDragging(true);
					}}
					onDragLeave={() => setDragging(false)}
					onDrop={(event) => {
						event.preventDefault();
						event.stopPropagation();
						setDragging(false);
						const dropped = event.dataTransfer ? Array.from(event.dataTransfer.files) : [];
						if (dropped.length > 0) addFiles(dropped);
					}}
				>
					<Upload size={22} aria-hidden="true" />
					<span class="convert-dropzone-title">Drop files here, or click to choose</span>
					<span class="convert-dropzone-hint">
						Video or audio · multiple files at once · nothing is uploaded
					</span>
				</button>

				<input
					ref={(el) => {
						fileInput = el;
					}}
					type="file"
					accept="video/*,audio/*"
					multiple
					hidden
					onChange={(event) => {
						const input = event.currentTarget;
						addFiles(Array.from(input.files ?? []));
						input.value = '';
					}}
				/>

				<Show when={readyCount() > 1}>
					<div class="convert-batch-bar">
						<span>{readyCount()} files ready</span>
						<Button variant="default" onClick={convertAll} disabled={busy()}>
							<Repeat2 size={14} aria-hidden="true" />
							Convert all
						</Button>
					</div>
				</Show>

				<Show
					when={jobs.length > 0}
					fallback={
						<p class="convert-empty">
							No files yet. Add a video or audio file to get started.
							<Show when={props.onOpenGuide}>
								{' '}
								<button type="button" class="convert-link" onClick={() => props.onOpenGuide?.()}>
									Learn what Convert can do
								</button>
								.
							</Show>
						</p>
					}
				>
					<ul class="convert-jobs">
						<For each={jobs}>
							{(job) => (
								<JobRow job={job} {...{ convertJob, cancelJob, removeJob, saveJob, updateJob }} />
							)}
						</For>
					</ul>
				</Show>
			</div>
		</section>
	);
}

interface JobRowDeps {
	convertJob: (id: string) => void;
	cancelJob: (id: string) => void;
	removeJob: (id: string) => void;
	saveJob: (job: ConvertJob) => void | Promise<void>;
	updateJob: (id: string, patch: Partial<ConvertJob>) => void;
}

function JobRow(props: { job: ConvertJob } & JobRowDeps) {
	const job = () => props.job;
	const format = createMemo(() => convertFormatById(job().formatId));

	// Controls stay on screen in every state except while reading or when the
	// file is unreadable, so a finished job can simply be re-pointed at a
	// different format rather than dead-ending. They lock only while the job is
	// queued or actively converting.
	const showControls = () => job().status !== 'probing' && job().status !== 'unreadable';
	const controlsLocked = () => job().status === 'queued' || job().status === 'converting';
	const done = () => job().status === 'done';
	const errored = () =>
		job().status === 'failed' || job().status === 'canceled' || job().status === 'unreadable';

	const summary = createMemo(() => {
		const info = job().info;
		if (!info) return null;
		const parts: string[] = [info.containerLabel];
		if (info.width && info.height) parts.push(`${info.width}×${info.height}`);
		parts.push(formatClock(info.durationSeconds));
		if (info.hasVideo && info.hasAudio) parts.push('video + audio');
		else if (info.hasVideo) parts.push('video only');
		else if (info.hasAudio) parts.push('audio only');
		return parts.join(' · ');
	});

	// Warn when an audio-only target on a video file will drop the picture —
	// this is the most likely source of confusion.
	const dropsVideo = createMemo(() => job().info?.hasVideo === true && format().kind === 'audio');

	// Match the icon to the source: audio-only files get the audio glyph.
	const audioOnly = () => job().info?.hasVideo === false && job().info?.hasAudio === true;

	// Changing the target after a job finished must discard the stale result so
	// the Done summary / Save button can't download a file for the old format.
	const retarget = (patch: Partial<ConvertJob>) => {
		const terminal =
			job().status === 'done' || job().status === 'failed' || job().status === 'canceled';
		props.updateJob(
			job().id,
			terminal
				? { ...patch, status: 'ready', result: null, output: null, error: null, fraction: 0 }
				: patch
		);
	};

	return (
		<li class="convert-job" classList={{ [`is-${job().status}`]: true }}>
			<div class="convert-job-head">
				<Show
					when={audioOnly()}
					fallback={<FileVideo size={16} aria-hidden="true" class="convert-job-icon" />}
				>
					<FileAudio size={16} aria-hidden="true" class="convert-job-icon" />
				</Show>
				<div class="convert-job-id">
					<span class="convert-job-name" title={job().fileName}>
						{job().fileName}
					</span>
					<Show when={summary()} fallback={<span class="convert-job-meta">Reading file…</span>}>
						{(text) => <span class="convert-job-meta">{text()}</span>}
					</Show>
				</div>
				<JobStatusChip status={job().status} />
			</div>

			<Show when={showControls()}>
				<div class="convert-job-controls">
					<label class="convert-field">
						<span class="convert-field-label">Convert to</span>
						<select
							class="convert-select"
							disabled={controlsLocked()}
							value={job().formatId}
							onChange={(event) =>
								retarget({ formatId: event.currentTarget.value as ConvertFormatId })
							}
						>
							<optgroup label="Keep video">
								<For each={VIDEO_FORMATS}>{(f) => <option value={f.id}>{f.label}</option>}</For>
							</optgroup>
							<optgroup label="Audio only (removes video)">
								<For each={AUDIO_FORMATS}>{(f) => <option value={f.id}>{f.label}</option>}</For>
							</optgroup>
						</select>
					</label>
					<label class="convert-field">
						<span class="convert-field-label">Quality</span>
						<select
							class="convert-select"
							disabled={controlsLocked()}
							value={job().quality}
							onChange={(event) =>
								retarget({ quality: event.currentTarget.value as ConvertQuality })
							}
						>
							<option value="high">{QUALITY_LABELS.high}</option>
							<option value="medium">{QUALITY_LABELS.medium}</option>
							<option value="low">{QUALITY_LABELS.low}</option>
						</select>
					</label>
				</div>
				<p class="convert-job-hint">{format().hint}</p>
				<Show when={dropsVideo()}>
					<p class="convert-job-note">
						<TriangleAlert size={12} aria-hidden="true" />
						This keeps the audio only — the video track is removed.
					</p>
				</Show>
			</Show>

			<Show when={job().status === 'converting'}>
				<div class="convert-progress">
					<div
						class="convert-progress-track"
						role="progressbar"
						aria-label={`Converting ${job().fileName} to ${format().shortLabel}`}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={Math.round(job().fraction * 100)}
					>
						<div class="convert-progress-fill" style={{ width: `${job().fraction * 100}%` }} />
					</div>
					<span class="convert-progress-label">
						<Loader2 size={12} aria-hidden="true" class="convert-spin" />
						Converting to {format().shortLabel}… {Math.round(job().fraction * 100)}%
					</span>
				</div>
			</Show>

			<Show when={done() && job().result}>
				{(result) => (
					<p class="convert-result-summary">
						<CheckCircle2 size={14} aria-hidden="true" />
						Saved as {result().fileName} · {formatBytes(result().bytes)} · converted in{' '}
						{formatClock(result().elapsedSeconds)}
					</p>
				)}
			</Show>

			<Show when={errored()}>
				<p class="convert-result-summary convert-result-bad">
					<TriangleAlert size={14} aria-hidden="true" />
					{job().status === 'canceled'
						? 'Conversion canceled.'
						: (job().error ?? "This file couldn't be converted.")}
				</p>
			</Show>

			{/* One predictable footer of actions, adapted to the job's state. */}
			<div class="convert-job-footer">
				<div class="convert-job-actions">
					<Show when={job().status === 'ready'}>
						<Button variant="default" onClick={() => props.convertJob(job().id)}>
							<Repeat2 size={14} aria-hidden="true" />
							Convert
						</Button>
					</Show>
					<Show when={job().status === 'queued'}>
						<span class="convert-waiting">Waiting…</span>
						<Button variant="outline" size="sm" onClick={() => props.cancelJob(job().id)}>
							Cancel
						</Button>
					</Show>
					<Show when={job().status === 'converting'}>
						<Button variant="outline" size="sm" onClick={() => props.cancelJob(job().id)}>
							<X size={13} aria-hidden="true" />
							Cancel
						</Button>
					</Show>
					<Show when={done()}>
						<Button variant="default" onClick={() => void props.saveJob(job())}>
							<Download size={14} aria-hidden="true" />
							Save file
						</Button>
						<Button variant="ghost" size="sm" onClick={() => props.convertJob(job().id)}>
							<RotateCcw size={13} aria-hidden="true" />
							Convert again
						</Button>
					</Show>
					<Show when={job().status === 'failed' || job().status === 'canceled'}>
						<Button variant="default" onClick={() => props.convertJob(job().id)}>
							<RotateCcw size={13} aria-hidden="true" />
							Try again
						</Button>
					</Show>
				</div>
				<Show when={job().status !== 'queued' && job().status !== 'converting'}>
					<Button
						variant="ghost"
						size="icon"
						aria-label="Remove from list"
						title="Remove from list"
						onClick={() => props.removeJob(job().id)}
					>
						<Trash2 size={14} aria-hidden="true" />
					</Button>
				</Show>
			</div>
		</li>
	);
}

function JobStatusChip(props: { status: JobStatus }) {
	const label = (): string => {
		switch (props.status) {
			case 'probing':
				return 'Reading';
			case 'ready':
				return 'Ready';
			case 'queued':
				return 'Queued';
			case 'converting':
				return 'Converting';
			case 'done':
				return 'Done';
			case 'failed':
				return 'Failed';
			case 'unreadable':
				return 'Unreadable';
			case 'canceled':
				return 'Canceled';
		}
	};
	return (
		<span class="convert-chip" classList={{ [`convert-chip-${props.status}`]: true }}>
			{label()}
		</span>
	);
}
