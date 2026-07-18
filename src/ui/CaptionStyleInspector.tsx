/** Phase 30 — Caption style inspector: preset picker, import/export, per-field
 *  overrides for titleStyle / glow / pill / animation. Edits are gathered as
 *  a local draft and committed to the project as a new custom preset via
 *  "Save as preset" (T8.1, T8.4). No media objects or GPU handles in this file;
 *  every interactive control has an ARIA label; the file picker dialogs are
 *  the only I/O.
 */

import {
	createComputed,
	createMemo,
	createSignal,
	For,
	Show,
	onCleanup,
	onMount,
	type JSX
} from 'solid-js';
import type { CaptionAnimStylePreset } from '../engine/captions/anim-style';
import {
	ANIM_CAPTION_PRESETS,
	MAX_PRESET_FILE_BYTES,
	validateCaptionAnimPreset
} from '../engine/captions/anim-style';
import type { CaptionAnimStylePresetSnapshot } from '../protocol';
import { isAbortError } from '../lib/abort-error';
import { downloadBlob } from '../lib/blob-download';
import { generateId } from '../utils/uuid';

// CaptionAnimStylePreset (engine) and CaptionAnimStylePresetSnapshot (protocol)
// are structurally compatible — the protocol type relaxes the animation kind to
// `string` so it's clone-safe across postMessage. The UI accepts the snapshot
// shape from callers and produces it on outbound mutations.
type UiPreset = CaptionAnimStylePresetSnapshot;

const ANIM_KINDS = ['none', 'pop', 'bounce', 'slide-up', 'slide-down', 'typewriter'] as const;
type AnimKind = (typeof ANIM_KINDS)[number];

/** Narrow a free-form string from a <select> onChange to a CaptionAnimKind. */
function coerceAnimKind(value: string): AnimKind {
	return (ANIM_KINDS as readonly string[]).includes(value) ? (value as AnimKind) : 'none';
}

/** Generate a unique preset ID via the centralized utility. */
function newPresetId(): string {
	return `preset-${generateId()}`;
}

interface CaptionStyleInspectorProps {
	/** Current track or segment preset ID. */
	presetId: string;
	/** Custom presets from ProjectDoc. */
	customPresets: readonly UiPreset[];
	/** Called when the user selects a preset. */
	onSetPresetId: (presetId: string) => void;
	/** Called to import a validated custom preset. */
	onImportPreset: (preset: UiPreset) => void;
	/** Called to delete a custom preset. */
	onDeletePreset: (presetId: string) => void;
}

function CaptionPresetDialog(props: {
	class: string;
	labelledBy: string;
	describedBy: string;
	initialFocusSelector: string;
	onDismiss: () => void;
	children: JSX.Element;
}): JSX.Element {
	let dialogRef: HTMLDialogElement | undefined;

	onMount(() => {
		if (!dialogRef) return;
		dialogRef.showModal();
		queueMicrotask(() => {
			dialogRef?.querySelector<HTMLElement>(props.initialFocusSelector)?.focus();
		});
	});

	onCleanup(() => {
		if (dialogRef?.open) dialogRef.close();
	});

	return (
		<dialog
			ref={(element) => {
				dialogRef = element;
			}}
			class={`caption-preset-dialog caption-notice ${props.class}`}
			aria-modal="true"
			aria-labelledby={props.labelledBy}
			aria-describedby={props.describedBy}
			onKeyDown={(event) => {
				if (event.key !== 'Escape') return;
				event.preventDefault();
				props.onDismiss();
			}}
			onCancel={(event) => {
				event.preventDefault();
				props.onDismiss();
			}}
		>
			{props.children}
		</dialog>
	);
}

/**
 * Serialize and save a preset to a local JSON file. Resolves to `null` on
 * success or user cancellation, or to an error message on a real failure
 * (quota exceeded, permission denied, write rejected). The previous
 * implementation swallowed every exception as "user cancelled", hiding real
 * filesystem errors from the user — `onError` lets the caller surface them.
 *
 * Falls back to `<a download>` when `showSaveFilePicker` is unavailable;
 * the download path can only fail synchronously so it never invokes `onError`.
 */
