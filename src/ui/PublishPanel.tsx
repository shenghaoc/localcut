import { monotonicNowMs } from '../time';
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { Radio, Square, X } from 'lucide-solid';
import { Button } from './components/button';
import type {
	CapabilityProbeResult,
	PublishEndpointType,
	PublishFailureReason,
	PublishSettingsDoc,
	PublishState
} from '../protocol';
import {
	ENDPOINT_GUIDANCE,
	clampPublishSettings,
	effectiveCodec,
	isValidWhipEndpointUrl
} from '../engine/publish-settings';
import { savePublishSettings } from '../engine/persistence';
import { livePublishAvailable } from '../engine/capability-probe-v2';
import type { PublishTapStats } from './publish-controller';

interface PublishPanelProps {
	open: boolean;
	mode?: 'dialog' | 'embedded';
	probe: CapabilityProbeResult | null;
	state: PublishState;
	settings: PublishSettingsDoc;
	settingsLoaded: boolean;
	tapStats: PublishTapStats | null;
	/** Tap/local error detail surfaced by the controller (never the token). */
	errorDetail: string | null;
	recordWhileStreamingAvailable: boolean;
	onSettingsChange: (settings: PublishSettingsDoc) => void;
	onGoLive: (settings: PublishSettingsDoc) => void;
	onStop: () => void;
	onClose: () => void;
	/** Opens the in-app user guide on the Live streaming section. */
	onOpenGuide: () => void;
}

const ENDPOINT_TYPES: readonly PublishEndpointType[] = [
	'twitch-whip',
	'cloudflare-whip',
	'mediamtx',
	'custom'
];

function failureMessage(reason: PublishFailureReason): string {
	switch (reason) {
		case 'rejected-offer':
			return 'The endpoint rejected the stream format (HTTP 400).';
		case 'auth':
			return 'The endpoint rejected the token — check your stream key.';
		case 'not-found':
			return 'Endpoint URL not found — check the WHIP URL.';
		case 'gave-up':
			return 'Reconnect attempts exhausted — check your network and go live again.';
		case 'budget-exhausted':
			return 'The encoder budget on this device is in use (export or recording in progress).';
		case 'unsupported':
			return 'Live publish is not supported in this browser.';
		case 'local-error':
			return 'Publishing stopped because of a local error.';
	}
}

function formatRtt(rttMs: number | null): string {
	return rttMs === null ? '—' : `${Math.round(rttMs)} ms`;
}

function stateLabel(state: PublishState): string {
	switch (state.phase) {
		case 'idle':
			return 'Not streaming';
		case 'connecting':
			return 'Connecting…';
		case 'live':
			return 'Live';
		case 'reconnecting':
			return `Reconnecting (attempt ${state.attempt})`;
		case 'ended':
			return 'Stream ended';
		case 'failed':
			return 'Stream failed';
	}
}

