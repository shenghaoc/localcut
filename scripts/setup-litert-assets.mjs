#!/usr/bin/env node
/**
 * Vendors the LiteRT.js WASM runtime into `public/litert/` so the ASR worker can
 * load it same-origin (COOP/COEP-safe) at runtime via `loadLiteRt('/litert/')`.
 *
 * The LiteRT *JavaScript* API is bundled by Vite as a lazy chunk (see
 * `src/engine/asr/litert-loader.js`); only the ~9 MB WASM payload needs to be
 * served as a static same-origin asset, which this script copies from the pinned
 * `@litertjs/core` package. The copied directory is git-ignored — it is derived
 * from the locked dependency and re-created on demand — and `vp install` runs
 * this automatically via the `postinstall` script.
 *
 * The Whisper model assets themselves (encoder/decoder TFLite + tokenizer) are
 * NOT downloaded here: they are large, license-bound, and provisioned per the
 * manifest at `public/models/whisper/`. See that directory's README.
 */
import console from 'node:console';
import { mkdir, readdir, copyFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const sourceDir = join(repoRoot, 'node_modules', '@litertjs', 'core', 'wasm');
const targetDir = join(repoRoot, 'public', 'litert');

async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function main() {
	if (!(await exists(sourceDir))) {
		// Not installed (e.g. a docs-only checkout) — skip quietly so postinstall
		// never fails the install.
		console.warn('[setup-litert] @litertjs/core not found; skipping WASM copy.');
		return;
	}
	await mkdir(targetDir, { recursive: true });
	const entries = await readdir(sourceDir, { withFileTypes: true });
	let copied = 0;
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		await copyFile(join(sourceDir, entry.name), join(targetDir, entry.name));
		copied += 1;
	}
	console.log(`[setup-litert] Copied ${copied} LiteRT WASM file(s) to public/litert/.`);
}

main().catch((error) => {
	console.error('[setup-litert] Failed:', error);
	process.exitCode = 1;
});
