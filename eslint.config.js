import eslint from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import tsEslintPlugin from '@typescript-eslint/eslint-plugin'
import tsEslintParser from '@typescript-eslint/parser'
import promise from 'eslint-plugin-promise'
import globals from 'globals'

export default [
	{
		...eslint.configs.recommended,
		files: ['src/**/*.js', 'src/**/*.ts'],
	},
	{
		languageOptions: {
			globals: {
				...globals.node,
			},
			parser: tsEslintParser,
			parserOptions: {
				sourceType: 'module',
				ecmaVersion: 2021
			},
		},
		files: ['src/**/*.js', 'src/**/*.ts'],
		plugins: { promise, ts: tsEslintPlugin, '@stylistic': stylistic },
		rules: {
			'no-console': 'warn',
			'no-debugger': 'error',
			'no-tabs': 'off',
			'no-unused-vars': 0,
			'no-var': 'error',
			'accessor-pairs': 'off',
			indent: ['error', 'tab', { SwitchCase: 1 }],
			'no-mixed-spaces-and-tabs': ['error', 'smart-tabs'],
			semi: ['error', 'never'],
			'@stylistic/semi': ['error', 'never'],
			quotes: ['error', 'single'],
			'prefer-const': ['error'],
			'arrow-parens': ['error', 'always'],
			'no-return-assign': 'off',
			curly: 'off',
			'object-property-newline': 'off',
			'require-atomic-updates': 'off',
			'require-await': 'off'
		},
	}, {
		files: ['tests/**/*.[jt]s?(x)', 'tests/**/*.spec.[jt]s?(x)'],
		languageOptions: {
			globals: {
				jest: true
			}
		},
	}
]
