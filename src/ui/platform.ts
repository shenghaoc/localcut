/**
 * Platform detection for shortcut *labels* only (⌘ vs Ctrl, ⇧ vs Shift, …).
 *
 * Functional shortcut handling treats ⌘ and Ctrl as equivalent (see
 * `keyboard.ts`: `event.metaKey || event.ctrlKey`), so a wrong guess here only
 * mislabels a hint — it never breaks a binding. We therefore use a best-effort
 * layered probe, preferring the modern API and falling back to the deprecated
 * one rather than relying on either alone:
 *
 *   1. `navigator.userAgentData.platform` — the User-Agent Client Hints
 *      replacement for `navigator.platform`. `platform` is a low-entropy hint,
 *      so it resolves synchronously (no `getHighEntropyValues()`). Chromium-only
 *      — `undefined` in Firefox/Safari.
 *   2. `navigator.platform` — deprecated but universally supported; the fallback
 *      for engines where `userAgentData` is absent.
 *   3. `navigator.userAgent` — last resort if `platform` is empty.
 */

/** Minimal shape of the (not-yet-in-lib.dom) `navigator.userAgentData`. */
interface UserAgentDataLike {
	readonly platform?: string;
}

function userAgentData(nav: Navigator): UserAgentDataLike | undefined {
	return (nav as Navigator & { userAgentData?: UserAgentDataLike }).userAgentData;
}

const APPLE_RE = /Mac|iP(hone|ad|od)/;

/** True on macOS/iOS, for choosing Apple modifier glyphs in shortcut labels. */
export function isApplePlatform(): boolean {
	// `typeof null === 'object'`, so guard the null case too (some SSR/test
	// setups define `navigator` as null) before touching its properties.
	if (typeof navigator === 'undefined' || !navigator) return false;

	// `platform` is one of a fixed set ('macOS', 'iOS', 'Windows', 'Linux',
	// 'Android', …). iOS counts (hardware keyboards on iPad/iPhone use the same
	// glyphs). 'Unknown' — returned under privacy hardening or spoofing — is not
	// a "no": fall through to the legacy checks rather than guessing non-Apple.
	const hinted = userAgentData(navigator)?.platform;
	if (hinted) {
		if (hinted === 'macOS' || hinted === 'iOS') return true;
		if (hinted !== 'Unknown') return false;
	}

	if (navigator.platform) return APPLE_RE.test(navigator.platform);
	return APPLE_RE.test(navigator.userAgent);
}

/** Platform-correct glyphs for the modifiers we surface in shortcut hints. */
export interface ModifierGlyphs {
	/** Primary command modifier: ⌘ on Apple, `Ctrl` elsewhere. */
	readonly mod: string;
	/** Shift modifier: ⇧ on Apple, `Shift` elsewhere. */
	readonly shift: string;
	/** Backwards delete: ⌫ on Apple, `Del` elsewhere. */
	readonly del: string;
}

const APPLE_GLYPHS: ModifierGlyphs = { mod: '⌘', shift: '⇧', del: '⌫' };
const PC_GLYPHS: ModifierGlyphs = { mod: 'Ctrl', shift: 'Shift', del: 'Del' };

/**
 * Modifier glyphs for the current platform. `apple` is injectable so callers
 * (and tests) can pin a platform without stubbing `navigator`.
 */
export function modifierGlyphs(apple = isApplePlatform()): ModifierGlyphs {
	return apple ? APPLE_GLYPHS : PC_GLYPHS;
}