export function serializeAndSavePreset(
	preset: UiPreset,
	onError?: (message: string) => void
): void {
	const json = JSON.stringify(preset, null, 2);
	const blob = new Blob([json], { type: 'application/json' });
	const safeStem = preset.label.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || preset.id;
	const filename = `${safeStem}.caption-preset.json`;

	if (typeof (globalThis as Record<string, unknown>).showSaveFilePicker === 'function') {
		void (async () => {
			try {
				const handle = await (
					globalThis as unknown as {
						showSaveFilePicker: (options: unknown) => Promise<FileSystemFileHandle>;
					}
				).showSaveFilePicker({
					suggestedName: filename,
					types: [
						{
							description: 'Caption preset',
							accept: { 'application/json': ['.json'] }
						}
					]
				});
				const writable = await handle.createWritable();
				await writable.write(blob);
				await writable.close();
			} catch (error) {
				// AbortError is the only signal that means
				// "user cancelled" — anything else (QuotaExceededError,
				// NotAllowedError from a lost user gesture, an unexpected
				// I/O failure) is a real problem and must surface to the user.
				if (!isAbortError(error)) {
					const message =
						error instanceof Error ? `${error.name}: ${error.message}` : String(error);
					if (onError) onError(message);
					else console.warn('Preset save failed:', message);
				}
			}
		})();
	} else {
		downloadBlob(blob, filename);
	}
}

/**
 * Open a file picker, read the JSON, validate it, and return the result.
 * Returns null if the user cancelled or the file was invalid.
 */
export async function openAndImportPreset(): Promise<
	{ ok: true; preset: CaptionAnimStylePreset } | { ok: false; error: string } | null
> {
	let file: File | null = null;

	if (typeof (globalThis as Record<string, unknown>).showOpenFilePicker === 'function') {
		try {
			const [handle] = await (
				globalThis as unknown as {
					showOpenFilePicker: (options: unknown) => Promise<FileSystemFileHandle[]>;
				}
			).showOpenFilePicker({
				types: [
					{
						description: 'Caption preset',
						accept: { 'application/json': ['.json'] }
					}
				],
				multiple: false
			});
			file = await handle.getFile();
		} catch {
			return null; // User cancelled.
		}
	} else {
		// Fallback: hidden input element.
		return new Promise((resolve) => {
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = '.json';
			input.onchange = () => {
				file = input.files?.[0] ?? null;
				if (!file) {
					resolve(null);
					return;
				}
				readAndValidate(file, resolve);
			};
			input.click();
		});
	}

	if (!file) return null;
	return new Promise((resolve) => {
		readAndValidate(file!, resolve);
	});
}

function readAndValidate(
	file: File,
	resolve: (
		result: { ok: true; preset: CaptionAnimStylePreset } | { ok: false; error: string }
	) => void
): void {
	// R4.6: bounded memory — reject oversized files before reading them into memory.
	if (file.size > MAX_PRESET_FILE_BYTES) {
		resolve({
			ok: false,
			error: `Preset file exceeds ${Math.round(MAX_PRESET_FILE_BYTES / 1024)} KiB limit (got ${Math.round(file.size / 1024)} KiB).`
		});
		return;
	}
	const reader = new FileReader();
	reader.onload = () => {
		try {
			const raw = JSON.parse(reader.result as string);
			const result = validateCaptionAnimPreset(raw);
			if (!result.ok) {
				resolve({
					ok: false,
					error: `Invalid field: ${result.field} — ${result.message}`
				});
				return;
			}
			const preset: CaptionAnimStylePreset = {
				...result.value,
				id: newPresetId(),
				builtIn: false
			};
			resolve({ ok: true, preset });
		} catch {
			resolve({ ok: false, error: 'File is not valid JSON.' });
		}
	};
	reader.onerror = () => resolve({ ok: false, error: 'Failed to read file.' });
	reader.readAsText(file);
}

