import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { log } from 'node:console';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { createServer } from 'vite-plus';

const PORT = Number(process.env.LOCALCUT_PARITY_PORT ?? 5173);
const HOST = '127.0.0.1';
const DURATION_S = Number(process.env.LOCALCUT_DTLN_PARITY_SECONDS ?? 1);

const THRESHOLDS = {
	maxAbsDiff: Number(process.env.LOCALCUT_DTLN_PARITY_MAX_ABS ?? 0.03),
	meanAbsDiff: Number(process.env.LOCALCUT_DTLN_PARITY_MEAN_ABS ?? 0.001),
	rmsDiff: Number(process.env.LOCALCUT_DTLN_PARITY_RMS ?? 0.0025),
	snrDb: Number(process.env.LOCALCUT_DTLN_PARITY_SNR_DB ?? 42),
	correlation: Number(process.env.LOCALCUT_DTLN_PARITY_CORRELATION ?? 0.995)
};

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { encoding: 'utf8', ...options });
	if (result.status !== 0) {
		throw new Error(
			[`Command failed: ${command} ${args.join(' ')}`, result.stdout.trim(), result.stderr.trim()]
				.filter(Boolean)
				.join('\n')
		);
	}
	return result;
}

function hasCommand(command) {
	const result = spawnSync('which', [command], { encoding: 'utf8' });
	return result.status === 0;
}

function float32FromBuffer(buffer) {
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	const samples = new Float32Array(buffer.byteLength / 4);
	for (let i = 0; i < samples.length; i++) samples[i] = view.getFloat32(i * 4, true);
	return samples;
}

function syntheticVoicedNoisePcm() {
	const sampleRate = 16_000;
	const total = Math.round(DURATION_S * sampleRate);
	const pcm = new Float32Array(total);
	let seed = 0x12345678;
	const noise = () => {
		seed = (1664525 * seed + 1013904223) >>> 0;
		return seed / 0xffffffff - 0.5;
	};
	for (let i = 0; i < total; i++) {
		const t = i / sampleRate;
		const syllable = Math.sin(2 * Math.PI * 3.2 * t) > -0.45 ? 1 : 0.15;
		const envelope = Math.min(1, t * 8, (DURATION_S - t) * 8) * syllable;
		const f0 = 135 + 45 * Math.sin(2 * Math.PI * 0.65 * t);
		const voice =
			0.45 * Math.sin(2 * Math.PI * f0 * t) +
			0.22 * Math.sin(2 * Math.PI * f0 * 2 * t) +
			0.12 * Math.sin(2 * Math.PI * f0 * 3 * t);
		pcm[i] = Math.max(-0.95, Math.min(0.95, envelope * voice + 0.035 * noise()));
	}
	return { pcm, source: 'synthetic-voiced-noise-fallback' };
}

function generateVoicedNoisePcm(workDir) {
	if (!hasCommand('ffmpeg')) {
		return syntheticVoicedNoisePcm();
	}

	const rawPath = join(workDir, 'voiced-noise.f32le');
	run('ffmpeg', [
		'-hide_banner',
		'-loglevel',
		'error',
		'-y',
		'-f',
		'lavfi',
		'-i',
		`sine=frequency=140:duration=${DURATION_S}:sample_rate=16000`,
		'-f',
		'lavfi',
		'-i',
		`sine=frequency=280:duration=${DURATION_S}:sample_rate=16000`,
		'-f',
		'lavfi',
		'-i',
		`sine=frequency=420:duration=${DURATION_S}:sample_rate=16000`,
		'-f',
		'lavfi',
		'-i',
		`anoisesrc=color=pink:amplitude=0.03:duration=${DURATION_S}:sample_rate=16000`,
		'-filter_complex',
		'[0:a]volume=0.35[a0];[1:a]volume=0.18[a1];[2:a]volume=0.08[a2];[a0][a1][a2][3:a]amix=inputs=4:duration=first,alimiter=limit=0.95[out]',
		'-map',
		'[out]',
		'-ac',
		'1',
		'-ar',
		'16000',
		'-f',
		'f32le',
		rawPath
	]);
	return { pcm: float32FromBuffer(readFileSync(rawPath)), source: 'voiced-tone-plus-pink-noise' };
}

