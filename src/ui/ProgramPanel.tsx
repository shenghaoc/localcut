/**
 * ProgramPanel — Program Mode UI for source acquisition, scene editing,
 * and session control.
 *
 * Phase 45: Live Scenes. Gated on `probe.programMode === 'supported'`.
 * Never hides the entry point silently; disabled state lists per-probe
 * reasons when unavailable.
 */

import { For, Show, createMemo } from 'solid-js';
import type {
	SceneDefinition,
	SceneLayer,
	ProgramSourceDescriptor,
	ProgramSourceStatusSnapshot,
	FeatureSupport,
	CapabilityProbeResult
} from '../protocol';
import { captureUnavailableReasons } from '../engine/capture-reasons';
import { CaptureUnavailableNotice } from './CaptureUnavailableNotice';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProgramPanelProps {
	/** Program mode capability from the probe. */
	programMode: () => FeatureSupport;
	/** Full capability probe result for dynamic unavailable reasons. */
	probe: CapabilityProbeResult | null;
	/** Current scenes from the project. */
	scenes: () => readonly SceneDefinition[];
	/** Session state: idle, armed, running, stopping. */
	sessionState: () => 'idle' | 'armed' | 'running' | 'stopping';
	/** Active scene ID during a running session. */
	activeSceneId: () => string | null;
	/** Per-source status during a running session. */
	sourceStatus: () => readonly ProgramSourceStatusSnapshot[];
	/** Encoder budget: current usage / max. */
	budgetUsage: () => { active: number; max: number };
	/** Acquired sources before session start. */
	acquiredSources: () => readonly ProgramSourceDescriptor[];
	/** Error message to display. */
	error: () => string | null;
	/** Scene switch transition mode. */
	transitionMs: () => 0 | 200;

	// Actions
	onAddScreen: () => void;
	onAddCamera: (deviceId: string) => void;
	onAddMic: (deviceId: string) => void;
	onRemoveSource: (sourceId: string) => void;
	onAddScene: () => void;
	onRemoveScene: (sceneId: string) => void;
	onRenameScene: (sceneId: string, name: string) => void;
	onSetHotkey: (sceneId: string, hotkey: string | null) => void;
	onUpdateLayers: (sceneId: string, layers: SceneLayer[]) => void;
	onSetTransitionMs: (transitionMs: 0 | 200) => void;
	onStart: (initialSceneId: string) => void;
	onStop: () => void;
	onSwitchScene: (sceneId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProgramPanel(props: ProgramPanelProps) {
	const isDisabled = createMemo(() => props.programMode() !== 'supported');
	const isIdle = createMemo(() => props.sessionState() === 'idle');
	const isRunning = createMemo(
		() => props.sessionState() === 'running' || props.sessionState() === 'armed'
	);
	const canStart = createMemo(
		() => isIdle() && props.acquiredSources().length > 0 && props.scenes().length > 0
	);

	const handleKeydown = (e: KeyboardEvent) => {
		if (!isRunning()) return;
		if (
			e.target instanceof HTMLElement &&
			e.target.closest('input, textarea, select, button, [contenteditable="true"]')
		) {
			return;
		}
		const key = e.key;
		if (HOTKEYS.includes(key as (typeof HOTKEYS)[number])) {
			const scene = props.scenes().find((s) => s.hotkey === key);
			if (scene) {
				e.preventDefault();
				e.stopPropagation();
				props.onSwitchScene(scene.id);
			}
		}
	};

	// Exhaustive reasons (tier + capture gates) so the disabled panel always has at
	// least one actionable line — including reduced-tier profiles where the capture
	// probes pass but isolation/SAB/OffscreenCanvas/WebGPU do not. The trailing
	// fallback is defensive: captureUnavailableReasons is exhaustive for the
	// core-webgpu gates that gate programMode, so an empty list shouldn't occur,
	// but the panel must never render a header with no reason.
	const disabledReasons = createMemo(() => {
		if (!props.probe) return [];
		const reasons = captureUnavailableReasons(props.probe);
		return reasons.length > 0 ? reasons : ['Required capabilities are missing.'];
	});

	return (
		<Show
			when={!isDisabled()}
			fallback={
				<div class="program-panel program-panel--disabled" role="region" aria-label="Program Mode">
					<h3>Program Mode</h3>
					<Show
						when={props.probe}
						fallback={<p class="program-panel-disabled-reason">Checking browser capabilities…</p>}
					>
						<CaptureUnavailableNotice subject="Program Mode" reasons={disabledReasons()} />
					</Show>
				</div>
			}
		>
			<div
				class="program-panel"
				role="region"
				aria-label="Program Mode"
				tabIndex={0}
				onKeyDown={handleKeydown}
			>
				<h3 class="program-panel-title">Program Mode</h3>

				{/* Error display */}
				<Show when={props.error()}>
					<div class="program-panel-error" role="alert">
						{props.error()}
					</div>
				</Show>

				{/* Source acquisition (idle only) */}
				<Show when={isIdle()}>
					<div class="program-panel-sources" role="group" aria-label="Sources">
						<h4>Sources</h4>
						<div class="program-panel-source-actions">
							<button
								type="button"
								class="program-panel-btn"
								onClick={() => props.onAddScreen()}
								aria-label="Add screen source"
							>
								+ Screen
							</button>
							<button
								type="button"
								class="program-panel-btn"
								onClick={() => props.onAddCamera('')}
								aria-label="Add camera source"
							>
								+ Camera
							</button>
							<button
								type="button"
								class="program-panel-btn"
								onClick={() => props.onAddMic('')}
								aria-label="Add microphone"
							>
								+ Mic
							</button>
						</div>
						<For each={props.acquiredSources()}>
							{(source) => (
								<div class="program-panel-source-row">
									<span class="program-panel-source-kind">{source.kind}</span>
									<span class="program-panel-source-label">{source.label}</span>
									<button
										type="button"
										class="program-panel-remove-btn"
										onClick={() => props.onRemoveSource(source.sourceId)}
										aria-label={`Remove ${source.label}`}
									>
										×
									</button>
								</div>
							)}
						</For>
					</div>
				</Show>

				{/* Scene editor */}
				<div class="program-panel-scenes" role="group" aria-label="Scenes">
					<div class="program-panel-scenes-header">
						<h4>Scenes</h4>
						<Show when={isIdle()}>
							<button
								type="button"
								class="program-panel-btn"
								onClick={() => props.onAddScene()}
								disabled={props.scenes().length >= 9}
								aria-label="Add scene"
							>
								+ Scene
							</button>
						</Show>
					</div>
					<For each={props.scenes()}>
						{(scene) => (
							<div
								class="program-panel-scene-row"
								classList={{
									'program-panel-scene--active': isRunning() && props.activeSceneId() === scene.id
								}}
							>
								<Show
									when={isIdle()}
									fallback={
										<button
											type="button"
											class="program-panel-scene-switch-btn"
											onClick={() => props.onSwitchScene(scene.id)}
											aria-pressed={props.activeSceneId() === scene.id}
											disabled={props.sessionState() === 'stopping'}
										>
											{scene.hotkey ? `[${scene.hotkey}] ` : ''}
											{scene.name}
										</button>
									}
								>
									<input
										type="text"
										class="program-panel-scene-name-input"
										value={scene.name}
										onChange={(e) => props.onRenameScene(scene.id, e.currentTarget.value)}
										aria-label={`Scene name for ${scene.name}`}
									/>
									<select
										class="program-panel-hotkey-select"
										value={scene.hotkey ?? ''}
										onChange={(e) => props.onSetHotkey(scene.id, e.currentTarget.value || null)}
										aria-label={`Hotkey for ${scene.name}`}
									>
										<option value="">No hotkey</option>
										<For each={HOTKEYS}>{(key) => <option value={key}>{key}</option>}</For>
									</select>
									<button
										type="button"
										class="program-panel-remove-btn"
										onClick={() => props.onRemoveScene(scene.id)}
										aria-label={`Remove scene ${scene.name}`}
									>
										×
									</button>
								</Show>
							</div>
						)}
					</For>
				</div>

				{/* Budget display */}
				<div class="program-panel-budget" role="status" aria-live="polite" aria-atomic="true">
					<span>
						Encoder budget: {props.budgetUsage().active} / {props.budgetUsage().max}
					</span>
				</div>

				<div class="program-panel-options" role="group" aria-label="Program transition options">
					<label class="program-panel-toggle">
						<input
							type="checkbox"
							checked={props.transitionMs() === 200}
							onChange={(event) => props.onSetTransitionMs(event.currentTarget.checked ? 200 : 0)}
						/>
						<span>Crossfade scene switches</span>
					</label>
				</div>

				{/* Start/Stop controls */}
				<div class="program-panel-controls">
					<Show
						when={isIdle()}
						fallback={
							<button
								type="button"
								class="program-panel-stop-btn"
								onClick={props.onStop}
								disabled={props.sessionState() === 'stopping'}
								aria-label="Stop program session"
							>
								{props.sessionState() === 'stopping' ? 'Stopping…' : 'Stop'}
							</button>
						}
					>
						<button
							type="button"
							class="program-panel-start-btn"
							disabled={!canStart()}
							onClick={() => {
								const firstScene = props.scenes()[0];
								if (firstScene) props.onStart(firstScene.id);
							}}
							aria-label="Start program session"
						>
							Start
						</button>
					</Show>
				</div>

				{/* Running session status */}
				<Show when={isRunning()}>
					<div class="program-panel-status" role="status" aria-live="polite" aria-atomic="true">
						<div class="program-panel-active-scene">
							Active:{' '}
							{props.activeSceneId()
								? (props.scenes().find((s) => s.id === props.activeSceneId())?.name ?? '—')
								: '—'}
						</div>
						<div class="program-panel-sources-status">
							<For each={props.sourceStatus()}>
								{(src) => (
									<div
										class="program-panel-source-status-row"
										classList={{
											'program-panel-source--dropped': src.state === 'dropped',
											'program-panel-source--failed': src.state === 'failed'
										}}
									>
										<span>{src.label}</span>
										<Show when={src.preEncodeDrops > 0}>
											<span class="program-panel-drops">{src.preEncodeDrops} drops</span>
										</Show>
									</div>
								)}
							</For>
						</div>
						<div class="program-panel-hotkey-hint" aria-label="Press 1-9 to switch scenes">
							Press 1–9 to switch scenes
						</div>
					</div>
				</Show>
			</div>
		</Show>
	);
}
