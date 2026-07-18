import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import type { CaptionAnimStylePreset } from '../engine/captions/anim-style';
import { ANIM_CAPTION_PRESETS } from '../engine/captions/anim-style';
import '../global.css';
import { CaptionStyleInspector } from '../ui/CaptionStyleInspector';

const disposers: Array<() => void> = [];
const originalOpenPicker = Object.getOwnPropertyDescriptor(globalThis, 'showOpenFilePicker');

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitFor<T>(read: () => T | null | undefined | false): Promise<T> {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		const value = read();
		if (value) return value;
		await nextFrame();
	}
	throw new Error('Timed out waiting for browser state');
}

function inputValue(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
}

function renderInspector(customPresets: readonly CaptionAnimStylePreset[] = []) {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const [presetId, setPresetId] = createSignal(ANIM_CAPTION_PRESETS[0]!.id);
	const onImportPreset = vi.fn<(preset: CaptionAnimStylePreset) => void>();
	const onSetPresetId = vi.fn((id: string) => setPresetId(id));
	const dispose = render(
		() => (
			<CaptionStyleInspector
				presetId={presetId()}
				customPresets={customPresets}
				onSetPresetId={onSetPresetId}
				onImportPreset={onImportPreset}
				onDeletePreset={vi.fn()}
			/>
		),
		container
	);
	disposers.push(dispose);
	return { container, setPresetId, onImportPreset, onSetPresetId };
}

afterEach(() => {
	for (const dispose of disposers) dispose();
	disposers.length = 0;
	document.body.innerHTML = '';
	if (originalOpenPicker) {
		Object.defineProperty(globalThis, 'showOpenFilePicker', originalOpenPicker);
	} else {
		Reflect.deleteProperty(globalThis, 'showOpenFilePicker');
	}
});

describe('CaptionStyleInspector preset dialogs', () => {
	it('keeps a blank name modal, disables Save, and restores focus after Escape', async () => {
		const { container, onImportPreset } = renderInspector();
		const trigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="Save current overrides as a new preset"]'
		);
		expect(trigger).not.toBeNull();
		trigger!.focus();
		trigger!.click();

		const dialog = await waitFor(() => container.querySelector<HTMLDialogElement>('dialog[open]'));
		const input = dialog.querySelector<HTMLInputElement>('[aria-label="Preset name"]');
		expect(input).not.toBeNull();
		await nextFrame();
		expect(document.activeElement).toBe(input);
		expect(dialog.getAttribute('aria-labelledby')).toBe('caption-preset-name-title');

		inputValue(input!, '');
		await nextFrame();
		expect(container.querySelector('dialog[open]')).toBe(dialog);
		const save = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(
			(button) => button.textContent?.trim() === 'Save'
		);
		expect(save?.disabled).toBe(true);

		dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await nextFrame();
		expect(container.querySelector('dialog[open]')).toBeNull();
		expect(document.activeElement).toBe(trigger);
		expect(onImportPreset).not.toHaveBeenCalled();
	});

	it('saves the base and draft snapshot captured when the name dialog opens', async () => {
		const { container, setPresetId, onImportPreset } = renderInspector();
		const firstPreset = ANIM_CAPTION_PRESETS[0]!;
		const secondPreset = ANIM_CAPTION_PRESETS[1]!;
		const fontSize = container.querySelector<HTMLInputElement>(
			'[aria-label="Font size in pixels"]'
		);
		expect(fontSize).not.toBeNull();
		inputValue(fontSize!, '77');

		container
			.querySelector<HTMLButtonElement>('[aria-label="Save current overrides as a new preset"]')!
			.click();
		const dialog = await waitFor(() => container.querySelector<HTMLDialogElement>('dialog[open]'));
		setPresetId(secondPreset.id);
		await nextFrame();

		const name = dialog.querySelector<HTMLInputElement>('[aria-label="Preset name"]')!;
		inputValue(name, 'Snapshot style');
		const save = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(
			(button) => button.textContent?.trim() === 'Save'
		);
		save!.click();
		await nextFrame();

		expect(onImportPreset).toHaveBeenCalledTimes(1);
		const saved = onImportPreset.mock.calls[0]![0];
		expect(saved.label).toBe('Snapshot style');
		expect(saved.titleStyle.fontSizePx).toBe(77);
		expect(saved.anchor).toBe(firstPreset.anchor);
		expect(saved.anchor).not.toBe(secondPreset.anchor);
	});

	it('offers safe conflict cancellation, copy, and explicit destructive update', async () => {
		const existing: CaptionAnimStylePreset = {
			...ANIM_CAPTION_PRESETS[0]!,
			id: 'preset-existing',
			label: 'Imported style',
			builtIn: false
		};
		const incoming: CaptionAnimStylePreset = {
			...ANIM_CAPTION_PRESETS[1]!,
			id: 'ignored-file-id',
			label: existing.label,
			builtIn: false
		};
		const picker = vi.fn(async () => [
			{
				getFile: async () =>
					new File([JSON.stringify(incoming)], 'imported.caption-preset.json', {
						type: 'application/json'
					})
			}
		]);
		Object.defineProperty(globalThis, 'showOpenFilePicker', {
			configurable: true,
			value: picker
		});

		const { container, onImportPreset } = renderInspector([existing]);
		const importButton = container.querySelector<HTMLButtonElement>(
			'[aria-label="Import preset from file"]'
		)!;
		importButton.focus();
		importButton.click();
		let dialog = await waitFor(() => container.querySelector<HTMLDialogElement>('dialog[open]'));
		const cancel = dialog.querySelector<HTMLButtonElement>('[data-caption-dialog-cancel]');
		const safeDefault = dialog.querySelector<HTMLButtonElement>('.is-primary');
		expect(cancel).not.toBeNull();
		expect(safeDefault?.textContent?.trim()).toBe('Save as copy');
		await nextFrame();
		expect(document.activeElement).toBe(safeDefault);
		cancel!.click();
		await nextFrame();
		expect(onImportPreset).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(importButton);

		importButton.click();
		dialog = await waitFor(() => container.querySelector<HTMLDialogElement>('dialog[open]'));
		const copy = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(
			(button) => button.textContent?.trim() === 'Save as copy'
		)!;
		expect(copy.classList.contains('is-primary')).toBe(true);
		copy.click();
		await nextFrame();
		expect(onImportPreset).toHaveBeenCalledTimes(1);
		expect(onImportPreset.mock.calls[0]![0].label).toBe('Imported style (copy)');

		onImportPreset.mockClear();
		importButton.click();
		dialog = await waitFor(() => container.querySelector<HTMLDialogElement>('dialog[open]'));
		const update = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(
			(button) => button.textContent?.trim() === 'Update existing'
		)!;
		expect(update.classList.contains('is-destructive')).toBe(true);
		update.click();
		await nextFrame();
		expect(onImportPreset).toHaveBeenCalledTimes(1);
		expect(onImportPreset.mock.calls[0]![0].id).toBe(existing.id);
		expect(picker).toHaveBeenCalledTimes(3);
	});
});