export function PublishPanel(props: PublishPanelProps) {
	const [retryRemainingS, setRetryRemainingS] = createSignal<number | null>(null);
	let panelRef: HTMLElement | undefined;
	const embedded = () => props.mode === 'embedded';
	const settings = () => props.settings;
	const settingsLoaded = () => props.settingsLoaded;

	createEffect(() => {
		if (props.open && !embedded()) {
			requestAnimationFrame(() => panelRef?.focus());
		}
	});

	// Next-retry countdown for the reconnecting state (R6.3).
	createEffect(() => {
		const state = props.state;
		if (state.phase !== 'reconnecting' || state.nextRetryMs <= 0) {
			setRetryRemainingS(null);
			return;
		}
		const deadline = monotonicNowMs() + state.nextRetryMs;
		setRetryRemainingS(Math.ceil(state.nextRetryMs / 1_000));
		const timer = setInterval(() => {
			setRetryRemainingS(Math.max(0, Math.ceil((deadline - monotonicNowMs()) / 1_000)));
		}, 500);
		onCleanup(() => clearInterval(timer));
	});

	const publishAvailable = createMemo(() => {
		const probe = props.probe;
		return probe !== null && livePublishAvailable(probe.livePublish);
	});

	const guidance = () => ENDPOINT_GUIDANCE[settings().endpointType];
	const av1Available = createMemo(
		() => props.probe?.codecs.av1Encode === 'supported' && guidance().allowsAv1
	);
	const keyframeControlAvailable = () => props.probe?.livePublish.generateKeyFrame === 'supported';
	const urlValid = () => isValidWhipEndpointUrl(settings().endpointUrl);
	const busy = () =>
		props.state.phase === 'connecting' ||
		props.state.phase === 'live' ||
		props.state.phase === 'reconnecting';

	function persist(next: PublishSettingsDoc) {
		// savePublishSettings sanitizes: the token is stripped unless the user
		// opted into remembering it on this device (R7.2).
		void savePublishSettings(clampPublishSettings(next)).catch(() => undefined);
	}

	function update(patch: Partial<PublishSettingsDoc>) {
		const next = { ...settings(), ...patch };
		props.onSettingsChange(next);
		persist(next);
	}

	function setEndpointType(endpointType: PublishEndpointType) {
		const nextGuidance = ENDPOINT_GUIDANCE[endpointType];
		const current = settings();
		update({
			endpointType,
			videoBitrateKbps: nextGuidance.defaultBitrateKbps,
			codec: nextGuidance.allowsAv1 ? current.codec : 'h264'
		});
	}

	function goLive() {
		const clamped = clampPublishSettings(settings());
		props.onSettingsChange(clamped);
		persist(clamped);
		props.onGoLive(clamped);
	}

	const statusDetail = createMemo<string | null>(() => {
		const state = props.state;
		if (state.phase === 'failed') return failureMessage(state.reason);
		if (state.phase === 'reconnecting') {
			const remaining = retryRemainingS();
			return remaining !== null && remaining > 0
				? `Next retry in ${remaining}s — playback continues locally.`
				: 'Retrying now — playback continues locally.';
		}
		if (state.phase === 'connecting') return 'Sending the offer to the WHIP endpoint…';
		return null;
	});

	return (
		<Show when={props.open}>
			<Show when={!embedded()}>
				<div class="capability-backdrop" onClick={() => props.onClose()} aria-hidden="true" />
			</Show>
			<aside
				ref={(el) => (panelRef = el)}
				class={embedded() ? 'publish-rail-panel panel' : 'publish-panel panel'}
				role={embedded() ? 'region' : 'dialog'}
				aria-modal={embedded() ? undefined : 'true'}
				aria-labelledby="publish-panel-title"
				tabIndex={-1}
				onKeyDown={(e) => {
					if (embedded()) return;
					if (e.key === 'Escape') {
						props.onClose();
						return;
					}
					if (e.key === 'Tab') {
						const panel = panelRef;
						if (!panel) return;
						const focusable = panel.querySelectorAll<HTMLElement>(
							'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
						);
						if (focusable.length === 0) return;
						const first = focusable[0]!;
						const last = focusable[focusable.length - 1]!;
						if (document.activeElement === panel) {
							e.preventDefault();
							(e.shiftKey ? last : first).focus();
							return;
						}
						if (e.shiftKey && document.activeElement === first) {
							e.preventDefault();
							last.focus();
						} else if (!e.shiftKey && document.activeElement === last) {
							e.preventDefault();
							first.focus();
						}
					}
				}}
			>
				<header class="publish-panel-header">
					<div>
						<p class="panel-title" id="publish-panel-title">
							<Radio size={14} aria-hidden="true" />
							Go Live (WHIP)
						</p>
						<p class="publish-panel-sub">Stream the program output to a WHIP ingest endpoint.</p>
					</div>
					<Show when={!embedded()}>
						<Button
							size="icon"
							variant="ghost"
							onClick={props.onClose}
							aria-label="Close publish panel"
						>
							<X size={16} aria-hidden="true" />
						</Button>
					</Show>
				</header>

				{/* Connection state — announced via an ARIA live region (R6.4). */}
				<div
					class={`publish-status is-${props.state.phase}`}
					role="status"
					aria-live="polite"
					aria-atomic="true"
				>
					<p class="publish-status-label">{stateLabel(props.state)}</p>
					<Show when={statusDetail()}>
						{(detail) => <p class="publish-status-detail">{detail()}</p>}
					</Show>
					<Show when={props.state.phase === 'live' ? props.state : null}>
						{(live) => (
							<dl class="publish-stats">
								<div>
									<dt>Bitrate</dt>
									<dd class="tabular-nums">
										{live().stats.bitrateKbps} / {settings().videoBitrateKbps} kbps
									</dd>
								</div>
								<div>
									<dt>RTT</dt>
									<dd class="tabular-nums">{formatRtt(live().stats.rttMs)}</dd>
								</div>
								<div>
									<dt>Frames sent</dt>
									<dd class="tabular-nums">{live().stats.framesSent}</dd>
								</div>
								<div>
									<dt>Frames dropped</dt>
									<dd class="tabular-nums">
										{props.tapStats?.framesDropped ?? live().stats.framesDropped}
									</dd>
								</div>
							</dl>
						)}
					</Show>
					<Show when={props.errorDetail}>
						{(detail) => <p class="publish-status-detail publish-error-detail">{detail()}</p>}
					</Show>
				</div>

				<Show
					when={publishAvailable()}
					fallback={
						<div class="publish-unavailable">
							<p class="export-note">
								{props.probe === null
									? 'Checking browser capabilities…'
									: 'Live publish is unavailable in this browser tier. Editing, preview, and export keep working — streaming simply stays hidden rather than failing mid-broadcast.'}
							</p>
							<Show when={props.probe !== null}>
								<ul class="publish-missing-list">
									<Show when={props.probe!.livePublish.rtcPeerConnection !== 'supported'}>
										<li>WebRTC (RTCPeerConnection) is not exposed here.</li>
									</Show>
									<Show when={props.probe!.livePublish.trackGeneratorWorker !== 'supported'}>
										<li>Insertable media streams (MediaStreamTrackGenerator) are unavailable.</li>
									</Show>
								</ul>
								<p class="export-note">
									A current Chromium-based desktop browser (Chrome or Edge) provides both.
								</p>
							</Show>
						</div>
					}
				>
					<form
						class="publish-form"
						onSubmit={(e) => {
							e.preventDefault();
							if (!busy() && urlValid()) goLive();
						}}
					>
						<p class="export-eyebrow">Destination</p>
						<label class="export-field publish-field-wide">
							<span>Endpoint type</span>
							<select
								class="export-select"
								value={settings().endpointType}
								disabled={busy() || !settingsLoaded()}
								onChange={(e) => setEndpointType(e.currentTarget.value as PublishEndpointType)}
							>
								<For each={ENDPOINT_TYPES}>
									{(type) => <option value={type}>{ENDPOINT_GUIDANCE[type].label}</option>}
								</For>
							</select>
						</label>
						<label class="export-field publish-field-wide">
							<span>WHIP endpoint URL</span>
							<input
								type="url"
								value={settings().endpointUrl}
								placeholder={guidance().urlHint}
								disabled={busy() || !settingsLoaded()}
								onInput={(e) => update({ endpointUrl: e.currentTarget.value.trim() })}
							/>
						</label>
						<Show when={settings().endpointUrl !== '' && !urlValid()}>
							<p class="export-error">Enter a full http(s) WHIP URL.</p>
						</Show>
						<label class="export-field publish-field-wide">
							<span>Bearer token (stream key)</span>
							<input
								type="password"
								autocomplete="off"
								value={settings().bearerToken ?? ''}
								disabled={busy()}
								onInput={(e) => update({ bearerToken: e.currentTarget.value || undefined })}
							/>
						</label>
						<label class="publish-checkbox">
							<input
								type="checkbox"
								checked={settings().rememberToken}
								disabled={busy()}
								onChange={(e) => update({ rememberToken: e.currentTarget.checked })}
							/>
							<span>Remember token on this device</span>
						</label>
						<p class="export-note publish-token-note">
							The token is kept for this session only unless remembered. Remembered tokens are
							stored unencrypted in this browser profile, like OBS stores stream keys.
						</p>

						<p class="export-eyebrow">Encoding</p>
						<div class="export-fields">
							<label class="export-field">
								<span>Video codec</span>
								<select
									class="export-select"
									value={effectiveCodec(settings(), props.probe?.codecs.av1Encode === 'supported')}
									disabled={busy()}
									onChange={(e) =>
										update({ codec: e.currentTarget.value === 'av1' ? 'av1' : 'h264' })
									}
								>
									<option value="h264">H.264 (default)</option>
									<option value="av1" disabled={!av1Available()}>
										AV1 (endpoint-dependent)
									</option>
								</select>
							</label>
							<label class="export-field">
								<span>Bitrate (kbps, max {guidance().maxBitrateKbps})</span>
								<input
									type="number"
									min="500"
									max={guidance().maxBitrateKbps}
									step="100"
									value={settings().videoBitrateKbps}
									disabled={busy()}
									onChange={(e) =>
										update({ videoBitrateKbps: Number(e.currentTarget.value) || 500 })
									}
								/>
							</label>
							<Show
								when={keyframeControlAvailable()}
								fallback={
									<div class="export-field">
										<span>Keyframe interval</span>
										<p class="publish-static-value">
											Platform default GOP (keyframe control unavailable in this browser)
										</p>
									</div>
								}
							>
								<label class="export-field">
									<span>Keyframe interval (s)</span>
									<input
										type="number"
										min="1"
										max="10"
										step="1"
										value={settings().keyframeIntervalS}
										disabled={busy()}
										onChange={(e) =>
											update({ keyframeIntervalS: Number(e.currentTarget.value) || 2 })
										}
									/>
								</label>
							</Show>
							<label class="export-field">
								<span>Resolution cap</span>
								<select
									class="export-select"
									value={settings().maxHeight === null ? 'none' : String(settings().maxHeight)}
									disabled={busy()}
									onChange={(e) =>
										update({
											maxHeight:
												e.currentTarget.value === 'none' ? null : Number(e.currentTarget.value)
										})
									}
								>
									<option value="1080">1080p</option>
									<option value="720">720p</option>
									<option value="none">Program resolution</option>
								</select>
							</label>
							<label class="export-field">
								<span>Frame-rate cap</span>
								<select
									class="export-select"
									value={settings().maxFps === null ? 'none' : String(settings().maxFps)}
									disabled={busy()}
									onChange={(e) =>
										update({
											maxFps:
												e.currentTarget.value === 'none' ? null : Number(e.currentTarget.value)
										})
									}
								>
									<option value="30">30 fps</option>
									<option value="60">60 fps</option>
									<option value="none">Program rate</option>
								</select>
							</label>
						</div>
						<Show when={!props.recordWhileStreamingAvailable}>
							<p class="export-note">
								The hardware encoder budget allows one session on this device — recording or
								exporting while streaming is unavailable.
							</p>
						</Show>

						<div class="publish-actions">
							<Show
								when={busy()}
								fallback={
									<Button
										variant="default"
										type="submit"
										disabled={!urlValid() || !settingsLoaded()}
									>
										<Radio size={14} aria-hidden="true" />
										Go Live
									</Button>
								}
							>
								<Button type="button" onClick={() => props.onStop()}>
									<Square size={14} aria-hidden="true" />
									Stop streaming
								</Button>
							</Show>
						</div>
					</form>
				</Show>

				<section class="publish-rtmp-note" aria-label="RTMP platforms">
					<p class="export-eyebrow">RTMP-only platforms</p>
					<p class="export-note">
						YouTube, Douyin, and Bilibili only accept RTMP ingest, which browsers cannot speak. To
						stream there, run your own WHIP→RTMP gateway such as MediaMTX and point this panel at
						its WHIP endpoint. LocalCut talks directly to the endpoint you configure and never
						operates relay infrastructure.
					</p>
					<button type="button" class="export-why-link" onClick={() => props.onOpenGuide()}>
						Open the Live Streaming guide
					</button>
				</section>
			</aside>
		</Show>
	);
}
