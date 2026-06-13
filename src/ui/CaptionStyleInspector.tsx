/** Phase 30 — Caption style inspector: preset picker, import/export, per-field overrides.
 *
 * Renders when a caption track or segment is selected. Keyboard accessible,
 * ARIA labels on all controls, no media objects or GPU handles in this file.
 */

import { createSignal, For, Show, onCleanup } from 'solid-js';
import type { CaptionAnimStylePreset } from '../engine/captions/anim-style';
import {
	ANIM_CAPTION_PRESETS,
	MAX_PRESET_FILE_BYTES,
	validateCaptionAnimPreset
} from '../engine/captions/anim-style';
import type { CaptionAnimStylePresetSnapshot } from '../protocol';

// CaptionAnimStylePreset (engine) and CaptionAnimStylePresetSnapshot (protocol)
// are structurally compatible — the protocol type relaxes the animation kind to
// `string` so it's clone-safe across postMessage. The UI accepts the snapshot
// shape from callers and produces it on outbound mutations.
type UiPreset = CaptionAnimStylePresetSnapshot;

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
	return `preset-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
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
 * Serialize and save a preset to a local JSON file.
 * Falls back to `<a download>` when `showSaveFilePicker` is unavailable.
 */
export function serializeAndSavePreset(preset: CaptionAnimStylePreset): void {
	const json = JSON.stringify(preset, null, 2);
	const blob = new Blob([json], { type: 'application/json' });
	const filename = `${preset.id}.caption-preset.json`;

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
			} catch {
				// User cancelled — no error to report.
			}
		})();
	} else {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
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

	const allPresets = () => [...ANIM_CAPTION_PRESETS, ...props.customPresets];

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
		const label = window.prompt('Enter a name for this preset:');
		if (!label || label.trim().length === 0) return;
		const current = allPresets().find((p) => p.id === props.presetId);
		if (!current) return;
		const newPreset: UiPreset = {
			...(current as UiPreset),
			id: newPresetId(),
			label: label.trim(),
			builtIn: false
		};
		props.onImportPreset(newPreset);
		setImportSuccess(`Saved as preset: ${newPreset.label}`);
	};

	const handleExport = () => {
		const preset = allPresets().find((p) => p.id === props.presetId);
		// The runtime shape of UiPreset and CaptionAnimStylePreset is identical.
		if (preset) serializeAndSavePreset(preset as unknown as CaptionAnimStylePreset);
	};

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
							class={`caption-preset-swatch${preset.id === props.presetId ? ' selected' : ''}`}
							onClick={() => props.onSetPresetId(preset.id)}
						>
							<span class="caption-preset-swatch-label">{preset.label}</span>
							{preset.glow && (
								<span class="caption-preset-badge" aria-label="Has glow">
									G
								</span>
							)}
							{preset.pill && (
								<span class="caption-preset-badge" aria-label="Has pill">
									P
								</span>
							)}
							{preset.animation && preset.animation.enter !== 'none' && (
								<span class="caption-preset-badge" aria-label="Animated">
									A
								</span>
							)}
						</button>
					)}
				</For>
			</div>

			{/* Import/Export buttons */}
			<div class="caption-preset-actions">
				<button type="button" onClick={handleImport} aria-label="Import preset from file">
					Import preset
				</button>
				<button type="button" onClick={handleExport} aria-label="Export preset to file">
					Export preset
				</button>
				<button
					type="button"
					onClick={handleSaveAsPreset}
					aria-label="Save current style as a new preset"
				>
					Save as preset
				</button>
				{/* Delete is only valid for custom presets — built-ins are immutable. */}
				<Show when={props.customPresets.some((p) => p.id === props.presetId && !p.builtIn)}>
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
				<div class="caption-notice caption-notice-success" role="status" aria-live="polite">
					{importSuccess()}
				</div>
			</Show>
		</div>
	);
}
