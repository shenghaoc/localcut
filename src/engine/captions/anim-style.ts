/** Phase 30 — Animated caption style model and preset library.
 *
 * Defines the `CaptionAnimStylePreset` type, 10 built-in presets, and
 * resolve/validate helpers. All optional fields default to disabled when
 * absent. Pure, GPU-free — testable in Node.
 */

import type { CaptionAnchor, CaptionLineWrap } from './types';
import type { TitleStyle } from '../title';

export const CAPTION_ANIM_SCHEMA_VERSION = 1;

/**
 * Maximum byte size for an imported preset JSON file (R4.6).
 *
 * Preset files are user-authored stylesheet records with no embedded raster
 * data; 64 KiB is well above any realistic preset. Bounding the read size
 * prevents an oversized file from being decoded into memory before the
 * validator can reject it.
 */
export const MAX_PRESET_FILE_BYTES = 64 * 1024;

export type CaptionAnimKind = 'none' | 'pop' | 'bounce' | 'slide-up' | 'slide-down' | 'typewriter';

export interface CaptionPillConfig {
	paddingXPx: number;
	paddingYPx: number;
	radiusPx: number;
	color: string;
	opacity: number;
}

export interface CaptionAnimConfig {
	enter: CaptionAnimKind;
	exit: CaptionAnimKind;
	durationS: number;
}

export interface CaptionAnimStylePreset {
	captionStyleSchemaVersion: 1;
	id: string;
	label: string;
	builtIn: boolean;
	anchor: CaptionAnchor;
	maxWidthPercent: number;
	lineWrap: CaptionLineWrap;
	insetPx?: { x: number; y: number };
	titleStyle: Partial<TitleStyle>;
	glow?: { color: string; blurPx: number };
	pill?: CaptionPillConfig;
	animation?: CaptionAnimConfig;
	highlightColor?: string;
}

// ── Defaults for every optional field ──────────────────────────────────────

export const ANIM_CAPTION_PRESET_DEFAULTS = {
	insetPx: { x: 64, y: 56 },
	glow: undefined as CaptionAnimStylePreset['glow'],
	pill: undefined as CaptionAnimStylePreset['pill'],
	animation: undefined as CaptionAnimStylePreset['animation'],
	highlightColor: undefined as string | undefined
} as const;

// ── Validation helpers (mirrors isRecord / requiredString / finiteNumber in project.ts) ──

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function finiteNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isCaptionAnchor(value: unknown): value is CaptionAnchor {
	return (
		value === 'bottom-center' ||
		value === 'bottom-left' ||
		value === 'bottom-right' ||
		value === 'top-center' ||
		value === 'custom'
	);
}

function isCaptionLineWrap(value: unknown): value is CaptionLineWrap {
	return value === 'balanced' || value === 'greedy';
}

function isCaptionAnimKind(value: unknown): value is CaptionAnimKind {
	return (
		value === 'none' ||
		value === 'pop' ||
		value === 'bounce' ||
		value === 'slide-up' ||
		value === 'slide-down' ||
		value === 'typewriter'
	);
}

// ── Validate ──────────────────────────────────────────────────────────────

export type ValidationResult =
	| { ok: true; value: CaptionAnimStylePreset }
	| { ok: false; field: string; message: string };

/**
 * Hand-rolled validator using the `isRecord / requiredString / finiteNumber`
 * pattern from `src/engine/project.ts`. Enforces `captionStyleSchemaVersion === 1`,
 * required string `anchor`, `maxWidthPercent` in [20, 100],
 * `animation.durationS` in [0.05, 1.0]. Does NOT validate `id` — the caller
 * assigns a UUID on import.
 */
