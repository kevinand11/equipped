import { fixImportsPlugin } from 'esbuild-fix-imports-plugin'
import { defineConfig, Options } from 'tsup'

const commonOptions: Options = {
	entry: ['src/**/*'],
	sourcemap: true,
	clean: true,
	dts: false,
	minify: false,
	splitting: true,
	bundle: false,
	platform: 'node',
	esbuildPlugins: [fixImportsPlugin()],
	esbuildOptions(options) {
		options.platform = 'node'
	},
}

export default defineConfig([
	{
		...commonOptions,
		format: 'esm',
		outDir: 'dist/esm',
		outExtension: () => ({ js: '.mjs' }),
	},
	{
		...commonOptions,
		format: 'esm',
		outDir: 'dist/esm',
		minify: true,
		outExtension: () => ({ js: '.min.mjs' }),
		clean: false,
	},
	{
		...commonOptions,
		format: 'cjs',
		outDir: 'dist/cjs',
		outExtension: () => ({ js: '.cjs' }),
	},
	{
		...commonOptions,
		format: 'cjs',
		outDir: 'dist/cjs',
		minify: true,
		outExtension: () => ({ js: '.min.cjs' }),
		clean: false,
	},
	{
		...commonOptions,
		format: 'esm',
		outDir: 'dist/types',
		sourcemap: false,
		dts: {
			entry: [
				'src/index.ts',
				'src/cache/index.ts',
				'src/dbs/index.ts',
				'src/errors/index.ts',
				'src/events/index.ts',
				'src/instance/index.ts',
				'src/jobs/index.ts',
				'src/server/index.ts',
				'src/types/index.ts',
				'src/utilities/index.ts',
				'src/validations/index.ts',
			],
		},
	},
])
