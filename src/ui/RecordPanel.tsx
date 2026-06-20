import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
	untrack
} from 'solid-js';
import { render } from 'solid-js/web';
import {
	Camera,
	Crop,
	MonitorUp,
	MousePointerClick,
	Mic,
	Pause,
	Play,
	RotateCcw,
	Square
} from 'lucide-solid';
import type {
	CapabilityProbeResult,
	CaptureSettingsSnapshot,
	CaptureSourceDescriptor,
	CaptureSourceKind,
	CaptureSourceStatusSnapshot,
	CaptureWebcamPipPresetSnapshot
} from '../protocol';
import { recordingAvailable, selectCaptureMode } from '../engine/capability-probe-v2';
import { captureUnavailableReasons } from '../engine/capture-reasons';
import { startCaptureFrameReader, type CaptureFrameReader } from './capture-frame-reader';
import {
	DEFAULT_CAPTURE_SETTINGS,
	loadCaptureSettings,
	saveCaptureSettings,
	type CaptureUxSettings
} from '../engine/persistence';
import type { WebcamPipPreset } from '../engine/capture/webcam-preset';
import { RecorderControlStrip, type RecorderStripSession } from './RecorderControlStrip';
import CaptureWriterWorker from '../engine/capture/writer-worker.ts?worker';

type CaptureStatusState = 'idle' | 'armed' | 'recording' | 'paused' | 'stopping';

export interface RecorderStatusSnapshot {
	state: CaptureStatusState;
	elapsedUs: number;
	bytesWritten: number;
	remainingSeconds: number | null;
	sources: CaptureSourceStatusSnapshot[];
}

interface LocalCaptureSource {
	descriptor: CaptureSourceDescriptor;
	track: MediaStreamTrack;
	stream: MediaStream;
	transferred: boolean;
}

interface RecordPanelProps {
	probe: CapabilityProbeResult | null;
	status: RecorderStatusSnapshot | null;
	retakeClipId: string | null;
	retakeSourceKinds: readonly CaptureSourceKind[];
	landedSessionId: string | null;
	/**
	 * Registers a source with the worker. `track` is non-null for the worker-track
	 * path (transferred via `transfer`); null for the main-frames fallback, where
	 * `transfer` is empty and frames arrive later through {@link RecordPanelProps.onPushFrame}.
	 */
	onAddSource: (
		source: CaptureSourceDescriptor,
		track: MediaStreamTrack | null,
		transfer: Transferable[]
	) => void;
	/** Forwards one main-thread-read frame to the worker (main-frames fallback). */
	onPushFrame: (sourceId: string, frame: VideoFrame | AudioData) => void;
	onStart: (
		settings: CaptureSettingsSnapshot,
		writerPort: MessagePort,
		retakeClipId: string | null,
		transfer: Transferable[]
	) => void;
	onPause: () => void;
	onResume: () => void;
	onStop: () => void;
	onApplyRegion: (sourceId: string, mode: 'crop' | 'element') => void;
	onRetakeCleared: () => void;
}

type DocumentPictureInPictureApi = {
	requestWindow(options: { width: number; height: number }): Promise<Window>;
	window?: Window | null;
};

type RegionTargetApi = {
	fromElement(element: Element): Promise<unknown>;
};

type RegionTrack = MediaStreamTrack & {
	cropTo?: (target: unknown) => Promise<void>;
	restrictTo?: (target: unknown) => Promise<void>;
};

function documentPipApi(): DocumentPictureInPictureApi | null {
	const candidate = (globalThis as unknown as Record<string, unknown>).documentPictureInPicture;
	if (
		typeof candidate === 'object' &&
		candidate !== null &&
		typeof (candidate as DocumentPictureInPictureApi).requestWindow === 'function'
	) {
		return candidate as DocumentPictureInPictureApi;
	}
	return null;
}

function regionApi(name: 'CropTarget' | 'RestrictionTarget'): RegionTargetApi | null {
	const candidate = (globalThis as unknown as Record<string, unknown>)[name];
	if (
		typeof candidate === 'function' &&
		typeof (candidate as unknown as RegionTargetApi).fromElement === 'function'
	) {
		return candidate as unknown as RegionTargetApi;
	}
	if (
		typeof candidate === 'object' &&
		candidate !== null &&
		typeof (candidate as RegionTargetApi).fromElement === 'function'
	) {
		return candidate as RegionTargetApi;
	}
	return null;
}

