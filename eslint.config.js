const eslint = require('@eslint/js')
const stylistic = require('@stylistic/eslint-plugin')
const tsEslintPlugin = require('@typescript-eslint/eslint-plugin')
const tsEslintParser = require('@typescript-eslint/parser')
const promise = require('eslint-plugin-promise')
const globals = require('globals')

module.exports = [
	{
		...eslint.configs.recommended,
		files: ['src/**/*.js', 'src/**/*.ts'],
	},
	{
		languageOptions: {
			globals: {
				...globals.commonjs,
				...globals.node,
			},
			parser: tsEslintParser,
			parserOptions: {
				sourceType: 'module',
				ecmaVersion: 2021
			},
		},
		files: ['src/**/*.js', 'src/**/*.ts'],
		plugins: { promise, ts: tsEslintPlugin, style: stylistic },
		rules: {
			'no-console': 'warn',
			'no-debugger': 'error',
			'no-tabs': 'off',
			'no-var': 'error',
			'accessor-pairs': 'off',
			indent: ['error', 'tab', { SwitchCase: 1 }],
			'no-mixed-spaces-and-tabs': ['error', 'smart-tabs'],
			semi: ['error', 'never'],
			'style/semi': ['error', 'never'],
			quotes: ['error', 'single'],
			'prefer-const': ['error'],
			'arrow-parens': ['error', 'always'],
			'no-return-assign': 'off',
			curly: 'off',
			'object-property-newline': 'off',
			'require-atomic-updates': 'off',
			'require-await': 'off',
			'no-unused-vars': 'off',
			'ts/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
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
