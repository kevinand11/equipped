import TypescriptOAS, { Definition, Options, createProgram } from 'ts-oas'
import { Instance } from '../instance'
import { RouteSchema, StatusCodes } from '../server'

const fileSchema = { type: 'string', format: 'binary' }

const statusCodes = Object.entries(StatusCodes)

export function generateJSONSchema (patterns: (string | RegExp)[], paths: string[], options?: {
	tsConfigPath?: string | Record<string, unknown>
	options?: Options
}) {
	const tsProgram = createProgram(paths, options?.tsConfigPath)

	const logger = Instance.createLogger()

	const tsoas = new TypescriptOAS(tsProgram, {
		ref: false,
		nullableKeyword: false,
		...(options?.options ?? {})
	})
	const jsonSchema = tsoas.getSchemas(patterns)

	return Object.entries(jsonSchema)
		.map(([name, { properties: def }]) => {
			try {
				const key: string = def?.key?.enum?.at(0) ?? name
				if (!def || !key || !def.method || !def.__apiDef) return [undefined, undefined] as const
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

				const body = def.body ?? {}
				if (def.files?.properties) {
					const files = def.files ?? {}
					if (!body.type) body.type = 'object'
					if (!body.properties) body.properties = {}
					if (!body.required) body.required = []
					Object.entries(files.properties ?? {}).forEach(([key, value]) => {
						const isMultiple = !!value.enum?.at(0)
						const fileValue = isMultiple ? { type: 'array', items: fileSchema } : fileSchema
						body.properties![key] = {
							anyOf: [fileValue, body.properties![key]].filter(Boolean)
						}
						if (files.required?.includes(key) && !body.required?.includes(key)) body.required!.push(key)
					})
				}

				const schema: RouteSchema | undefined = {
					body,
					params: def.params,
					querystring: def.query,
					headers: def.headers,
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