function makeSourceId(kind: CaptureSourceKind): string {
	const suffix =
		typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: Math.random().toString(36).slice(2);
	return `capture-${kind}-${suffix}`;
}

function descriptorForTrack(
	kind: CaptureSourceKind,
	label: string,
	track: MediaStreamTrack
): CaptureSourceDescriptor {
	const settings = track.getSettings();
	return {
		sourceId: makeSourceId(kind),
		kind,
		label,
		width: settings.width,
		height: settings.height,
		frameRate: settings.frameRate ?? null
	};
}

function displaySession(state: CaptureStatusState | 'countdown'): RecorderStripSession {
	return state === 'countdown' || state === 'armed' ? 'recording' : state;
}

function stripStyle(active: boolean): string {
	return active ? 'display: none;' : '';
}

function monitorTileStyle(preset: WebcamPipPreset): string {
	const width = preset.size === 'S' ? 20 : preset.size === 'M' ? 30 : 40;
	const margin = `${preset.marginPx}px`;
	const horizontal = preset.corner.endsWith('right') ? `right: ${margin};` : `left: ${margin};`;
	const vertical = preset.corner.startsWith('bottom') ? `bottom: ${margin};` : `top: ${margin};`;
	return `width: ${width}%; ${horizontal} ${vertical}`;
}

function sourceKindLabel(kind: CaptureSourceKind): string {
	switch (kind) {
		case 'screen':
			return 'screen';
		case 'webcam':
			return 'camera';
		case 'mic':
			return 'microphone';
		case 'system-audio':
			return 'tab/system audio';
	}
}

