import { currentIsoTimestamp } from '../time';
import type {
	CapabilityProbeResult,
	ExportPresetDoc,
	ExportPreset,
	ExportVideoCodec,
	ExportContainer,
	ExportSettings,
	OutputNameTemplateContext
} from '../protocol';
import { exportConstraintsForProbe } from './capability-probe-v2';

const TEMPLATE_VARIABLES = new Set([
	'project',
	'preset',
	'codec',
	'date',
	'time',
	'range',
	'index'
]);
const TEMPLATE_VAR_RE = /\{(\w+)\}/g;

export const BUILT_IN_PRESETS: readonly ExportPresetDoc[] = [
	{
		id: 'builtin-1080p-h264-quality',
		name: '1080p H.264 Quality',
		builtIn: true,
		codec: 'h264',
		container: 'mp4',
		width: 1920,
		height: 1080,
		fps: 30,
		videoBitrate: 10_000_000,
		preset: 'quality'
	},
	{
		id: 'builtin-1080p-h264-fast',
		name: '1080p H.264 Fast',
		builtIn: true,
		codec: 'h264',
		container: 'mp4',
		width: 1920,
		height: 1080,
		fps: 30,
		videoBitrate: 5_000_000,
		preset: 'fast'
	},
	{
		id: 'builtin-720p-vp9-fast',
		name: '720p VP9 Fast',
		builtIn: true,
		codec: 'vp9',
		container: 'webm',
		width: 1280,
		height: 720,
		fps: 30,
		videoBitrate: 3_000_000,
		preset: 'fast'
	},
	// Phase 39: Platform export presets
	{
		id: 'builtin-douyin-1080p30',
		name: 'Douyin 1080p 30fps',
		builtIn: true,
		codec: 'h264',
		container: 'mp4',
		width: 1080,
		height: 1920,
		fps: 30,
		videoBitrate: 10_000_000,
		preset: 'quality',
		targetLufs: -14
	},
	{
		id: 'builtin-shorts-1080p30',
		name: 'YouTube Shorts 1080p 30fps',
		builtIn: true,
		codec: 'h264',
		container: 'mp4',
		width: 1080,
		height: 1920,
		fps: 30,
		videoBitrate: 10_000_000,
		preset: 'quality',
		targetLufs: -14
	},
	{
		id: 'builtin-shorts-1080p60',
		name: 'YouTube Shorts 1080p 60fps',
		builtIn: true,
		codec: 'h264',
		container: 'mp4',
		width: 1080,
		height: 1920,
		fps: 60,
		videoBitrate: 15_000_000,
		preset: 'quality',
		targetLufs: -14
	},
	{
		id: 'builtin-reels-1080p30',
		name: 'Instagram Reels 1080p 30fps',
		builtIn: true,
		codec: 'h264',
		container: 'mp4',
		width: 1080,
		height: 1920,
		fps: 30,
		videoBitrate: 10_000_000,
		preset: 'quality',
		targetLufs: -14
	},
	{
		id: 'builtin-xhs-1080p30',
		name: 'Xiaohongshu 1080p 30fps',
		builtIn: true,
		codec: 'h264',
		container: 'mp4',
		width: 1080,
		height: 1350,
		fps: 30,
		videoBitrate: 8_000_000,
		preset: 'quality',
		targetLufs: -14
	},
	{
		id: 'builtin-xhs-square-1080p30',
		name: 'Xiaohongshu Square 30fps',
		builtIn: true,
		codec: 'h264',
		container: 'mp4',
		width: 1080,
		height: 1080,
		fps: 30,
		videoBitrate: 6_000_000,
		preset: 'quality',
		targetLufs: -14
	}
];

function makePresetId(): string {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: `preset-${Math.random().toString(36).slice(2)}`;
}

export function mergePresetsWithBuiltIns(
	userPresets: readonly ExportPresetDoc[]
): ExportPresetDoc[] {
	const userNames = new Set(userPresets.map((p) => p.name));
	const builtIns = BUILT_IN_PRESETS.filter((b) => !userNames.has(b.name));
	return [...builtIns, ...userPresets];
}

export function createPresetFromSettings(
	name: string,
	settings: ExportSettings,
	outputTemplate?: string,
	targetLufs?: number
): ExportPresetDoc {
	return {
		id: makePresetId(),
		name,
		builtIn: false,
		codec: settings.codec,
		container: settings.container,
		width: settings.width,
		height: settings.height,
		fps: settings.fps,
		videoBitrate: settings.videoBitrate,
		preset: settings.preset,
		outputTemplate,
		targetLufs
	};
}

export function presetToSettings(preset: ExportPresetDoc): ExportSettings {
	return {
		preset: preset.preset,
		codec: preset.codec,
		container: preset.container,
		width: preset.width,
		height: preset.height,
		fps: preset.fps,
		videoBitrate: preset.videoBitrate
	};
}

export function updatePreset(
	presets: readonly ExportPresetDoc[],
	updated: ExportPresetDoc
): ExportPresetDoc[] {
	return presets.map((p) => (p.id === updated.id ? { ...updated } : p));
}

export function deletePreset(
	presets: readonly ExportPresetDoc[],
	presetId: string
): ExportPresetDoc[] {
	return presets.filter((p) => p.builtIn || p.id !== presetId);
}

export function duplicatePreset(
	presets: readonly ExportPresetDoc[],
	presetId: string
): { presets: ExportPresetDoc[]; newPreset: ExportPresetDoc | null } {
	const source = presets.find((p) => p.id === presetId);
	if (!source) return { presets: [...presets], newPreset: null };
	const existingNames = new Set(presets.map((p) => p.name));
	let copyName = `${source.name} Copy`;
	let counter = 2;
	while (existingNames.has(copyName)) {
		copyName = `${source.name} Copy ${counter++}`;
	}
	const newPreset: ExportPresetDoc = {
		...source,
		id: makePresetId(),
		name: copyName,
		builtIn: false
	};
	return { presets: [...presets, newPreset], newPreset };
}

