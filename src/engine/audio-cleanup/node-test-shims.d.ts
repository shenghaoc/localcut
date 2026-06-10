/**
 * Minimal Node built-in declarations for the audio-cleanup asset-verification
 * test, which reads `public/models/rnnoise/` from disk under Vitest's node
 * environment. The project intentionally omits `@types/node` (its globals
 * collide with DOM-typed engine code), so only the exact surface the test
 * uses is declared here.
 */

declare module 'node:fs/promises' {
	export function readFile(path: string): Promise<Uint8Array>;
	export function readFile(path: string, encoding: 'utf-8'): Promise<string>;
}

declare module 'node:path' {
	export function resolve(...segments: string[]): string;
	export function dirname(path: string): string;
	export function join(...segments: string[]): string;
}

declare module 'node:url' {
	export function fileURLToPath(url: string | URL): string;
}