function loadExternalPcm(path) {
	if (!existsSync(path)) throw new Error(`LOCALCUT_DTLN_PARITY_PCM does not exist: ${path}`);
	if (!hasCommand('ffmpeg'))
		throw new Error('ffmpeg is required to decode LOCALCUT_DTLN_PARITY_PCM');
	const workDir = mkdtempSync(join(tmpdir(), 'localcut-dtln-parity-input-'));
	try {
		const rawPath = join(workDir, 'input.f32le');
		run('ffmpeg', [
			'-hide_banner',
			'-loglevel',
			'error',
			'-y',
			'-i',
			path,
			'-t',
			String(DURATION_S),
			'-ac',
			'1',
			'-ar',
			'16000',
			'-f',
			'f32le',
			rawPath
		]);
		return { pcm: float32FromBuffer(readFileSync(rawPath)), source: `external:${path}` };
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
}

function metrics(litert, ort) {
	if (litert.length !== ort.length) {
		throw new Error(`Output length mismatch: LiteRT=${litert.length}, ONNX=${ort.length}`);
	}
	let maxAbsDiff = 0;
	let sumAbsDiff = 0;
	let sumSqDiff = 0;
	let litertSq = 0;
	let ortSq = 0;
	let dot = 0;
	for (let i = 0; i < litert.length; i++) {
		const a = litert[i];
		const b = ort[i];
		const diff = a - b;
		const abs = Math.abs(diff);
		if (abs > maxAbsDiff) maxAbsDiff = abs;
		sumAbsDiff += abs;
		sumSqDiff += diff * diff;
		litertSq += a * a;
		ortSq += b * b;
		dot += a * b;
	}
	const meanAbsDiff = sumAbsDiff / litert.length;
	const rmsDiff = Math.sqrt(sumSqDiff / litert.length);
	const litertRms = Math.sqrt(litertSq / litert.length);
	const ortRms = Math.sqrt(ortSq / ort.length);
	const snrDb = 20 * Math.log10(litertRms / Math.max(rmsDiff, 1e-12));
	const correlation = dot / Math.max(Math.sqrt(litertSq * ortSq), 1e-12);
	return { maxAbsDiff, meanAbsDiff, rmsDiff, litertRms, ortRms, snrDb, correlation };
}

function assertPass(stats) {
	const failures = [];
	if (stats.maxAbsDiff > THRESHOLDS.maxAbsDiff) {
		failures.push(`maxAbsDiff ${stats.maxAbsDiff} > ${THRESHOLDS.maxAbsDiff}`);
	}
	if (stats.meanAbsDiff > THRESHOLDS.meanAbsDiff) {
		failures.push(`meanAbsDiff ${stats.meanAbsDiff} > ${THRESHOLDS.meanAbsDiff}`);
	}
	if (stats.rmsDiff > THRESHOLDS.rmsDiff) {
		failures.push(`rmsDiff ${stats.rmsDiff} > ${THRESHOLDS.rmsDiff}`);
	}
	if (stats.snrDb < THRESHOLDS.snrDb) {
		failures.push(`snrDb ${stats.snrDb} < ${THRESHOLDS.snrDb}`);
	}
	if (stats.correlation < THRESHOLDS.correlation) {
		failures.push(`correlation ${stats.correlation} < ${THRESHOLDS.correlation}`);
	}
	if (failures.length > 0) {
		throw new Error(`DTLN ONNX parity check failed:\n- ${failures.join('\n- ')}`);
	}
}

async function runBrowserParity(url, pcm) {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		page.setDefaultTimeout(180_000);
		page.on('console', (msg) => log(`[browser:${msg.type()}] ${msg.text()}`));
		await page.goto(url, { waitUntil: 'domcontentloaded' });
		return await page.evaluate(async (input) => {
			const [
				{ validateManifest },
				{ validateOnnxCleanupManifest },
				{ DtlnRuntime },
				{ DtlnOrtRuntime },
				{ DtlnDsp },
				{ CleanupJobProcessor, concatPcm, trimDtlnOutputToInput }
			] = await Promise.all([
				import('/src/engine/audio-cleanup/model-manifest.ts'),
				import('/src/engine/audio-cleanup/onnx-model-manifest.ts'),
				import('/src/engine/audio-cleanup/dtln-runtime.ts'),
				import('/src/engine/audio-cleanup/dtln-ort-runtime.ts'),
				import('/src/engine/audio-cleanup/dtln-dsp.ts'),
				import('/src/engine/audio-cleanup/cleanup-jobs.ts')
			]);

			async function fetchJson(url) {
				const response = await globalThis.fetch(url);
				if (!response.ok) throw new Error(`${url} returned ${response.status}`);
				return response.json();
			}

			async function fetchAsset(asset) {
				const response = await globalThis.fetch(asset.url);
				if (!response.ok) throw new Error(`${asset.url} returned ${response.status}`);
				const bytes = new Uint8Array(await response.arrayBuffer());
				if (bytes.byteLength !== asset.sizeBytes) {
					throw new Error(`${asset.url} size mismatch: ${bytes.byteLength} !== ${asset.sizeBytes}`);
				}
				const hash = Array.from(
					new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
				)
					.map((byte) => byte.toString(16).padStart(2, '0'))
					.join('');
				if (`sha256-${hash}` !== asset.checksum) {
					throw new Error(`${asset.url} checksum mismatch`);
				}
				return bytes;
			}

			async function processWith(runtime, samples) {
				const processor = new CleanupJobProcessor(new DtlnDsp(), runtime);
				const chunks = [];
				const chunkSize = 16000;
				for (let offset = 0; offset < samples.length; offset += chunkSize) {
					chunks.push(await processor.push(samples.subarray(offset, offset + chunkSize)));
				}
				chunks.push(await processor.finalize());
				const raw = concatPcm(chunks);
				return new Float32Array(trimDtlnOutputToInput(raw, processor.inputSampleCount));
			}

			const litertManifest = validateManifest(await fetchJson('/models/dtln/manifest.json'));
			const onnxManifest = validateOnnxCleanupManifest(
				await fetchJson('/models/dtln-onnx/manifest.json')
			);
			const [litertModel1, litertModel2, onnxModel1, onnxModel2] = await Promise.all([
				fetchAsset(litertManifest.model1),
				fetchAsset(litertManifest.model2),
				fetchAsset(onnxManifest.model1),
				fetchAsset(onnxManifest.model2)
			]);
			const samples = new Float32Array(input);

			const litertRuntime = await DtlnRuntime.create({
				wasmPath: '/litert/',
				accelerator: 'wasm',
				model1Bytes: litertModel1,
				model2Bytes: litertModel2,
				stateShape: litertManifest.stateShape
			});
			const litertOut = await processWith(litertRuntime, samples);
			litertRuntime.destroy();

			const onnxRuntime = await DtlnOrtRuntime.create({
				model1Bytes: onnxModel1,
				model2Bytes: onnxModel2,
				stateShape: onnxManifest.stateShape,
				io: onnxManifest.io,
				executionProviders: onnxManifest.executionProviders
			});
			const onnxOut = await processWith(onnxRuntime, samples);
			onnxRuntime.destroy();

			return {
				litert: Array.from(litertOut),
				onnx: Array.from(onnxOut)
			};
		}, Array.from(pcm));
	} finally {
		await browser.close();
	}
}

async function main() {
	const workDir = mkdtempSync(join(tmpdir(), 'localcut-dtln-parity-'));
	let server;
	try {
		const input = process.env.LOCALCUT_DTLN_PARITY_PCM
			? loadExternalPcm(process.env.LOCALCUT_DTLN_PARITY_PCM)
			: generateVoicedNoisePcm(workDir);

		server = await createServer({
			configFile: join(process.cwd(), 'vite.config.ts'),
			server: { host: HOST, port: PORT, strictPort: true },
			logLevel: 'warn'
		});
		await server.listen();

		const url = `http://${HOST}:${PORT}/`;
		log(`DTLN parity input: ${input.source}, ${input.pcm.length} samples @ 16 kHz`);
		log(`Vite dev server: ${url}`);
		const outputs = await runBrowserParity(url, input.pcm);
		const stats = metrics(outputs.litert, outputs.onnx);
		assertPass(stats);
		log(JSON.stringify({ passed: true, thresholds: THRESHOLDS, metrics: stats }, null, 2));
	} finally {
		await server?.close();
		rmSync(workDir, { recursive: true, force: true });
	}
}

await main();