export function findPresetByName(
	presets: readonly ExportPresetDoc[],
	name: string
): ExportPresetDoc | undefined {
	return presets.find((p) => p.name === name);
}

export function validateOutputTemplate(template: string): string | null {
	const matches = template.matchAll(TEMPLATE_VAR_RE);
	for (const match of matches) {
		if (!TEMPLATE_VARIABLES.has(match[1]!)) {
			return `Unknown template variable: {${match[1]}}`;
		}
	}
	if (template.length === 0) return 'Template must not be empty';
	return null;
}

function formatRangeForTemplate(startS: number | undefined, endS: number | undefined): string {
	if (startS === undefined || endS === undefined) return 'full';
	const fmt = (s: number): string => {
		const mins = Math.floor(s / 60);
		const secs = Math.floor(s % 60);
		return `${String(mins).padStart(2, '0')}m${String(secs).padStart(2, '0')}s`;
	};
	return `${fmt(startS)}-${fmt(endS)}`;
}

function codecLabelForTemplate(codec: ExportVideoCodec): string {
	switch (codec) {
		case 'h264':
			return 'H264';
		case 'vp9':
			return 'VP9';
		case 'av1':
			return 'AV1';
	}
}

export function expandOutputTemplate(template: string, context: OutputNameTemplateContext): string {
	return template.replace(TEMPLATE_VAR_RE, (_, varName: string) => {
		switch (varName) {
			case 'project':
				return context.project || 'Untitled';
			case 'preset':
				return context.preset;
			case 'codec':
				return context.codec;
			case 'date':
				return context.date;
			case 'time':
				return context.time;
			case 'range':
				return context.range;
			case 'index':
				return String(context.index);
			default:
				return `{${varName}}`;
		}
	});
}

export function sanitizeOutputFileNameBase(name: string): string {
	const sanitized = name
		// Matching control characters is the point: they must never reach a
		// downloaded filename.
		// oxlint-disable-next-line no-control-regex
		.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/[. ]+$/g, '');
	return sanitized || 'export';
}

export function buildTemplateContext(
	projectName: string | undefined,
	presetName: string,
	codec: ExportVideoCodec,
	rangeStartS: number | undefined,
	rangeEndS: number | undefined,
	jobIndex: number
): OutputNameTemplateContext {
	const now = currentIsoTimestamp();
	return {
		project: projectName || 'Untitled',
		preset: presetName,
		codec: codecLabelForTemplate(codec),
		date: now.slice(0, 10),
		time: now.slice(11, 19).replace(/:/g, ''),
		range: formatRangeForTemplate(rangeStartS, rangeEndS),
		index: jobIndex
	};
}

export function clonePresetDoc(preset: ExportPresetDoc): ExportPresetDoc {
	return { ...preset };
}

/**
 * Resolve the best codec/container for a platform preset given the device's
 * encode capabilities. Returns the preset's codec when supported, falls back
 * to the other common codec, or reports blocked when neither is available.
 */
export function resolvePlatformPresetCodec(
	preset: ExportPresetDoc,
	probe: CapabilityProbeResult
): { codec: ExportVideoCodec; container: ExportContainer } | { blocked: true; reason: string } {
	const constraints = exportConstraintsForProbe(probe);
	const supportedCodecs = new Set(constraints.map((c) => c.codec));
	if (supportedCodecs.has(preset.codec)) {
		return { codec: preset.codec, container: preset.container };
	}
	const fallback: ExportVideoCodec = preset.codec === 'h264' ? 'vp9' : 'h264';
	const fallbackContainer: ExportContainer = fallback === 'h264' ? 'mp4' : 'webm';
	if (supportedCodecs.has(fallback)) {
		return { codec: fallback, container: fallbackContainer };
	}
	return {
		blocked: true,
		reason: 'This device cannot encode H.264 or VP9. Platform preset unavailable.'
	};
}

export function parseExportPresetDoc(value: unknown): ExportPresetDoc | null {
	if (!value || typeof value !== 'object') return null;
	const v = value as Record<string, unknown>;
	const id = typeof v.id === 'string' ? v.id : null;
	const name = typeof v.name === 'string' ? v.name : null;
	if (!id || !name) return null;
	const builtIn = v.builtIn === true;
	const codec = v.codec as ExportVideoCodec;
	if (codec !== 'h264' && codec !== 'vp9' && codec !== 'av1') return null;
	const container = v.container as ExportContainer;
	if (container !== 'mp4' && container !== 'webm') return null;
	const width = typeof v.width === 'number' && Number.isFinite(v.width) ? v.width : null;
	const height = typeof v.height === 'number' && Number.isFinite(v.height) ? v.height : null;
	const fps = typeof v.fps === 'number' && Number.isFinite(v.fps) ? v.fps : null;
	const videoBitrate =
		typeof v.videoBitrate === 'number' && Number.isFinite(v.videoBitrate) ? v.videoBitrate : null;
	if (width === null || height === null || fps === null || videoBitrate === null) return null;
	const preset = v.preset as ExportPreset;
	if (preset !== 'quality' && preset !== 'fast') return null;
	const outputTemplate = typeof v.outputTemplate === 'string' ? v.outputTemplate : undefined;
	const targetLufs =
		typeof v.targetLufs === 'number' && Number.isFinite(v.targetLufs) ? v.targetLufs : undefined;
	return {
		id,
		name,
		builtIn,
		codec,
		container,
		width,
		height,
		fps,
		videoBitrate,
		preset,
		outputTemplate,
		targetLufs
	};
}