/**
 * Module-level Canvas2D probe used by `normalizeHexColor`. Allocated lazily on
 * first call and reused for every subsequent call — the inspector seeds 7
 * colour fields on every preset switch, so per-call allocation was burning a
 * fresh `<canvas>` element + 2D context each time. The probe never holds any
 * rendered pixels (we only read `fillStyle`), so it's safe to share.
 */
let colorProbeCtx: CanvasRenderingContext2D | null | undefined;
function getColorProbeCtx(): CanvasRenderingContext2D | null {
	if (colorProbeCtx !== undefined) return colorProbeCtx;
	if (typeof document === 'undefined') {
		colorProbeCtx = null;
		return null;
	}
	try {
		colorProbeCtx = document.createElement('canvas').getContext('2d');
	} catch {
		colorProbeCtx = null;
	}
	return colorProbeCtx;
}

/**
 * `<input type="color">` only accepts `#rrggbb` strings. Underlying style
 * fields can be any CSS colour notation (`'red'`, `'rgba(...)'`, `'hsl(...)'`),
 * which the input would silently render as black. Normalise to `#rrggbb` using
 * a Canvas2D parse trick: setting an arbitrary string as `fillStyle` is
 * lossless to whatever the browser can interpret, and reading it back yields
 * a canonical form. Falls back to a sensible default when the string is
 * unparseable.
 */
function normalizeHexColor(input: string | undefined, fallback: string): string {
	if (!input) return fallback;
	if (/^#[0-9a-fA-F]{6}$/.test(input)) return input.toLowerCase();
	const probe = getColorProbeCtx();
	if (!probe) return fallback;
	try {
		probe.fillStyle = '#000000';
		probe.fillStyle = input;
		const value = probe.fillStyle;
		// Canvas returns either "#rrggbb" (opaque) or "rgba(r, g, b, a)" (with alpha).
		if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
			return value.toLowerCase();
		}
		const rgbaMatch = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(value));
		if (rgbaMatch) {
			const r = Number(rgbaMatch[1]).toString(16).padStart(2, '0');
			const g = Number(rgbaMatch[2]).toString(16).padStart(2, '0');
			const b = Number(rgbaMatch[3]).toString(16).padStart(2, '0');
			return `#${r}${g}${b}`;
		}
		return fallback;
	} catch {
		return fallback;
	}
}

/**
 * Compute draft override fields from a base preset. Returns plain values that
 * the override form binds to via signals; "Save as preset" reads them back to
 * construct a new custom preset. Track/segment style.overrides are NOT touched
 * by this draft — they remain a Phase 22 concept that the TranscriptPanel font
 * size field already controls. This panel's overrides land in the new preset.
 */
function draftFromPreset(preset: UiPreset) {
	const titleStyle = preset.titleStyle;
	return {
		color: normalizeHexColor(titleStyle.color, '#ffffff'),
		fontSizePx: typeof titleStyle.fontSizePx === 'number' ? titleStyle.fontSizePx : 64,
		outlineColor: normalizeHexColor(titleStyle.outlineColor, '#000000'),
		outlineWidthPx: typeof titleStyle.outlineWidthPx === 'number' ? titleStyle.outlineWidthPx : 4,
		glowEnabled: preset.glow !== undefined,
		glowColor: normalizeHexColor(preset.glow?.color, '#00ffff'),
		glowBlurPx: preset.glow?.blurPx ?? 20,
		pillEnabled: preset.pill !== undefined,
		pillColor: normalizeHexColor(preset.pill?.color, '#000000'),
		pillOpacity: preset.pill?.opacity ?? 0.6,
		pillRadiusPx: preset.pill?.radiusPx ?? 8,
		pillPaddingXPx: preset.pill?.paddingXPx ?? 12,
		pillPaddingYPx: preset.pill?.paddingYPx ?? 6,
		enterKind: preset.animation?.enter ?? 'none',
		exitKind: preset.animation?.exit ?? 'none',
		animDurationS: preset.animation?.durationS ?? 0.25
	};
}