export function validateCaptionAnimPreset(raw: unknown): ValidationResult {
	if (!isRecord(raw)) return { ok: false, field: '(root)', message: 'Expected an object.' };

	const version = finiteNumber(raw.captionStyleSchemaVersion);
	if (version !== CAPTION_ANIM_SCHEMA_VERSION) {
		return {
			ok: false,
			field: 'captionStyleSchemaVersion',
			message: `Expected ${CAPTION_ANIM_SCHEMA_VERSION}, got ${String(raw.captionStyleSchemaVersion)}.`
		};
	}

	// Bind every checked field to a local `const` of its narrowed type, so the
	// builder below pulls from narrowed locals instead of re-casting `raw.*`.
	// `requiredString` and the `isCaption*` predicates each act as a type
	// guard already, so TypeScript carries the narrowing into the locals.
	const label = requiredString(raw.label);
	if (label === null) {
		return { ok: false, field: 'label', message: 'Required non-empty string.' };
	}

	if (!isCaptionAnchor(raw.anchor)) {
		return { ok: false, field: 'anchor', message: 'Invalid anchor value.' };
	}
	const anchor: CaptionAnchor = raw.anchor;

	const maxWidth = finiteNumber(raw.maxWidthPercent);
	if (maxWidth === null || maxWidth < 20 || maxWidth > 100) {
		return { ok: false, field: 'maxWidthPercent', message: 'Must be a number in [20, 100].' };
	}

	if (!isCaptionLineWrap(raw.lineWrap)) {
		return { ok: false, field: 'lineWrap', message: 'Must be "balanced" or "greedy".' };
	}
	const lineWrap: CaptionLineWrap = raw.lineWrap;

	// Validate animation sub-object if present.
	let animation: CaptionAnimStylePreset['animation'];
	if (raw.animation !== undefined) {
		if (!isRecord(raw.animation)) {
			return { ok: false, field: 'animation', message: 'Expected an object.' };
		}
		const rawAnim = raw.animation;
		if (!isCaptionAnimKind(rawAnim.enter)) {
			return { ok: false, field: 'animation.enter', message: 'Invalid animation kind.' };
		}
		if (!isCaptionAnimKind(rawAnim.exit)) {
			return { ok: false, field: 'animation.exit', message: 'Invalid animation kind.' };
		}
		const dur = finiteNumber(rawAnim.durationS);
		if (dur === null || dur < 0.05 || dur > 1.0) {
			return {
				ok: false,
				field: 'animation.durationS',
				message: 'Must be a number in [0.05, 1.0].'
			};
		}
		animation = { enter: rawAnim.enter, exit: rawAnim.exit, durationS: dur };
	}

	// Validate glow sub-object if present.
	let glow: CaptionAnimStylePreset['glow'];
	if (raw.glow !== undefined) {
		if (!isRecord(raw.glow)) {
			return { ok: false, field: 'glow', message: 'Expected an object.' };
		}
		const glowColor = requiredString(raw.glow.color);
		if (glowColor === null) {
			return { ok: false, field: 'glow.color', message: 'Required non-empty string.' };
		}
		const blur = finiteNumber(raw.glow.blurPx);
		if (blur === null || blur < 0 || blur > 80) {
			return { ok: false, field: 'glow.blurPx', message: 'Must be a number in [0, 80].' };
		}
		glow = { color: glowColor, blurPx: blur };
	}

	// Validate pill sub-object if present.
	let pill: CaptionAnimStylePreset['pill'];
	if (raw.pill !== undefined) {
		if (!isRecord(raw.pill)) {
			return { ok: false, field: 'pill', message: 'Expected an object.' };
		}
		const rawPill = raw.pill;
		const pillFields = ['paddingXPx', 'paddingYPx', 'radiusPx'] as const;
		const dims: Record<(typeof pillFields)[number], number> = {
			paddingXPx: 0,
			paddingYPx: 0,
			radiusPx: 0
		};
		for (const f of pillFields) {
			const v = finiteNumber(rawPill[f]);
			if (v === null || v < 0) {
				return { ok: false, field: `pill.${f}`, message: 'Must be a non-negative number.' };
			}
			dims[f] = v;
		}
		const pillColor = requiredString(rawPill.color);
		if (pillColor === null) {
			return { ok: false, field: 'pill.color', message: 'Required non-empty string.' };
		}
		const op = finiteNumber(rawPill.opacity);
		if (op === null || op < 0 || op > 1) {
			return { ok: false, field: 'pill.opacity', message: 'Must be a number in [0, 1].' };
		}
		pill = { ...dims, color: pillColor, opacity: op };
	}

	// Build the validated value. The `id` field is taken from the raw input
	// when it's a non-empty string — that's the path used when re-hydrating a
	// preset from `project.json`, where the persisted ID is the key segment
	// styles reference. Callers that need a fresh ID (e.g. the file-import flow
	// in `CaptionStyleInspector.openAndImportPreset`) overwrite `id` after
	// validation. Empty string is the safe default for a raw input that
	// somehow omits the field.
	const value: CaptionAnimStylePreset = {
		captionStyleSchemaVersion: 1,
		id: typeof raw.id === 'string' ? raw.id : '',
		label,
		builtIn: Boolean(raw.builtIn),
		anchor,
		maxWidthPercent: maxWidth,
		lineWrap,
		titleStyle: isRecord(raw.titleStyle) ? (raw.titleStyle as Partial<TitleStyle>) : {}
	};

	if (raw.insetPx && isRecord(raw.insetPx)) {
		const ix = finiteNumber(raw.insetPx.x);
		const iy = finiteNumber(raw.insetPx.y);
		if (ix !== null && iy !== null) value.insetPx = { x: ix, y: iy };
	}

	if (glow) value.glow = glow;
	if (pill) value.pill = pill;
	if (animation) value.animation = animation;

	if (typeof raw.highlightColor === 'string' && raw.highlightColor.length > 0) {
		value.highlightColor = raw.highlightColor;
	}

	return { ok: true, value };
}

