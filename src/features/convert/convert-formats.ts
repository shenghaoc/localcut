/**
 * Target-format registry for the media converter, kept free of any Mediabunny
 * import so it is safe to use on the main thread (the engine worker maps these
 * ids onto Mediabunny `OutputFormat` instances). Plain data + pure helpers
 * only — no DOM, no media objects.
 */

import type { ConvertFormatId, ConvertInputInfo } from '../../protocol';

export interface ConvertFormatDescriptor {
	readonly id: ConvertFormatId;
	/** Full menu label including the default codecs, e.g. `MP4 (H.264 · AAC)`. */
	readonly label: string;
	/** Compact label for chips/filenames, e.g. `MP4`. */
	readonly shortLabel: string;
	/** Lower-case file extension without the dot. */
	readonly extension: string;
	readonly mimeType: string;
	/** `video` containers carry video+audio; `audio` containers are audio-only. */
	readonly kind: 'video' | 'audio';
	/** One-line plain-language hint shown under the format picker. */
	readonly hint: string;
}

export const CONVERT_FORMATS: readonly ConvertFormatDescriptor[] = [
	{
		id: 'mp4',
		label: 'MP4 (H.264 · AAC)',
		shortLabel: 'MP4',
		extension: 'mp4',
		mimeType: 'video/mp4',
		kind: 'video',
		hint: 'Most compatible — plays almost everywhere.'
	},
	{
		id: 'webm',
		label: 'WebM (VP9 · Opus)',
		shortLabel: 'WebM',
		extension: 'webm',
		mimeType: 'video/webm',
		kind: 'video',
		hint: 'Smaller files for the web; royalty-free codecs.'
	},
	{
		id: 'mkv',
		label: 'MKV (VP9 · Opus)',
		shortLabel: 'MKV',
		extension: 'mkv',
		mimeType: 'video/x-matroska',
		kind: 'video',
		hint: 'Flexible container that holds almost any track.'
	},
	{
		id: 'mov',
		label: 'MOV (H.264 · AAC)',
		shortLabel: 'MOV',
		extension: 'mov',
		mimeType: 'video/quicktime',
		kind: 'video',
		hint: 'QuickTime container, handy for Apple workflows.'
	},
	{
		id: 'mp3',
		label: 'MP3 (audio only)',
		shortLabel: 'MP3',
		extension: 'mp3',
		mimeType: 'audio/mpeg',
		kind: 'audio',
		hint: 'Extracts the audio as a universally playable MP3.'
	},
	{
		id: 'wav',
		label: 'WAV (uncompressed audio)',
		shortLabel: 'WAV',
		extension: 'wav',
		mimeType: 'audio/wav',
		kind: 'audio',
		hint: 'Lossless PCM audio; large files.'
	},
	{
		id: 'ogg',
		label: 'OGG (Opus audio)',
		shortLabel: 'OGG',
		extension: 'ogg',
		mimeType: 'audio/ogg',
		kind: 'audio',
		hint: 'Compact, royalty-free audio.'
	}
];

const FORMATS_BY_ID = new Map<ConvertFormatId, ConvertFormatDescriptor>(
	CONVERT_FORMATS.map((format) => [format.id, format])
);

export function convertFormatById(id: ConvertFormatId): ConvertFormatDescriptor {
	const format = FORMATS_BY_ID.get(id);
	// The map is built from the exhaustive registry above, so every
	// `ConvertFormatId` resolves; the throw guards a future id added to the
	// union but not the registry.
	if (!format) throw new Error(`Unknown convert format: ${id}`);
	return format;
}

/**
 * Default target for a freshly added file: video inputs go to the most
 * compatible video container (MP4); every non-video input (audio-only, and the
 * degenerate no-track case) falls back to MP3.
 */
export function defaultFormatForInput(info: ConvertInputInfo): ConvertFormatId {
	return info.hasVideo ? 'mp4' : 'mp3';
}

/**
 * Derives the output filename from the input name and target format, swapping
 * the extension (e.g. `clip.mov` → `clip.mp4`). Extensionless names just gain
 * one; a leading-dot name (e.g. `.env`) is treated as having no extension.
 */
export function outputFileName(inputName: string, formatId: ConvertFormatId): string {
	const { extension } = convertFormatById(formatId);
	const dot = inputName.lastIndexOf('.');
	const stem = dot > 0 ? inputName.slice(0, dot) : inputName;
	const base = stem.length > 0 ? stem : 'converted';
	return `${base}.${extension}`;
}

// ── Routing (mirrors the /docs view: a history-backed overlay over the editor) ──

export const CONVERT_BASE_PATH = '/convert';

/** True when the pathname addresses the converter view. */
export function parseConvertPath(pathname: string): boolean {
	const path = pathname.replace(/\/+$/, '') || '/';
	return path === CONVERT_BASE_PATH;
}
