import { defineConfig } from 'vite-plus';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

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
const APP_VERSION: string = JSON.parse(
	readFileSync(new URL('./package.json', import.meta.url), 'utf-8')
).version;

// Mirror the build SHA into the environment so the Vite+ task runner can fold
// it into the `check:build` cache fingerprint (see run.tasks below): the SHA is
// baked into the bundle via `define` but is not an input file, so without this
// a no-source-change commit would replay a build carrying the previous SHA.
process.env.LOCALCUT_BUILD_SHA = BUILD_SHA;

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
		// The quality-gate steps are declared as tasks (not just package.json
		// scripts) so `vp run` content-caches each one in
		// `node_modules/.vite/task-cache`; the `check` script chains them. A task
		// may not share a name with a package.json script, so these use a `check:`
		// prefix — the canonical `lint`/`test`/`build`/… scripts stay for direct
		// `pnpm <script>` use. CI persists the cache dir across runs (see
		// .github/workflows/ci.yml); `vp cache clean` clears it locally.
		tasks: {
			'check:format': { command: 'vp fmt --check .' },
			'check:lint': { command: 'vp lint . --max-warnings=0' },
			'check:typecheck': { command: 'tsgo --noEmit' },
			// Under CI=true, vitest writes test-results/junit-node.xml (see
			// vitest.config.ts) — Vite+ detects the read+write on that path
			// and forces check:test to re-run each time, so any GHA test-
			// reporter consumer always sees a fresh JUnit XML. Locally
			// (CI unset) the reporter is off, no file is touched, and the
			// task caches normally. Declaring `output:` here would be
			// misleading: it can't restore the file because vp considers the
			// task uncacheable anyway.
			'check:test': { command: 'vp test run' },
			'check:build': {
				command: 'vp build',
				// BUILD_SHA is baked into the bundle via `define` but is not an input
				// file, so list it in the cache fingerprint: a new commit (SHA,
				// mirrored to env above) must re-run the build instead of replaying a
				// stale bundle.
				env: ['LOCALCUT_BUILD_SHA']
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
		__APP_VERSION__: JSON.stringify(APP_VERSION)
	},
	plugins: [
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
				// Model weights must never precache at install — startup stays
				// model-free, and the SW precache stays small. ORT runtime chunks are
				// also excluded; its WASM is served at runtime from the `/_ort/` proxy.
				// ORT's WASM is emitted as `ort-wasm-*.wasm` (not `*onnxruntime*`), each
				// > 2 MiB and up to ~26 MB — it must never precache (and is served at
				// runtime from the `/_ort/` proxy, not these bundled copies).
				globIgnores: ['**/models/**', '**/*onnxruntime*', '**/ort-wasm-*.wasm', '**/ort-*.mjs'],
				runtimeCaching: [
					{
						// DTLN ONNX backend manifest. NetworkFirst prevents an installed PWA
						// from keeping an old model contract after app updates. The `.onnx`
						// weights are fetched via the `/_model/gh/` proxy and cached in OPFS.
						urlPattern: /\/models\/dtln-onnx\//,
						handler: 'NetworkFirst',
						options: { cacheName: 'dtln-onnx-manifest' }
					},
					{
						// ONNX Whisper manifests are NetworkFirst because manifest schema,
						// size, SHA, and provenance can change between app versions. The
						// encoder/decoder assets are cached in OPFS, not Workbox.
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
						// Phase 33: Smart Reframe face-detector manifest.
						// NetworkFirst keeps model metadata fresh while the ORT asset
						// loader handles byte-level OPFS caching by SHA-256.
						urlPattern: /\/models\/reframe-face\//,
						handler: 'NetworkFirst',
						options: { cacheName: 'reframe-face-manifest' }
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
