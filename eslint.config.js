import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import solid from 'eslint-plugin-solid';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
	{ ignores: ['dist/**', 'dev-dist/**', 'public/**'] },
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		...solid.configs['flat/typescript'],
		files: ['**/*.{ts,tsx}']
	},
	prettier
);
