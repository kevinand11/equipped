import { defineConfig, Options } from 'tsup'

const commonOptions: Options = {
	entry: {
		index: 'src/index.ts',
		cache: 'src/cache/index.ts',
		dbs: 'src/dbs/index.ts',
		errors: 'src/errors/index.ts',
		events: 'src/events/index.ts',
		jobs: 'src/jobs/index.ts',
		server: 'src/server/index.ts',
		types: 'src/types/index.ts',
		utilities: 'src/utilities/index.ts',
		validations: 'src/validations/index.ts',
	},
	sourcemap: true,
	clean: true,
	dts: false,
	minify: false,
	splitting: true,
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
		format: 'cjs',
		outDir: 'dist/cjs',
		minify: true,
		outExtension: () => ({ js: '.min.cjs' }),
		clean: false,
	},
	{
		entry: commonOptions.entry,
		dts: true,
		format: 'esm',
		outDir: 'dist/types',
		clean: false,
	},
])
