import { defineConfig, type Plugin } from 'vite-plus';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const require = createRequire(import.meta.url);
const LITERT_WASM_ROUTE = '/models/litert/';

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

function liteRtWasmAssets(): Plugin {
	const packageRoot = path.dirname(require.resolve('@litertjs/core/package.json'));
	const wasmDir = path.join(packageRoot, 'wasm');
	const files = readdirSync(wasmDir).filter((file) => /\.(?:js|wasm)$/.test(file));

	function serveFile(req: IncomingMessage, res: ServerResponse, next: () => void): void {
		const pathname = req.url?.split('?')[0] ?? '';
		if (!pathname.startsWith(LITERT_WASM_ROUTE)) {
			next();
			return;
		}
		const fileName = decodeURIComponent(pathname.slice(LITERT_WASM_ROUTE.length));
		if (!files.includes(fileName)) {
			next();
			return;
		}
		const filePath = path.join(wasmDir, fileName);
		res.statusCode = 200;
		res.setHeader(
			'Content-Type',
			fileName.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'
		);
		res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
		res.end(readFileSync(filePath));
	}

	return {
		name: 'litert-wasm-assets',
		configureServer(server) {
			server.middlewares.use(serveFile);
		},
		configurePreviewServer(server) {
			server.middlewares.use(serveFile);
		},
		generateBundle() {
			for (const fileName of files) {
				this.emitFile({
					type: 'asset',
					fileName: `models/litert/${fileName}`,
					source: readFileSync(path.join(wasmDir, fileName))
				});
			}
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
		__BUILD_SHA__: JSON.stringify(gitSha())
	},
	plugins: [
		tailwindcss(),
		solid(),
		liteRtWasmAssets(),
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
				// Phase 27: model weights must never precache at install — startup
				// stays model-free. They enter the runtime cache only after the user
				// explicitly loads the model, so later loads work offline.
				globIgnores: ['**/models/**'],
				runtimeCaching: [
					{
						urlPattern: /\/models\/rnnoise\//,
						handler: 'CacheFirst',
						options: { cacheName: 'rnnoise-model' }
					},
					{
						urlPattern: /\/models\/matte\//,
						handler: 'CacheFirst',
						options: { cacheName: 'matte-model' }
					},
					{
						urlPattern: /\/models\/litert\//,
						handler: 'CacheFirst',
						options: { cacheName: 'litert-runtime' }
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
