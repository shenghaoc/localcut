/**
 * Untyped, lazy loader boundary for `@litertjs/core` (the matte engine's
 * inference runtime). Two reasons it lives in a `.js` file:
 *
 * 1. `@litertjs/core` ships a `declare global` augmentation of the TypedArray
 *    constructors that conflicts with the lib.es generic typed-array typings
 *    used elsewhere. Reaching it through a `.js` boundary (not part of the
 *    type-checked program — `allowJs` is off) keeps that augmentation out of the
 *    TypeScript program; `matte-engine.ts` narrows the result to its own minimal
 *    local interface. The typed surface is declared in `litert-loader.d.ts`.
 *
 * 2. The import is **dynamic**, so `@litertjs/core` code-splits out of the
 *    pipeline worker's startup bundle and only loads when the user first enables
 *    portrait matte. The pipeline worker is an ES-module worker, so dynamic
 *    `import()` is allowed (unlike the classic ASR/cleanup workers).
 */
export function loadLiteRtModule() {
	return import('@litertjs/core');
}
