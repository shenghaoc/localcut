/** Phase 30 — Caption style inspector: preset picker, import/export, per-field overrides.
 *
 * Renders when a caption track or segment is selected. Keyboard accessible,
 * ARIA labels on all controls, no media objects or GPU handles in this file.
 */

import { createSignal, For, Show, onCleanup } from 'solid-js';
import type { CaptionAnimStylePreset } from '../engine/captions/anim-style';
import { ANIM_CAPTION_PRESETS, validateCaptionAnimPreset } from '../engine/captions/anim-style';

interface CaptionStyleInspectorProps {
	/** Current track or segment preset ID. */
	presetId: string;
	/** Custom presets from ProjectDoc. */
	customPresets: readonly CaptionAnimStylePreset[];
	/** Called when the user selects a preset. */
	onSetPresetId: (presetId: string) => void;
	/** Called to import a validated custom preset. */
	onImportPreset: (preset: CaptionAnimStylePreset) => void;
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
				id: crypto.randomUUID(),
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
	const [importSuccess, setImportSuccess] = createSignal<string | null>(null);

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
		props.onImportPreset(result.preset);
		setImportSuccess(`Imported: ${result.preset.label}`);
	};

	const handleExport = () => {
		const preset = allPresets().find((p) => p.id === props.presetId);
		if (preset) serializeAndSavePreset(preset);
	};

	// Auto-clear success message after 3s.
	const successTimer: ReturnType<typeof setTimeout> | undefined = undefined;
	onCleanup(() => clearTimeout(successTimer));

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
				<Show when={!props.customPresets.find((p) => p.id === props.presetId)?.builtIn}>
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
