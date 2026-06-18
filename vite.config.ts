import { defineConfig } from 'vite-plus';
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const repoRoot = dirname(fileURLToPath(import.meta.url));

function gitSha(): string {
	try {
		return execSync('git rev-parse --short HEAD', {
			stdio: ['ignore', 'pipe', 'ignore'],
			encoding: 'utf-8'
		}).trim();
	} catch {
		return 'dev';
	}
}

const BUILD_SHA = gitSha();

function copyLiteRtRuntimeAssets(): void {
	const sourceDir = join(repoRoot, 'node_modules', '@litertjs', 'core', 'wasm');
	const targetDirs = [
		join(repoRoot, 'public', 'litert'),
		join(repoRoot, 'public', 'litert', BUILD_SHA)
	];
	if (!existsSync(sourceDir)) {
		throw new Error(
			'LiteRT WASM runtime assets are missing. Run `vp install` before building Auto Captions.'
		);
	}

	let copied = 0;
	for (const targetDir of targetDirs) {
		mkdirSync(targetDir, { recursive: true });
		for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
			if (!entry.isFile()) continue;
			copyFileSync(join(sourceDir, entry.name), join(targetDir, entry.name));
			copied += 1;
		}
	}
	if (copied === 0) {
		throw new Error(`LiteRT WASM runtime asset directory is empty: ${sourceDir}`);
	}
}

function litertRuntimeAssetsPlugin() {
	return {
		name: 'localcut-litert-runtime-assets',
		configResolved(config: { command: string }): void {
			if (config.command === 'build') copyLiteRtRuntimeAssets();
		},
		configureServer(): void {
			copyLiteRtRuntimeAssets();
		}
	};
}

function dropBundledOrtWasmPlugin() {
	return {
		// ORT's WASM (`ort-wasm-*.wasm`, up to ~26 MB) is served at runtime from the
		// `/_ort/` proxy (ort-session sets `env.wasm.wasmPaths`), never these bundled
		// copies. Drop them from the build so it stays under Cloudflare's 25 MiB
		// per-asset static limit and out of the service-worker precache.
		name: 'localcut-drop-bundled-ort-wasm',
		apply: 'build' as const,
		generateBundle(_options: unknown, bundle: Record<string, unknown>): void {
			for (const fileName of Object.keys(bundle)) {
				if (/ort-wasm-.*\.wasm$/.test(fileName)) delete bundle[fileName];
			}
		}
	};
}

