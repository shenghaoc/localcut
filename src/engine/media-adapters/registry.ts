import { mediabunnyAdapter } from './mediabunny-adapter';
import type { MediaAdapter, MediaInputHandle } from './types';

export const ENABLE_EXPERIMENTAL_MEDIA_DIAGNOSTICS = false;

export function defaultMediaAdapters(): readonly MediaAdapter[] {
	return [mediabunnyAdapter];
}

export function selectPrimaryMediaAdapter(
	adapters: readonly MediaAdapter[],
	file: File
): MediaAdapter | null {
	return (
		adapters.find(
			// eslint-disable-next-line typescript/unbound-method -- canInspect is a pure predicate, no `this` dependency
			(adapter) => adapter.role === 'primary' && adapter.canInspect(file) && adapter.open
		) ?? null
	);
}

export async function openMediaFile(
	file: File,
	sourceId: string,
	adapters: readonly MediaAdapter[] = defaultMediaAdapters()
): Promise<MediaInputHandle> {
	const adapter = selectPrimaryMediaAdapter(adapters, file);
	if (!adapter?.open) {
		throw new Error('No primary media adapter can inspect this file.');
	}
	const result = await adapter.open({ sourceId, file });
	return result.handle;
}
