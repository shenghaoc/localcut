/**
 * Untyped loader boundary for `@litertjs/core`.
 *
 * Two reasons this lives in a `.js` file rather than TypeScript:
 *
 * 1. The package ships a `declare global` augmentation of the TypedArray
 *    constructors that conflicts with the lib.es generic typed-array typings used
 *    elsewhere in this repo. Importing it from a `.js` file (not part of the
 *    type-checked program — `allowJs` is off) keeps that augmentation out of the
 *    TypeScript program. The typed surface is declared in `litert-loader.d.ts`.
 *
 * 2. It is a **static** import so the whole module bundles into the lazily spawned
 *    ASR worker and never enters the startup app graph. The typed surface stays
 *    declared in `litert-loader.d.ts`, and the WASM runtime is still loaded only
 *    after the user explicitly loads a LiteRT-backed model.
 */
import * as litert from '@litertjs/core';

export function loadLiteRtModule() {
	return Promise.resolve(litert);
}
