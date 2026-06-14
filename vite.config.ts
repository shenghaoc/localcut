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

export default defineConfig({
	staged: {
		'*': 'vp check --fix'
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
		__BUILD_SHA__: JSON.stringify(BUILD_SHA)
	},
	plugins: [
		litertRuntimeAssetsPlugin(),
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
				globIgnores: ['**/models/**', '**/litert/**'],
				runtimeCaching: [
					{
						urlPattern: /\/models\/dtln\//,
						handler: 'CacheFirst',
						options: { cacheName: 'dtln-model' }
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
						urlPattern: /\/litert\//,
						handler: 'CacheFirst',
						options: {
							cacheName: 'litert-runtime-v2',
							// LiteRT WASM variants are ~9 MB each; allow them in the cache.
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
