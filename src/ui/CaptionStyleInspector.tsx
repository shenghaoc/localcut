import { currentEpochMs } from '../time';
/** Phase 30 — Caption style inspector: preset picker, import/export, per-field
 *  overrides for titleStyle / glow / pill / animation. Edits are gathered as
 *  a local draft and committed to the project as a new custom preset via
 *  "Save as preset" (T8.1, T8.4). No media objects or GPU handles in this file;
 *  every interactive control has an ARIA label; the file picker dialogs are
 *  the only I/O.
 */

import { createComputed, createMemo, createSignal, For, Show, onCleanup } from 'solid-js';
import type { CaptionAnimStylePreset } from '../engine/captions/anim-style';
import {
	ANIM_CAPTION_PRESETS,
	MAX_PRESET_FILE_BYTES,
	validateCaptionAnimPreset
} from '../engine/captions/anim-style';
import type { CaptionAnimStylePresetSnapshot } from '../protocol';
import { isAbortError } from '../lib/abort-error';
import { downloadBlob } from '../lib/blob-download';

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

/**
 * UUID for a freshly imported / saved preset. `crypto.randomUUID()` requires a
 * secure context (HTTPS or `localhost`); when a non-isolated HTTP deployment
 * loads the editor, the call would throw. `crypto.getRandomValues` is
 * available without secure context, so we fall back to an RFC-4122 v4 UUID
 * built from 16 random bytes. Matches the inline guard pattern used elsewhere
 * in the repo (e.g. App.tsx, ExportDialog.tsx).
 */
function newPresetId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
		const bytes = new Uint8Array(16);
		crypto.getRandomValues(bytes);
		bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // version 4
		bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant RFC 4122
		const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	}
	// Final fallback for environments without Web Crypto. Not cryptographically
	// strong, but preset IDs are not security material — they just need to be
	// unique inside a single project doc.
	return `preset-${currentEpochMs()}-${Math.random().toString(16).slice(2, 10)}`;
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
				if (!isAbortError(error) && onError) {
					const message =
						error instanceof Error ? `${error.name}: ${error.message}` : String(error);
					onError(message);
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
				resolve({ ok: false, error: `Invalid field: ${result.field} — ${result.message}` });
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
			const update = window.confirm(
				`A custom preset named "${incoming.label}" already exists.\n\nClick OK to update it, or Cancel to save as a copy.`
			);
			if (update) {
				// Overwrite: keep the existing preset's id.
				props.onImportPreset({ ...incoming, id: conflict.id });
			} else {
				// Save as copy: keep the new UUID from openAndImportPreset.
				props.onImportPreset({ ...incoming, label: `${incoming.label} (copy)` });
			}
		} else {
			props.onImportPreset(incoming);
		}
		setImportSuccess(`Imported: ${incoming.label}`);
	};

	const handleSaveAsPreset = () => {
		const base = activePreset();
		if (!base) return;
		const defaultLabel = `${base.label} (custom)`;
		const label = window.prompt('Name this preset:', defaultLabel);
		if (label === null) return; // User cancelled.
		const trimmed = label.trim();
		if (trimmed.length === 0) return;
		const newPreset = presetFromDraft(trimmed, base, d());
		props.onImportPreset(newPreset);
		// Switch the selection to the new preset so further edits land on it.
		props.onSetPresetId(newPreset.id);
		setImportSuccess(`Saved as preset: ${newPreset.label}`);
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
		</div>
	);
}
