import TypescriptOAS, { Definition, Options, createProgram } from 'ts-oas'
import type { CompilerOptions } from 'typescript'
import { Instance } from '../instance'
import { RouteSchema, StatusCodes } from '../server'

const statusCodes = Object.entries(StatusCodes)
const fileSchema = { type: 'string', format: 'binary', example: 'uploaded binary file' }

function isFile (schema: Definition) {
	return schema.type === 'string' && schema.enum?.at(0) === 'equipped-file-schema'
}

export function generateJSONSchema (patterns: (string | RegExp)[], paths: string[], options?: {
	tsConfig?: string | CompilerOptions
	options?: Options
}) {
	const tsProgram = createProgram(paths, options?.tsConfig)

	const logger = Instance.createLogger()

	const tsoas = new TypescriptOAS(tsProgram, {
		ref: false,
		nullableKeyword: false,
		schemaProcessor: (schema) => {
			if (isFile(schema)) return fileSchema
			if (schema.anyOf) schema.anyOf = schema.anyOf.map((s) => isFile(s) ? fileSchema : s)
			if (schema.allOf) schema.allOf = schema.allOf.map((s) => isFile(s) ? fileSchema : s)
			return schema
		},
		...(options?.options ?? {})
	})
	const jsonSchema = tsoas.getSchemas(patterns)

	return Object.entries(jsonSchema)
		.map(([name, { properties: def }]) => {
			try {
				const key: string = def?.key?.enum?.at(0) ?? name
				const isApiDef = def?.__apiDef?.type === 'boolean' && def?.__apiDef?.enum?.[0] === true
				const method = def?.method?.enum?.at?.(0)?.toLowerCase?.()
				if (!def || !isApiDef || !key || !method) return [undefined, undefined] as const
				const response = def.responses.properties ?? def.responses.anyOf?.reduce((acc, cur) => {
					if (cur.properties) return { ...acc, ...cur.properties }
					return acc
				}, {} as Definition) ?? undefined

				if (response) {
					for (const [key, value] of Object.entries(response)) {
						const status = statusCodes.find(([_, code]) => code.toString() === key)
						if (status) value['description'] = `${status[0]} Response`
					}
				}

				const supportsBody = ['post', 'put', 'patch'].includes(method)

				const schema: RouteSchema | undefined = {
					body: supportsBody ? def.body: undefined,
					params: def.params,
					querystring: def.query,
					headers: def.requestHeaders,
					response,
					operationId: key,
					summary: name,
				}

				return [key, schema] as const
			} catch (err) {
				logger.warn(`Error parsing ${name}: ${(err as Error).message}. Skipping route`)
				return [undefined, undefined] as const
			}
		})
		.reduce(
			(acc, [path, schema]) => {
				if (!path || !schema) return acc
				if (acc[path]) logger.warn(`Duplicate route key '${path}' found for '${acc[path].summary}' & '${schema.summary}'. Make sure to use unique keys for all routes because only the last one will be used.`)
				acc[path] = stripEmptyObjects(schema)
				return acc
			},
      {} as Record<string, RouteSchema>
		)
}

function stripEmptyObjects<T extends object>(obj: T) {
	return Object.entries(obj).reduce((acc, [key, value]) => {
		if (!value || typeof value === 'object' && Object.keys(value).length === 0) return acc
		return { ...acc, [key]: value }
	}, {} as T)
}