export function RecordPanel(props: RecordPanelProps) {
	const [settings, setSettings] = createSignal<CaptureUxSettings>(DEFAULT_CAPTURE_SETTINGS);
	const [settingsReady, setSettingsReady] = createSignal(false);
	const [sources, setSources] = createSignal<LocalCaptureSource[]>([]);
	const [countdownRemaining, setCountdownRemaining] = createSignal<number | null>(null);
	const [documentPipActive, setDocumentPipActive] = createSignal(false);
	const [message, setMessage] = createSignal<string | null>(null);
	const [includeSystemAudio, setIncludeSystemAudio] = createSignal(false);
	const [regionPickMode, setRegionPickMode] = createSignal<'crop' | 'element' | null>(null);
	const [accumulatedPausedUs, setAccumulatedPausedUs] = createSignal(0);
	const [pausedStartedAtMs, setPausedStartedAtMs] = createSignal<number | null>(null);
	const [pauseTicker, setPauseTicker] = createSignal(0);

	let countdownTimer: ReturnType<typeof setInterval> | null = null;
	let pauseTimer: ReturnType<typeof setInterval> | null = null;
	let pipDispose: (() => void) | null = null;
	let pipWindow: Window | null = null;
	let writerWorker: Worker | null = null;
	// Main-frames fallback (bugfix B5/T5.5): one main-thread MSTP reader per source,
	// keyed by sourceId, forwarding frames to the worker push pipeline.
	const frameReaders = new Map<string, CaptureFrameReader>();
	let regionClickHandler: ((event: MouseEvent) => void) | null = null;
	let previousStatusState: CaptureStatusState | null = null;
	let currentRetakeClipId: string | null = null;
	let autoRetakeStartedFor: string | null = null;

	const status = createMemo(() => props.status);
	const sessionState = createMemo<CaptureStatusState | 'countdown'>(() =>
		countdownRemaining() !== null ? 'countdown' : (status()?.state ?? 'idle')
	);
	const active = createMemo(() => {
		const state = sessionState();
		return state === 'recording' || state === 'paused' || state === 'stopping';
	});
	const canRecord = createMemo(() => (props.probe ? recordingAvailable(props.probe) : false));
	// Worker-track when Transferable MediaStreamTrack is available; otherwise the
	// off-main-thread main-frames fallback (bugfix B5/T5.5). Default to worker-track
	// until the probe lands so the optimistic path is assumed.
	const captureMode = createMemo(() =>
		props.probe ? selectCaptureMode(props.probe) : 'worker-track'
	);
	const statusSources = createMemo(() => status()?.sources ?? []);
	const hasWebcam = createMemo(
		() =>
			sources().some((source) => source.descriptor.kind === 'webcam') ||
			statusSources().some((source) => source.kind === 'webcam')
	);
	const missingRetakeSourceKinds = createMemo(() => {
		if (!props.retakeClipId) return [] as CaptureSourceKind[];
		const remaining = [...props.retakeSourceKinds];
		for (const source of sources()) {
			const index = remaining.indexOf(source.descriptor.kind);
			if (index >= 0) remaining.splice(index, 1);
		}
		return remaining;
	});
	const canStart = createMemo(
		() =>
			canRecord() &&
			sources().length > 0 &&
			missingRetakeSourceKinds().length === 0 &&
			countdownRemaining() === null &&
			!active()
	);
	const elapsedUs = createMemo(() => status()?.elapsedUs ?? 0);
	const pausedUs = createMemo(() => {
		pauseTicker();
		const startedAt = pausedStartedAtMs();
		const activePauseUs =
			startedAt === null ? 0 : Math.max(0, Math.round((performance.now() - startedAt) * 1000));
		return accumulatedPausedUs() + activePauseUs;
	});
	const ownTabSource = createMemo(() =>
		sources().find((source) => source.descriptor.kind === 'screen')
	);

	onMount(() => {
		void loadCaptureSettings().then((persisted) => {
			setSettings(persisted);
			setSettingsReady(true);
		});
		const keydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && countdownRemaining() !== null) {
				clearCountdown();
			}
		};
		window.addEventListener('keydown', keydown);
		onCleanup(() => window.removeEventListener('keydown', keydown));
	});

	createEffect(() => {
		if (!settingsReady()) return;
		const current = settings();
		void saveCaptureSettings(current).catch(() => undefined);
	});

	createEffect(() => {
		const state = status()?.state ?? 'idle';
		if (state === previousStatusState) return;
		const now = performance.now();
		if (state === 'paused') {
			setPausedStartedAtMs(now);
			startPauseTimer();
		}
		if (previousStatusState === 'paused' && state !== 'paused') {
			const startedAt = pausedStartedAtMs();
			if (startedAt !== null) {
				setAccumulatedPausedUs(
					(current) => current + Math.max(0, Math.round((now - startedAt) * 1000))
				);
			}
			setPausedStartedAtMs(null);
			stopPauseTimer();
		}
		if (state === 'idle') {
			setAccumulatedPausedUs(0);
			setPausedStartedAtMs(null);
			stopPauseTimer();
		}
		previousStatusState = state;
	});

	createEffect(() => {
		if (props.landedSessionId) {
			cleanupSessionUi();
			untrack(resetLocalSources);
		}
	});

	createEffect(() => {
		const retakeId = props.retakeClipId;
		if (retakeId === currentRetakeClipId) return;
		currentRetakeClipId = retakeId;
		autoRetakeStartedFor = null;
		if (retakeId) {
			untrack(resetLocalSources);
			setMessage('Retake armed. Add matching fresh sources to start.');
		}
	});

	createEffect(() => {
		const retakeId = props.retakeClipId;
		if (!retakeId || autoRetakeStartedFor === retakeId || !canStart()) return;
		autoRetakeStartedFor = retakeId;
		startRequested();
	});

	createEffect(() => {
		if (sessionState() === 'recording' && !documentPipActive()) {
			void openDocumentPip();
		}
		if (sessionState() === 'idle') {
			cleanupSessionUi();
		}
	});

	onCleanup(() => {
		clearCountdown();
		stopPauseTimer();
		clearRegionPick();
		cleanupSessionUi();
		resetLocalSources();
	});

	function resetLocalSources(): void {
		stopAllReaders();
		const current = sources();
		if (current.length === 0) return;
		for (const source of current) {
			source.stream.getTracks().forEach((track) => {
				try {
					track.stop();
				} catch {
					// best-effort source cleanup
				}
			});
		}
		setSources([]);
	}

	function updateSettings(patch: Partial<CaptureUxSettings>): void {
		setSettings((prev) => ({
			countdownS: patch.countdownS ?? prev.countdownS,
			webcamPreset: patch.webcamPreset ?? prev.webcamPreset
		}));
	}

	function updateWebcamPreset(patch: Partial<CaptureWebcamPipPresetSnapshot>): void {
		setSettings((prev) => ({
			...prev,
			webcamPreset: {
				...prev.webcamPreset,
				...patch,
				marginPx: Math.max(0, Math.min(64, patch.marginPx ?? prev.webcamPreset.marginPx))
			}
		}));
	}

	async function addScreen(): Promise<void> {
		if (!navigator.mediaDevices?.getDisplayMedia) {
			setMessage('Display capture is unavailable in this browser.');
			return;
		}
		const stream = await navigator.mediaDevices.getDisplayMedia({
			video: true,
			audio: includeSystemAudio()
		});
		const videoTrack = stream.getVideoTracks()[0];
		if (videoTrack) {
			addLocalSource(
				descriptorForTrack('screen', videoTrack.label || 'Screen', videoTrack),
				videoTrack,
				stream
			);
		}
		const audioTrack = stream.getAudioTracks()[0];
		if (audioTrack) {
			addLocalSource(
				descriptorForTrack('system-audio', audioTrack.label || 'Tab audio', audioTrack),
				audioTrack,
				stream
			);
		}
	}

	async function addCamera(): Promise<void> {
		const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
		const track = stream.getVideoTracks()[0];
		if (!track) throw new Error('No camera video track was returned.');
		addLocalSource(descriptorForTrack('webcam', track.label || 'Camera', track), track, stream);
	}

	async function addMic(): Promise<void> {
		const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
		const track = stream.getAudioTracks()[0];
		if (!track) throw new Error('No microphone audio track was returned.');
		addLocalSource(descriptorForTrack('mic', track.label || 'Microphone', track), track, stream);
	}

	function addLocalSource(
		descriptor: CaptureSourceDescriptor,
		track: MediaStreamTrack,
		stream: MediaStream
	): void {
		const local: LocalCaptureSource = { descriptor, track, stream, transferred: false };
		setSources((prev) => [...prev, local]);
		if (active()) transferSource(local);
	}

	function transferSource(source: LocalCaptureSource): void {
		if (source.transferred) return;
		if (captureMode() === 'main-frames') {
			// Trackless push pipeline: keep the track on main, register the source
			// without it, then forward frames via the worker push message. Frames read
			// before capture-start lands are dropped/closed worker-side (the next
			// encoded frame is a key frame regardless), so no extra ordering is needed.
			props.onAddSource(source.descriptor, null, []);
			startReaderFor(source);
		} else {
			props.onAddSource(source.descriptor, source.track, [source.track]);
		}
		setSources((prev) =>
			prev.map((candidate) =>
				candidate.descriptor.sourceId === source.descriptor.sourceId
					? { ...candidate, transferred: true }
					: candidate
			)
		);
	}

	function startReaderFor(source: LocalCaptureSource): void {
		const sourceId = source.descriptor.sourceId;
		if (frameReaders.has(sourceId)) return;
		// Read the stable callback prop into a local so the forwarding closure carries
		// no reactivity into the (untracked) reader loop.
		const pushFrame = props.onPushFrame;
		frameReaders.set(
			sourceId,
			startCaptureFrameReader(
				source.track,
				(frame) => pushFrame(sourceId, frame),
				(error) =>
					setMessage(
						`Capture frame reader stopped: ${error instanceof Error ? error.message : String(error)}`
					)
			)
		);
	}

	function stopAllReaders(): void {
		for (const reader of frameReaders.values()) reader.stop();
		frameReaders.clear();
	}

	function clearCountdown(): void {
		if (countdownTimer) clearInterval(countdownTimer);
		countdownTimer = null;
		setCountdownRemaining(null);
	}

	function startPauseTimer(): void {
		if (pauseTimer) return;
		pauseTimer = setInterval(() => setPauseTicker((current) => current + 1), 500);
	}

	function stopPauseTimer(): void {
		if (pauseTimer) clearInterval(pauseTimer);
		pauseTimer = null;
	}

	function startRequested(): void {
		if (!canStart()) return;
		const countdownS = settings().countdownS;
		if (countdownS === 0) {
			beginRecording();
			return;
		}
		setCountdownRemaining(countdownS);
		countdownTimer = setInterval(() => {
			setCountdownRemaining((current) => {
				if (current === null) return null;
				if (current <= 1) {
					clearCountdown();
					beginRecording();
					return null;
				}
				return current - 1;
			});
		}, 1000);
	}

	function beginRecording(): void {
		// Register every source with the worker. In the worker-track path this
		// transfers the source track in; in the main-frames fallback (bugfix B5/T5.5)
		// it registers a trackless push pipeline and starts a main-thread reader that
		// forwards frames to the worker encoder (see transferSource/selectCaptureMode).
		for (const source of sources()) transferSource(source);
		writerWorker?.terminate();
		writerWorker = new CaptureWriterWorker();
		const channel = new MessageChannel();
		writerWorker.postMessage({ type: 'init', port: channel.port1 }, [channel.port1]);
		props.onStart(
			{
				chunkDurationS: 2,
				videoCodec: 'avc1.64002a',
				audioCodec: 'mp4a.40.2',
				videoBitrate: 5_000_000,
				canvasWidth: 1920,
				canvasHeight: 1080,
				webcamPreset: settings().webcamPreset
			},
			channel.port2,
			props.retakeClipId,
			[channel.port2]
		);
		props.onRetakeCleared();
	}

	function stopRecording(): void {
		// Stop main-thread readers promptly so we stop forwarding frames the moment
		// the user stops; the worker flushes the encoders on capture-stop.
		stopAllReaders();
		props.onStop();
		closeDocumentPip();
	}

	function cleanupSessionUi(): void {
		stopAllReaders();
		closeDocumentPip();
		writerWorker?.terminate();
		writerWorker = null;
	}

	async function openDocumentPip(): Promise<void> {
		if (props.probe?.captureUx?.documentPip !== 'supported') return;
		const api = documentPipApi();
		if (!api) return;
		try {
			const win = await api.requestWindow({ width: 320, height: 80 });
			pipWindow = win;
			win.document.body.className = 'recorder-pip-body';
			pipDispose = render(
				() => (
					<RecorderControlStrip
						session={displaySession(sessionState())}
						elapsedUs={elapsedUs()}
						pausedUs={pausedUs()}
						testId="recorder-control-strip-pip"
						onPause={props.onPause}
						onResume={props.onResume}
						onStop={stopRecording}
					/>
				),
				win.document.body
			);
			const pagehide = () => {
				pipDispose?.();
				pipDispose = null;
				pipWindow = null;
				setDocumentPipActive(false);
			};
			win.addEventListener('pagehide', pagehide, { once: true });
			setDocumentPipActive(true);
		} catch {
			setDocumentPipActive(false);
		}
	}

	function closeDocumentPip(): void {
		pipDispose?.();
		pipDispose = null;
		try {
			pipWindow?.close();
		} catch {
			// Window may already be gone.
		}
		pipWindow = null;
		setDocumentPipActive(false);
	}

	async function applyRegion(mode: 'crop' | 'element'): Promise<void> {
		const source = ownTabSource();
		if (!source) return;
		clearRegionPick();
		setRegionPickMode(mode);
		setMessage(mode === 'crop' ? 'Click an element to crop to.' : 'Click an element to isolate.');
		const clickHandler = async (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			document.removeEventListener('click', clickHandler, true);
			regionClickHandler = null;
			const element = event.target instanceof Element ? event.target : null;
			const api = regionApi(mode === 'crop' ? 'CropTarget' : 'RestrictionTarget');
			try {
				if (!element || !api) throw new Error('Region capture API unavailable.');
				const target = await api.fromElement(element);
				const track = source.track as RegionTrack;
				if (mode === 'crop') {
					if (!track.cropTo) throw new Error('cropTo is unavailable on this track.');
					await track.cropTo(target);
				} else {
					if (!track.restrictTo) throw new Error('restrictTo is unavailable on this track.');
					await track.restrictTo(target);
				}
				props.onApplyRegion(source.descriptor.sourceId, mode);
				setMessage(mode === 'crop' ? 'Region capture applied.' : 'Element capture applied.');
			} catch (error) {
				setMessage(error instanceof Error ? error.message : String(error));
			} finally {
				setRegionPickMode(null);
			}
		};
		document.addEventListener('click', clickHandler, true);
		regionClickHandler = clickHandler;
	}

	function clearRegionPick(): void {
		if (regionClickHandler) {
			document.removeEventListener('click', regionClickHandler, true);
		}
		regionClickHandler = null;
		setRegionPickMode(null);
	}

	return (
		<section class="record-panel" aria-labelledby="record-panel-title">
			<div class="panel-heading-row">
				<h2 id="record-panel-title" class="panel-title">
					Record
				</h2>
				<Show when={props.retakeClipId}>
					<span class="record-retake-badge">Retake</span>
				</Show>
			</div>
			<div class="record-live-region" aria-live="polite">
				{sessionState() === 'countdown'
					? `Recording starts in ${countdownRemaining()}`
					: `Recorder ${sessionState()}`}
			</div>

			<Show when={props.retakeClipId}>
				<div class="record-retake-note">
					<strong>Retake armed</strong>
					<Show
						when={missingRetakeSourceKinds().length > 0}
						fallback={<span>Fresh retake sources are ready. Countdown will start now.</span>}
					>
						<span>
							Add {missingRetakeSourceKinds().map(sourceKindLabel).join(', ')} to match the original
							recording.
						</span>
					</Show>
				</div>
			</Show>

			<Show when={!canRecord()}>
				<div class="record-disabled-note">
					<p>Recording is unavailable on this browser profile.</p>
					<ul>
						<For
							each={
								props.probe
									? // Transferable MediaStreamTrack is not required for recording — the
										// main-frames fallback covers it — so it is never a blocking reason here.
										captureUnavailableReasons(props.probe, { requireTransferableTrack: false })
									: ['Checking browser capabilities…']
							}
						>
							{(reason) => <li>{reason}</li>}
						</For>
					</ul>
				</div>
			</Show>

			<Show when={canRecord() && captureMode() === 'main-frames'}>
				<div class="record-compat-note" role="note">
					<p>
						<strong>Compatibility recording mode.</strong> Transferable MediaStreamTrack is
						unavailable, so frames are read on the main thread and forwarded to the encoder.
						Recording works; for best performance enable{' '}
						<code>chrome://flags/#enable-experimental-web-platform-features</code> and reload.
					</p>
				</div>
			</Show>

			<div class="record-section">
				<h3>Sources</h3>
				<div class="record-source-actions">
					<button type="button" onClick={() => void addScreen()} disabled={!canRecord()}>
						<MonitorUp size={16} aria-hidden="true" />
						Add screen
					</button>
					<button type="button" onClick={() => void addCamera()} disabled={!canRecord()}>
						<Camera size={16} aria-hidden="true" />
						Camera
					</button>
					<button type="button" onClick={() => void addMic()} disabled={!canRecord()}>
						<Mic size={16} aria-hidden="true" />
						Mic
					</button>
				</div>
				<label class="record-checkbox">
					<input
						type="checkbox"
						checked={includeSystemAudio()}
						onChange={(event) => setIncludeSystemAudio(event.currentTarget.checked)}
					/>
					Tab/system audio with screen
				</label>
				<div class="record-source-list">
					<For
						each={
							statusSources().length > 0
								? statusSources().map((source) => ({
										id: source.sourceId,
										label: source.label,
										kind: source.kind,
										state: source.state,
										bytesWritten: source.bytesWritten
									}))
								: sources().map((source) => ({
										id: source.descriptor.sourceId,
										label: source.descriptor.label,
										kind: source.descriptor.kind,
										state: source.transferred ? 'capturing' : 'ready',
										bytesWritten: 0
									}))
						}
					>
						{(source) => (
							<div class="record-source-chip">
								<span>{source.label}</span>
								<small>
									{source.kind} · {source.state}
								</small>
							</div>
						)}
					</For>
				</div>
			</div>

			<div class="record-section">
				<h3>Countdown</h3>
				<div class="record-segmented" role="radiogroup" aria-label="Countdown duration">
					<For each={[0, 3, 5] as const}>
						{(value) => (
							<label>
								<input
									type="radio"
									name="capture-countdown"
									checked={settings().countdownS === value}
									onChange={() => updateSettings({ countdownS: value })}
								/>
								{value}s
							</label>
						)}
					</For>
				</div>
			</div>

			<Show when={hasWebcam()}>
				<div class="record-section">
					<h3>Webcam Layout</h3>
					<div class="record-layout-preview">
						<div class="record-layout-tile" style={monitorTileStyle(settings().webcamPreset)} />
					</div>
					<div class="record-corner-grid" aria-label="Webcam corner">
						<For
							each={
								[
									['top-left', '↖'],
									['top-right', '↗'],
									['bottom-left', '↙'],
									['bottom-right', '↘']
								] as const
							}
						>
							{([corner, label]) => (
								<button
									type="button"
									aria-label={`Webcam ${corner}`}
									aria-pressed={settings().webcamPreset.corner === corner}
									onClick={() => updateWebcamPreset({ corner })}
								>
									{label}
								</button>
							)}
						</For>
					</div>
					<div class="record-segmented" role="radiogroup" aria-label="Webcam size">
						<For each={['S', 'M', 'L'] as const}>
							{(size) => (
								<label>
									<input
										type="radio"
										name="capture-webcam-size"
										checked={settings().webcamPreset.size === size}
										onChange={() => updateWebcamPreset({ size })}
									/>
									{size}
								</label>
							)}
						</For>
					</div>
					<label class="record-number-row">
						Margin
						<input
							type="number"
							min="0"
							max="64"
							step="4"
							value={settings().webcamPreset.marginPx}
							onInput={(event) =>
								updateWebcamPreset({ marginPx: Number(event.currentTarget.value) })
							}
						/>
					</label>
				</div>
			</Show>

			<div class="record-section">
				<h3>Experimental</h3>
				<div class="record-source-actions">
					<Show when={props.probe?.captureUx?.cropTarget === 'supported'}>
						<button
							type="button"
							onClick={() => void applyRegion('crop')}
							disabled={!ownTabSource() || regionPickMode() !== null}
							title={ownTabSource() ? undefined : 'Add a Tab source first'}
						>
							<Crop size={16} aria-hidden="true" />
							Own tab (Region)
						</button>
					</Show>
					<Show when={props.probe?.captureUx?.elementCapture === 'supported'}>
						<button
							type="button"
							onClick={() => void applyRegion('element')}
							disabled={!ownTabSource() || regionPickMode() !== null}
							title={ownTabSource() ? undefined : 'Add a Tab source first'}
						>
							<MousePointerClick size={16} aria-hidden="true" />
							Own tab (Element)
						</button>
					</Show>
				</div>
				<Show when={message()}>
					<p class="record-panel-message">{message()}</p>
				</Show>
			</div>

			<div class="record-primary-actions">
				<Show
					when={sessionState() === 'idle' || sessionState() === 'countdown'}
					fallback={
						<>
							<Show when={sessionState() === 'recording'}>
								<button type="button" onClick={props.onPause}>
									<Pause size={16} aria-hidden="true" />
									Pause
								</button>
							</Show>
							<Show when={sessionState() === 'paused'}>
								<button type="button" onClick={props.onResume}>
									<Play size={16} aria-hidden="true" />
									Resume
								</button>
							</Show>
							<button
								type="button"
								onClick={stopRecording}
								disabled={sessionState() === 'stopping'}
							>
								<Square size={16} aria-hidden="true" />
								Stop
							</button>
						</>
					}
				>
					<button type="button" onClick={startRequested} disabled={!canStart()}>
						<Show when={props.retakeClipId} fallback={<Play size={16} aria-hidden="true" />}>
							<RotateCcw size={16} aria-hidden="true" />
						</Show>
						{props.retakeClipId ? 'Start retake' : 'Start'}
					</button>
					<Show when={countdownRemaining() !== null}>
						<button type="button" onClick={clearCountdown}>
							Cancel
						</button>
					</Show>
				</Show>
			</div>

			<Show when={countdownRemaining() !== null}>
				<div class="record-countdown-overlay" role="dialog" aria-modal="true">
					<div class="record-countdown-number" aria-live="assertive">
						{countdownRemaining()}
					</div>
					<button type="button" onClick={clearCountdown}>
						Cancel
					</button>
				</div>
			</Show>

			<div class="recorder-inpage-strip" style={stripStyle(documentPipActive())}>
				<RecorderControlStrip
					session={displaySession(sessionState())}
					elapsedUs={elapsedUs()}
					pausedUs={pausedUs()}
					testId="recorder-control-strip-inpage"
					onPause={props.onPause}
					onResume={props.onResume}
					onStop={stopRecording}
				/>
			</div>
		</section>
	);
}