export default defineConfig({
	staged: {
		'*': 'vp check --fix'
	},
	run: {
		// Tasks defined here are content-cached by default in
		// `node_modules/.vite/task-cache` (unlike package.json scripts, which are
		// not). The `check` script chains these via `vp run`, so each step replays
		// from cache when its inputs are unchanged instead of re-executing. CI
		// persists that directory across runs (see .github/workflows/ci.yml), so a
		// branch re-push only re-runs the steps whose inputs actually changed.
		// `vp cache clean` clears it locally.
		tasks: {
			'format:check': { command: 'vp fmt --check .' },
			lint: { command: 'vp lint . --max-warnings=0' },
			typecheck: { command: 'tsgo --noEmit' },
			test: { command: 'vp test run' },
			build: {
				command: 'vp build',
				// The build define bakes in MATTE_ONNX_SPIKE (see `define` below), so
				// include it in the cache fingerprint — toggling the flag must re-run
				// the build rather than replay a build made with the other value.
				env: ['MATTE_ONNX_SPIKE']
			}
		}
	},
	lint: {
		plugins: ['oxc', 'typescript', 'unicorn', 'react'],
		categories: {
			correctness: 'warn'
		},
		env: {
			builtin: true
		},
		ignorePatterns: ['dist/**', 'dev-dist/**', 'public/**'],
		rules: {
			'constructor-super': 'error',
			'for-direction': 'error',
			'getter-return': 'error',
			'no-async-promise-executor': 'error',
			'no-case-declarations': 'error',
			'no-class-assign': 'error',
			'no-compare-neg-zero': 'error',
			'no-cond-assign': 'error',
			'no-const-assign': 'error',
			'no-constant-binary-expression': 'error',
			'no-constant-condition': 'error',
			'no-control-regex': 'error',
			'no-debugger': 'error',
			'no-delete-var': 'error',
			'no-dupe-class-members': 'error',
			'no-dupe-else-if': 'error',
			'no-dupe-keys': 'error',
			'no-duplicate-case': 'error',
			'no-empty': 'error',
			'no-empty-character-class': 'error',
			'no-empty-pattern': 'error',
			'no-empty-static-block': 'error',
			'no-ex-assign': 'error',
			'no-extra-boolean-cast': 'error',
			'no-fallthrough': 'error',
			'no-func-assign': 'error',
			'no-global-assign': 'error',
			'no-import-assign': 'error',
			'no-invalid-regexp': 'error',
			'no-irregular-whitespace': 'error',
			'no-loss-of-precision': 'error',
			'no-misleading-character-class': 'error',
			'no-new-native-nonconstructor': 'error',
			'no-nonoctal-decimal-escape': 'error',
			'no-obj-calls': 'error',
			'no-prototype-builtins': 'error',
			'no-redeclare': 'error',
			'no-regex-spaces': 'error',
			'no-self-assign': 'error',
			'no-setter-return': 'error',
			'no-shadow-restricted-names': 'error',
			'no-sparse-arrays': 'error',
			'no-this-before-super': 'error',
			'no-undef': 'error',
			'no-unexpected-multiline': 'error',
			'no-unreachable': 'error',
			'no-unsafe-finally': 'error',
			'no-unsafe-negation': 'error',
			'no-unsafe-optional-chaining': 'error',
			'no-unused-labels': 'error',
			'no-unused-private-class-members': 'error',
			'no-unused-vars': 'error',
			'no-useless-backreference': 'error',
			'no-useless-catch': 'error',
			'no-useless-escape': 'error',
			'no-with': 'error',
			'require-yield': 'error',
			'use-isnan': 'error',
			'valid-typeof': 'error',
			'no-array-constructor': 'error',
			'no-unused-expressions': 'error',
			'typescript/ban-ts-comment': 'error',
			'typescript/no-duplicate-enum-values': 'error',
			'typescript/no-empty-object-type': 'error',
			'typescript/no-explicit-any': 'error',
			'typescript/no-extra-non-null-assertion': 'error',
			'typescript/no-misused-new': 'error',
			'typescript/no-namespace': 'error',
			'typescript/no-non-null-asserted-optional-chain': 'error',
			'typescript/no-require-imports': 'error',
			'typescript/no-this-alias': 'error',
			'typescript/no-unnecessary-type-constraint': 'error',
			'typescript/no-unsafe-declaration-merging': 'error',
			'typescript/no-unsafe-function-type': 'error',
			'typescript/no-wrapper-object-types': 'error',
			'typescript/prefer-as-const': 'error',
			'typescript/prefer-namespace-keyword': 'error',
			'typescript/triple-slash-reference': 'error',
			'vite-plus/prefer-vite-plus-imports': 'error'
		},
		overrides: [
			{
				files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
				rules: {
					'constructor-super': 'off',
					'getter-return': 'off',
					'no-class-assign': 'off',
					'no-const-assign': 'off',
					'no-dupe-class-members': 'off',
					'no-dupe-keys': 'off',
					'no-func-assign': 'off',
					'no-import-assign': 'off',
					'no-new-native-nonconstructor': 'off',
					'no-obj-calls': 'off',
					'no-redeclare': 'off',
					'no-setter-return': 'off',
					'no-this-before-super': 'off',
					'no-undef': 'off',
					'no-unreachable': 'off',
					'no-unsafe-negation': 'off',
					'no-var': 'error',
					'no-with': 'off',
					'prefer-const': 'error',
					'prefer-rest-params': 'error',
					'prefer-spread': 'error'
				}
			},
			{
				files: ['**/*.{ts,tsx}'],
				rules: {
					'solid/jsx-no-duplicate-props': 'error',
					'solid/jsx-no-undef': [
						'error',
						{
							typescriptEnabled: true
						}
					],
					'solid/jsx-uses-vars': 'error',
					'solid/no-unknown-namespaces': 'off',
					'solid/no-innerhtml': 'error',
					'solid/jsx-no-script-url': 'error',
					'solid/components-return-once': 'warn',
					'solid/no-destructure': 'error',
					'solid/prefer-for': 'error',
					'solid/reactivity': 'warn',
					'solid/event-handlers': 'warn',
					'solid/imports': 'warn',
					'solid/style-prop': 'warn',
					'solid/no-react-deps': 'warn',
					'solid/no-react-specific-props': 'warn',
					'solid/self-closing-comp': 'warn',
					'solid/no-array-handlers': 'off',
					'solid/prefer-show': 'off',
					'solid/no-proxy-apis': 'off',
					'solid/prefer-classlist': 'off'
				},
				jsPlugins: ['eslint-plugin-solid']
			}
		],
		options: {
			typeAware: true,
			typeCheck: true
		},
		jsPlugins: [
			{
				name: 'vite-plus',
				specifier: 'vite-plus/oxlint-plugin'
			}
		]
	},
	fmt: {
		useTabs: true,
		singleQuote: true,
		trailingComma: 'none',
		printWidth: 100,
		sortPackageJson: false,
		ignorePatterns: ['dist', 'dev-dist', 'coverage', '.kiro/', '.claude/', '.jules/']
	},
	define: {
		__BUILD_SHA__: JSON.stringify(BUILD_SHA),
		// Phase 31 experimental ORT/ONNX matte backend feature flag. Off by default
		// (production ships LiteRT MediaPipe); build with MATTE_ONNX_SPIKE=1 to
		// evaluate the ONNX path. When false, the MatteOnnxEngine branch in the
		// worker is dead-code-eliminated. See docs/ML-RUNTIME.md.
		__MATTE_ONNX_SPIKE__: JSON.stringify(process.env.MATTE_ONNX_SPIKE === '1')
	},
	plugins: [
		litertRuntimeAssetsPlugin(),
		dropBundledOrtWasmPlugin(),
		tailwindcss(),
		solid(),
		VitePWA({
			registerType: 'prompt',
			manifest: {
				name: 'LocalCut Studio',
				short_name: 'LocalCut',
				start_url: '/',
				display: 'standalone',
				background_color: '#16161a',
				theme_color: '#16161a',
				icons: [
					{ src: '/icons/192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/icons/512.png', sizes: '512x512', type: 'image/png' }
				]
			},
			workbox: {
				globPatterns: ['**/*.{js,css,html,wasm,wgsl,woff,woff2}'],
				// Phase 27/29: model weights and the multi-megabyte LiteRT WASM must
				// never precache at install — startup stays model-free, and the SW
				// precache stays small. They enter the runtime cache only after the
				// user explicitly loads a model, so later loads work offline.
				// The ORT foundation adds the same exclusion for its lazily-imported
				// runtime chunks (`*onnxruntime*`), so the ORT runtime is never
				// downloaded at service-worker install (its WASM is proxied at runtime).
				// ORT's WASM is emitted as `ort-wasm-*.wasm` (not `*onnxruntime*`), each
				// > 2 MiB and up to ~26 MB — it must never precache (and is served at
				// runtime from the `/_ort/` proxy, not these bundled copies).
				globIgnores: [
					'**/models/**',
					'**/litert/**',
					'**/*onnxruntime*',
					'**/ort-wasm-*.wasm',
					'**/ort-*.mjs'
				],
				runtimeCaching: [
					{
						urlPattern: /\/models\/dtln\//,
						handler: 'NetworkFirst',
						options: { cacheName: 'dtln-manifest' }
					},
					{
						// DTLN ONNX backend manifest. NetworkFirst (offline fallback) like the
						// other model manifests — the `/models/dtln/` rule above does NOT cover
						// this path (no trailing slash after `dtln`), so without this rule an
						// installed/offline PWA could not reload the ONNX engine even though its
						// model bytes are OPFS-cached. The `.onnx` weights are fetched via the
						// `/_model/gh/` proxy and cached in OPFS by the app, not here.
						urlPattern: /\/models\/dtln-onnx\//,
						handler: 'NetworkFirst',
						options: { cacheName: 'dtln-onnx-manifest' }
					},
					{
						// The Whisper model itself is fetched cross-origin (Hugging Face)
						// and cached in OPFS by the app, so this same-origin rule only
						// covers the small `manifest.json`. It MUST be NetworkFirst, not
						// CacheFirst: the manifest's schema changes between app versions,
						// and a CacheFirst copy would be served stale forever (e.g. an old
						// `encoder`/`decoder` manifest failing today's validator). Network
						// when online, cached copy as an offline fallback.
						urlPattern: /\/models\/whisper\//,
						handler: 'NetworkFirst',
						options: { cacheName: 'whisper-manifest' }
					},
					{
						// ONNX Whisper backend manifest (`/models/whisper-onnx/`). Same
						// NetworkFirst rationale as the LiteRT whisper manifest: schema
						// evolves between app versions, the encoder/decoder ONNX assets are
						// fetched cross-origin and cached in OPFS, so only the small manifest
						// is served same-origin here. (The `whisper` rule above does not
						// match this path — it requires `whisper/`, not `whisper-onnx/`.)
						urlPattern: /\/models\/whisper-onnx\//,
						handler: 'NetworkFirst',
						options: { cacheName: 'whisper-onnx-manifest' }
					},
					{
						// Phase 37: interpolation model manifest. NetworkFirst for the
						// same reason as whisper — the manifest schema changes between
						// app versions, and a CacheFirst copy would serve stale data.
						urlPattern: /\/models\/interpolation\//,
						handler: 'NetworkFirst',
						options: { cacheName: 'interpolation-manifest' }
					},
					{
						urlPattern: /\/litert\//,
						handler: 'CacheFirst',
						options: {
							cacheName: 'litert-runtime-v2',
							// LiteRT WASM variants are ~9 MB each; allow them in the cache.
							matchOptions: { ignoreVary: true }
						}
					},
					{
						// ORT WASM, proxied same-origin from jsDelivr via the Worker's
						// `/_ort/` route (version-pinned upstream). ~26 MB; cached only after
						// the first ORT feature use, so later loads work offline.
						urlPattern: /\/_ort\//,
						handler: 'CacheFirst',
						options: {
							cacheName: 'ort-runtime-v1',
							matchOptions: { ignoreVary: true }
						}
					},
					{
						// The lazily-imported ORT JS runtime chunk (hash-named, immutable).
						urlPattern: /onnxruntime/,
						handler: 'CacheFirst',
						options: { cacheName: 'ort-runtime-chunks-v1' }
					},
					{
						// Phase 33 Smart Reframe: MediaPipe tasks-vision WASM (~11 MB) is
						// loaded from jsdelivr on the user's explicit face-model action;
						// cache it so later loads are instant / offline.
						urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/@mediapipe\/tasks-vision/,
						handler: 'CacheFirst',
						options: {
							cacheName: 'mediapipe-vision-runtime',
							matchOptions: { ignoreVary: true }
						}
					},
					{
						// MediaPipe BlazeFace model from Google's model store.
						urlPattern: /^https:\/\/storage\.googleapis\.com\/mediapipe-models\//,
						handler: 'CacheFirst',
						options: {
							cacheName: 'mediapipe-models',
							matchOptions: { ignoreVary: true }
						}
					}
				]
			}
		})
	],
	assetsInclude: ['**/*.wgsl'],
	worker: { format: 'es' },
	build: { target: 'esnext', outDir: 'dist' },
	server: {
		proxy: {
			'/_model/hf': {
				target: 'https://huggingface.co',
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/_model\/hf\//, '/')
			},
			'/_model/gh': {
				target: 'https://raw.githubusercontent.com',
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/_model\/gh\//, '/')
			},
			'/_model/gcs': {
				target: 'https://storage.googleapis.com',
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/_model\/gcs\//, '/')
			},
			// ORT WASM runtime, proxied from the jsDelivr npm CDN (mirrors the
			// Worker's `/_ort/` route). Keep the pinned version in sync with the
			// onnxruntime-web version in package.json and src/worker/index.ts.
			'/_ort': {
				target: 'https://cdn.jsdelivr.net',
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/_ort\//, '/npm/onnxruntime-web@1.26.0/dist/')
			}
		},
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp'
		}
	},
	preview: {
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp'
		}
	}
});
