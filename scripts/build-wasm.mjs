/**
 * Build script: WAT → WASM + base64 TypeScript.
 *
 * Usage:  npm run build:wasm
 *
 * Reads   src/engine/resampler-simd.wat
 * Writes  src/engine/resampler-simd.wasm
 *         src/engine/resampler-simd-wasm-b64.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import wabtFactory from 'wabt';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const watPath = join(root, 'src', 'engine', 'resampler-simd.wat');
const wasmPath = join(root, 'src', 'engine', 'resampler-simd.wasm');
const b64Path = join(root, 'src', 'engine', 'resampler-simd-wasm-b64.ts');

const watSource = readFileSync(watPath, 'utf8');

const wabt = await wabtFactory();
const mod = wabt.parseWat(watPath, watSource, { simd: true });
const { buffer } = mod.toBinary({});

// Write binary WASM
writeFileSync(wasmPath, Buffer.from(buffer));

// Encode to base64
const b64 = Buffer.from(buffer).toString('base64');

// Wrap at 76 chars per line to match the existing file format
const CHUNK = 76;
const lines = [];
for (let i = 0; i < b64.length; i += CHUNK) {
	lines.push(b64.slice(i, i + CHUNK));
}
const wrapped = lines.join('');

// Write TypeScript module in the exact format of the original file
const ts = `export const WASM_SIMD_RESAMPLER_B64 = "${wrapped}";\n`;
writeFileSync(b64Path, ts);

console.log(`build:wasm: wrote ${buffer.length} bytes → resampler-simd.wasm`);
console.log(`build:wasm: wrote resampler-simd-wasm-b64.ts (${b64.length} base64 chars)`);