// ── Built-in presets ──────────────────────────────────────────────────────

function makePreset(
	id: string,
	label: string,
	anchor: CaptionAnchor,
	maxWidthPercent: number,
	lineWrap: CaptionLineWrap,
	titleStyle: Partial<TitleStyle>,
	extras: Pick<
		CaptionAnimStylePreset,
		'glow' | 'pill' | 'animation' | 'highlightColor' | 'insetPx'
	> = {}
): CaptionAnimStylePreset {
	return {
		captionStyleSchemaVersion: 1,
		id,
		label,
		builtIn: true,
		anchor,
		maxWidthPercent,
		lineWrap,
		titleStyle,
		...extras
	};
}

export const ANIM_CAPTION_PRESETS: readonly CaptionAnimStylePreset[] = Object.freeze([
	// 1. subtitle — plain default, no animation
	makePreset('subtitle', 'Subtitle', 'bottom-center', 72, 'balanced', {
		fontSizePx: 64,
		color: '#ffffff',
		backgroundColor: '#000000',
		backgroundOpacity: 0.35,
		outlineColor: '#000000',
		outlineWidthPx: 4,
		shadowColor: '#000000',
		shadowBlurPx: 0,
		shadowOffsetXPx: 0,
		shadowOffsetYPx: 0,
		align: 'center'
	}),
	// 2. lower-third — slide-up enter, charcoal pill
	makePreset(
		'lower-third',
		'Lower Third',
		'bottom-left',
		48,
		'greedy',
		{
			fontSizePx: 52,
			color: '#ffffff',
			outlineColor: '#000000',
			outlineWidthPx: 0,
			shadowColor: '#000000',
			shadowBlurPx: 12,
			shadowOffsetXPx: 0,
			shadowOffsetYPx: 2,
			align: 'left'
		},
		{
			animation: { enter: 'slide-up', exit: 'none', durationS: 0.3 },
			pill: { paddingXPx: 16, paddingYPx: 8, radiusPx: 6, color: 'rgba(30,30,30,0.85)', opacity: 1 }
		}
	),
	// 3. note — no animation, semi-transparent pill
	makePreset(
		'note',
		'Note',
		'top-center',
		56,
		'greedy',
		{
			fontSizePx: 46,
			color: '#ffffff',
			outlineColor: '#000000',
			outlineWidthPx: 0,
			shadowColor: '#000000',
			shadowBlurPx: 8,
			shadowOffsetXPx: 0,
			shadowOffsetYPx: 0,
			align: 'center'
		},
		{
			pill: { paddingXPx: 12, paddingYPx: 6, radiusPx: 8, color: 'rgba(0,0,0,0.55)', opacity: 1 }
		}
	),
	// 4. bold-outline — no animation, no glow/pill
	makePreset('bold-outline', 'Bold Outline', 'bottom-center', 80, 'balanced', {
		fontSizePx: 72,
		color: '#ffffff',
		outlineColor: '#000000',
		outlineWidthPx: 6,
		shadowColor: '#000000',
		shadowBlurPx: 0,
		shadowOffsetXPx: 0,
		shadowOffsetYPx: 0,
		align: 'center'
	}),
	// 5. neon-glow — cyan glow, no animation
	makePreset(
		'neon-glow',
		'Neon Glow',
		'bottom-center',
		72,
		'balanced',
		{
			fontSizePx: 64,
			color: '#00ffff',
			outlineColor: '#004444',
			outlineWidthPx: 2,
			shadowColor: '#000000',
			shadowBlurPx: 0,
			shadowOffsetXPx: 0,
			shadowOffsetYPx: 0,
			align: 'center'
		},
		{
			glow: { color: '#00ffff', blurPx: 20 }
		}
	),
	// 6. karaoke — yellow highlight, no animation
	makePreset(
		'karaoke',
		'Karaoke',
		'bottom-center',
		80,
		'balanced',
		{
			fontSizePx: 64,
			color: '#ffffff',
			outlineColor: '#000000',
			outlineWidthPx: 3,
			shadowColor: '#000000',
			shadowBlurPx: 0,
			shadowOffsetXPx: 0,
			shadowOffsetYPx: 0,
			align: 'center'
		},
		{
			highlightColor: '#ffff00'
		}
	),
	// 7. cinematic — pop (opacity only, scale stays 1), no glow/pill
	makePreset(
		'cinematic',
		'Cinematic',
		'bottom-center',
		64,
		'balanced',
		{
			fontSizePx: 56,
			color: '#f0f0f0',
			outlineColor: '#000000',
			outlineWidthPx: 0,
			shadowColor: '#000000',
			shadowBlurPx: 4,
			shadowOffsetXPx: 0,
			shadowOffsetYPx: 2,
			align: 'center'
		},
		{
			animation: { enter: 'pop', exit: 'none', durationS: 0.4 }
		}
	),
	// 8. pop-card — pop animation, dark pill
	makePreset(
		'pop-card',
		'Pop Card',
		'bottom-center',
		56,
		'greedy',
		{
			fontSizePx: 52,
			color: '#ffffff',
			outlineColor: '#000000',
			outlineWidthPx: 0,
			shadowColor: '#000000',
			shadowBlurPx: 0,
			shadowOffsetXPx: 0,
			shadowOffsetYPx: 0,
			align: 'center'
		},
		{
			animation: { enter: 'pop', exit: 'pop', durationS: 0.25 },
			pill: {
				paddingXPx: 16,
				paddingYPx: 10,
				radiusPx: 12,
				color: 'rgba(20,20,20,0.9)',
				opacity: 1
			}
		}
	),
	// 9. bounce-card — bounce animation, no pill
	makePreset(
		'bounce-card',
		'Bounce Card',
		'bottom-center',
		64,
		'balanced',
		{
			fontSizePx: 60,
			color: '#ffffff',
			outlineColor: '#222222',
			outlineWidthPx: 3,
			shadowColor: '#000000',
			shadowBlurPx: 6,
			shadowOffsetXPx: 0,
			shadowOffsetYPx: 2,
			align: 'center'
		},
		{
			animation: { enter: 'bounce', exit: 'none', durationS: 0.35 }
		}
	),
	// 10. slide-news — slide-up, charcoal pill
	makePreset(
		'slide-news',
		'Slide News',
		'bottom-center',
		80,
		'greedy',
		{
			fontSizePx: 48,
			color: '#ffffff',
			outlineColor: '#000000',
			outlineWidthPx: 0,
			shadowColor: '#000000',
			shadowBlurPx: 0,
			shadowOffsetXPx: 0,
			shadowOffsetYPx: 0,
			align: 'left'
		},
		{
			animation: { enter: 'slide-up', exit: 'slide-down', durationS: 0.3 },
			pill: { paddingXPx: 20, paddingYPx: 8, radiusPx: 4, color: 'rgba(30,30,30,0.9)', opacity: 1 }
		}
	)
]);

// ── Resolve ───────────────────────────────────────────────────────────────

/**
 * Looks up a preset by ID from built-ins then `customPresets`; falls back to
 * `ANIM_CAPTION_PRESETS[0]` (`"subtitle"`) when not found. Never throws.
 */
export function resolveAnimPreset(
	presetId: string | null | undefined,
	customPresets: readonly CaptionAnimStylePreset[]
): CaptionAnimStylePreset {
	if (presetId) {
		const builtin = ANIM_CAPTION_PRESETS.find((p) => p.id === presetId);
		if (builtin) return builtin;
		const custom = customPresets.find((p) => p.id === presetId);
		if (custom) return custom;
	}
	return ANIM_CAPTION_PRESETS[0]!;
}
