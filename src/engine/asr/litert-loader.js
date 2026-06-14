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
 * 2. It is a **static** import so the whole module bundles into the (classic) ASR
 *    worker. LiteRT's WASM loader uses `importScripts`, which only works in a
 *    classic worker, so the ASR worker is spawned with `{ type: 'classic' }` —
 *    and classic workers cannot use dynamic `import()`. Bundling LiteRT in keeps
 *    every import in that worker static.
 */
import * as litert from '@litertjs/core';

export function loadLiteRtModule() {
	return Promise.resolve(litert);
}