type Draft = ReturnType<typeof draftFromPreset>;

function presetFromDraft(label: string, base: UiPreset, draft: Draft): UiPreset {
	return {
		captionStyleSchemaVersion: 1,
		id: newPresetId(),
		label,
		builtIn: false,
		anchor: base.anchor,
		maxWidthPercent: base.maxWidthPercent,
		lineWrap: base.lineWrap,
		insetPx: base.insetPx,
		titleStyle: {
			...base.titleStyle,
			color: draft.color,
			fontSizePx: draft.fontSizePx,
			outlineColor: draft.outlineColor,
			outlineWidthPx: draft.outlineWidthPx
		},
		...(draft.glowEnabled ? { glow: { color: draft.glowColor, blurPx: draft.glowBlurPx } } : {}),
		...(draft.pillEnabled
			? {
					pill: {
						paddingXPx: draft.pillPaddingXPx,
						paddingYPx: draft.pillPaddingYPx,
						radiusPx: draft.pillRadiusPx,
						color: draft.pillColor,
						opacity: draft.pillOpacity
					}
				}
			: {}),
		...(draft.enterKind !== 'none' || draft.exitKind !== 'none'
			? {
					animation: {
						enter: draft.enterKind,
						exit: draft.exitKind,
						durationS: draft.animDurationS
					}
				}
			: {}),
		...(base.highlightColor ? { highlightColor: base.highlightColor } : {})
	};
}

