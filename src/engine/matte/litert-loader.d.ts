/**
 * Typed surface for `litert-loader.js`. Deliberately returns `unknown` so the
 * `@litertjs/core` type declarations (and their global TypedArray augmentation)
 * never enter the TypeScript program; `matte-engine.ts` narrows the result to
 * its own minimal local interface.
 */
export function loadLiteRtModule(): Promise<unknown>;