/** The preset picker and override panel. */
export function CaptionStyleInspector(props: CaptionStyleInspectorProps) {
	const [importError, setImportError] = createSignal<string | null>(null);
	const [importSuccess, setImportSuccessSignal] = createSignal<string | null>(null);
	const [importConflict, setImportConflict] = createSignal<{
		preset: UiPreset;
		conflictId: string;
		label: string;
	} | null>(null);
	const [presetNamePrompt, setPresetNamePrompt] = createSignal<{
		label: string;
		base: UiPreset;
		draft: Draft;
	} | null>(null);

	// Auto-clear the success notice after 3 s. Wrapping setImportSuccess in a
	// helper that also schedules the timer is simpler than a createEffect for
	// this one-shot UI affordance.
	let successTimer: ReturnType<typeof setTimeout> | undefined;
	const setImportSuccess = (value: string | null) => {
		setImportSuccessSignal(value);
		if (successTimer !== undefined) clearTimeout(successTimer);
		if (value !== null) {
			successTimer = setTimeout(() => setImportSuccessSignal(null), 3000);
		}
	};

	const allPresets = createMemo<UiPreset[]>(() => [
		...ANIM_CAPTION_PRESETS,
		...props.customPresets
	]);
	const activePreset = createMemo<UiPreset | null>(
		() => allPresets().find((p) => p.id === props.presetId) ?? null
	);

	// Draft override state, seeded from whichever preset is currently selected.
	// `createComputed` re-seeds the draft synchronously (before the DOM updates)
	// whenever the active preset changes, so switching presets never flashes
	// stale fields. It tracks `activePreset()` (the preset id) but not `draft`
	// itself, so user edits via `updateDraft` don't re-trigger the reset.
	const [draft, setDraft] = createSignal<Draft>(draftFromPreset(ANIM_CAPTION_PRESETS[0]!));
	createComputed(() => {
		const preset = activePreset();
		setDraft(preset ? draftFromPreset(preset) : draftFromPreset(ANIM_CAPTION_PRESETS[0]!));
	});
	const d = draft;

	const updateDraft = <K extends keyof Draft>(key: K, value: Draft[K]) => {
		setDraft((prev) => ({ ...prev, [key]: value }));
	};

	const handleImport = async () => {
		setImportError(null);
		setImportSuccess(null);
		const result = await openAndImportPreset();
		if (!result) return;
		if (!result.ok) {
			setImportError(result.error);
			return;
		}
		// T8.5: conflict resolution — check for a matching label in custom presets.
		const incoming = result.preset;
		const conflict = props.customPresets.find((p) => p.label === incoming.label);
		if (conflict) {
			setImportConflict({
				preset: incoming,
				conflictId: conflict.id,
				label: incoming.label
			});
			return;
		}
		props.onImportPreset(incoming);
		setImportSuccess(`Imported: ${incoming.label}`);
	};

	const handleImportConflictUpdate = () => {
		const c = importConflict();
		if (!c) return;
		setImportConflict(null);
		props.onImportPreset({ ...c.preset, id: c.conflictId });
		setImportSuccess(`Updated: ${c.label}`);
	};

	const handleImportConflictCopy = () => {
		const c = importConflict();
		if (!c) return;
		setImportConflict(null);
		props.onImportPreset({ ...c.preset, label: c.preset.label + ' (copy)' });
		setImportSuccess(`Imported as copy: ${c.preset.label} (copy)`);
	};

	const handleImportConflictCancel = () => {
		setImportConflict(null);
	};

	const handleSaveAsPreset = () => {
		const base = activePreset();
		if (!base) return;
		setPresetNamePrompt({
			label: `${base.label} (custom)`,
			base,
			draft: d()
		});
	};

	const handleCommitPresetName = () => {
		const prompt = presetNamePrompt();
		if (!prompt) return;
		const trimmed = prompt.label.trim();
		if (trimmed.length === 0) return;
		const newPreset = presetFromDraft(trimmed, prompt.base, prompt.draft);
		props.onImportPreset(newPreset);
		// Switch the selection to the new preset so further edits land on it.
		props.onSetPresetId(newPreset.id);
		setImportSuccess(`Saved as preset: ${newPreset.label}`);
		setPresetNamePrompt(null);
	};

	const handleCancelPresetName = () => {
		setPresetNamePrompt(null);
	};

	const handleExport = () => {
		const preset = activePreset();
		if (!preset) return;
		serializeAndSavePreset(preset, (message) =>
			setImportError(`Could not save preset: ${message}`)
		);
	};

	const isCustomSelected = () =>
		props.customPresets.some((p) => p.id === props.presetId && !p.builtIn);

	onCleanup(() => {
		if (successTimer !== undefined) clearTimeout(successTimer);
	});

	return (
		<div class="caption-style-inspector" role="group" aria-label="Caption animation style">
			{/* Preset picker grid */}
			<div class="caption-preset-grid" role="listbox" aria-label="Caption presets">
				<For each={allPresets()}>
					{(preset) => (
						<button
							type="button"
							role="option"
							aria-selected={preset.id === props.presetId}
							aria-label={preset.label}
							class={`caption-preset-swatch${preset.id === props.presetId ? ' is-selected' : ''}`}
							onClick={() => props.onSetPresetId(preset.id)}
						>
							<span class="caption-preset-swatch-label">{preset.label}</span>
							<span class="caption-preset-badges">
								{preset.glow && (
									<span class="caption-preset-badge" aria-label="Has glow" title="Glow">
										G
									</span>
								)}
								{preset.pill && (
									<span class="caption-preset-badge" aria-label="Has pill" title="Pill">
										P
									</span>
								)}
								{preset.animation && preset.animation.enter !== 'none' && (
									<span class="caption-preset-badge" aria-label="Animated" title="Animated">
										A
									</span>
								)}
							</span>
						</button>
					)}
				</For>
			</div>

			{/* Per-field override form. Edits stay local until "Save as preset" is
			    pressed, which materialises a new custom preset and selects it. */}
			<div class="caption-overrides" role="group" aria-label="Preset overrides">
				<div class="caption-overrides-row">
					<label>
						<span>Text color</span>
						<input
							type="color"
							value={d().color}
							aria-label="Text color"
							onInput={(e) => updateDraft('color', e.currentTarget.value)}
						/>
					</label>
					<label>
						<span>Font size (px)</span>
						<input
							type="number"
							min="16"
							max="200"
							step="1"
							value={d().fontSizePx}
							aria-label="Font size in pixels"
							onInput={(e) => updateDraft('fontSizePx', Number(e.currentTarget.value))}
						/>
					</label>
					<label>
						<span>Outline color</span>
						<input
							type="color"
							value={d().outlineColor}
							aria-label="Outline color"
							onInput={(e) => updateDraft('outlineColor', e.currentTarget.value)}
						/>
					</label>
					<label>
						<span>Outline width (px)</span>
						<input
							type="number"
							min="0"
							max="32"
							step="1"
							value={d().outlineWidthPx}
							aria-label="Outline width in pixels"
							onInput={(e) => updateDraft('outlineWidthPx', Number(e.currentTarget.value))}
						/>
					</label>
				</div>

				<div class="caption-overrides-row">
					<label class="caption-overrides-toggle">
						<input
							type="checkbox"
							checked={d().glowEnabled}
							aria-label="Enable glow"
							onChange={(e) => updateDraft('glowEnabled', e.currentTarget.checked)}
						/>
						<span>Glow</span>
					</label>
					<label>
						<span>Glow color</span>
						<input
							type="color"
							value={d().glowColor}
							disabled={!d().glowEnabled}
							aria-label="Glow color"
							onInput={(e) => updateDraft('glowColor', e.currentTarget.value)}
						/>
					</label>
					<label>
						<span>Glow blur (px)</span>
						<input
							type="number"
							min="0"
							max="80"
							step="1"
							value={d().glowBlurPx}
							disabled={!d().glowEnabled}
							aria-label="Glow blur radius in pixels"
							onInput={(e) => updateDraft('glowBlurPx', Number(e.currentTarget.value))}
						/>
					</label>
				</div>

				<div class="caption-overrides-row">
					<label class="caption-overrides-toggle">
						<input
							type="checkbox"
							checked={d().pillEnabled}
							aria-label="Enable background pill"
							onChange={(e) => updateDraft('pillEnabled', e.currentTarget.checked)}
						/>
						<span>Pill</span>
					</label>
					<label>
						<span>Pill color</span>
						<input
							type="color"
							value={d().pillColor}
							disabled={!d().pillEnabled}
							aria-label="Pill color"
							onInput={(e) => updateDraft('pillColor', e.currentTarget.value)}
						/>
					</label>
					<label>
						<span>Pill opacity</span>
						<input
							type="number"
							min="0"
							max="1"
							step="0.05"
							value={d().pillOpacity}
							disabled={!d().pillEnabled}
							aria-label="Pill opacity"
							onInput={(e) => updateDraft('pillOpacity', Number(e.currentTarget.value))}
						/>
					</label>
					<label>
						<span>Pill radius (px)</span>
						<input
							type="number"
							min="0"
							max="40"
							step="1"
							value={d().pillRadiusPx}
							disabled={!d().pillEnabled}
							aria-label="Pill corner radius"
							onInput={(e) => updateDraft('pillRadiusPx', Number(e.currentTarget.value))}
						/>
					</label>
				</div>

				<div class="caption-overrides-row">
					<label>
						<span>Enter animation</span>
						<select
							value={d().enterKind}
							aria-label="Enter animation kind"
							onChange={(e) => updateDraft('enterKind', coerceAnimKind(e.currentTarget.value))}
						>
							<For each={ANIM_KINDS}>{(kind) => <option value={kind}>{kind}</option>}</For>
						</select>
					</label>
					<label>
						<span>Exit animation</span>
						<select
							value={d().exitKind}
							aria-label="Exit animation kind"
							onChange={(e) => updateDraft('exitKind', coerceAnimKind(e.currentTarget.value))}
						>
							<For each={ANIM_KINDS}>{(kind) => <option value={kind}>{kind}</option>}</For>
						</select>
					</label>
					<label>
						<span>Duration (s)</span>
						<input
							type="number"
							min="0.05"
							max="1"
							step="0.05"
							value={d().animDurationS}
							aria-label="Animation duration in seconds"
							onInput={(e) => updateDraft('animDurationS', Number(e.currentTarget.value))}
						/>
					</label>
				</div>
			</div>

			{/* Import/Export buttons */}
			<div class="caption-preset-actions">
				<button type="button" onClick={handleImport} aria-label="Import preset from file">
					Import…
				</button>
				<button
					type="button"
					onClick={handleExport}
					aria-label="Export preset to file"
					disabled={!activePreset()}
				>
					Export
				</button>
				<button
					type="button"
					onClick={handleSaveAsPreset}
					aria-label="Save current overrides as a new preset"
					disabled={!activePreset()}
				>
					Save as preset…
				</button>
				{/* Delete is only valid for custom presets — built-ins are immutable. */}
				<Show when={isCustomSelected()}>
					<button
						type="button"
						onClick={() => props.onDeletePreset(props.presetId)}
						aria-label="Delete custom preset"
					>
						Delete
					</button>
				</Show>
			</div>

			{/* Inline error/success notices */}
			<Show when={importError()}>
				<div class="caption-notice caption-notice-error" role="alert" aria-live="assertive">
					{importError()}
				</div>
			</Show>
			<Show when={importSuccess()}>
				<div
					class="caption-notice caption-notice-success"
					role="status"
					aria-live="polite"
					aria-atomic="true"
				>
					{importSuccess()}
				</div>
			</Show>

			{/* Native modal semantics provide focus containment, Escape handling,
			    background inertness, and focus return without duplicating a trap. */}
			<Show when={importConflict()}>
				{(c) => (
					<CaptionPresetDialog
						class="caption-notice-warn"
						labelledBy="caption-conflict-title"
						describedBy="caption-conflict-description"
						initialFocusSelector=".is-primary"
						onDismiss={handleImportConflictCancel}
					>
						<h2 id="caption-conflict-title" class="caption-preset-dialog-title">
							Preset already exists
						</h2>
						<p id="caption-conflict-description">
							A preset named <strong>{c().label}</strong> already exists.
						</p>
						<div class="caption-notice-actions">
							<button type="button" data-caption-dialog-cancel onClick={handleImportConflictCancel}>
								Cancel
							</button>
							<button type="button" class="is-destructive" onClick={handleImportConflictUpdate}>
								Update existing
							</button>
							<button type="button" class="is-primary" onClick={handleImportConflictCopy}>
								Save as copy
							</button>
						</div>
					</CaptionPresetDialog>
				)}
			</Show>

			<Show when={presetNamePrompt() !== null}>
				<CaptionPresetDialog
					class="caption-notice-prompt"
					labelledBy="caption-preset-name-title"
					describedBy="caption-preset-name-description"
					initialFocusSelector="input"
					onDismiss={handleCancelPresetName}
				>
					<h2 id="caption-preset-name-title" class="caption-preset-dialog-title">
						Save caption preset
					</h2>
					<p id="caption-preset-name-description">Choose a name for these style settings.</p>
					<label>
						<span>Preset name</span>
						<input
							type="text"
							value={presetNamePrompt()?.label ?? ''}
							aria-label="Preset name"
							onInput={(event) =>
								setPresetNamePrompt((prompt) =>
									prompt ? { ...prompt, label: event.currentTarget.value } : prompt
								)
							}
							onKeyDown={(e) => {
								if (e.key === 'Enter' && presetNamePrompt()?.label.trim()) {
									e.preventDefault();
									handleCommitPresetName();
								}
							}}
						/>
					</label>
					<div class="caption-notice-actions">
						<button type="button" onClick={handleCancelPresetName}>
							Cancel
						</button>
						<button
							type="button"
							class="is-primary"
							disabled={!presetNamePrompt()?.label.trim()}
							onClick={handleCommitPresetName}
						>
							Save
						</button>
					</div>
				</CaptionPresetDialog>
			</Show>
		</div>
	);
}
