import TypescriptOAS, { Definition, createProgram } from 'ts-oas'
import { Instance } from '../instance'
import { RouteSchema } from '../server'

const fileSchema = { type: 'string', format: 'binary' }

export function generateJSONSchema (patterns: (string | RegExp)[], paths: string[]) {
	const tsProgram = createProgram(paths, { strictNullChecks: true })

	const tsoas = new TypescriptOAS(tsProgram, { ref: false, ignoreErrors: true })
	const jsonSchema = tsoas.getSchemas(patterns)

	return Object.entries(jsonSchema)
		.map(([name, { properties: def }]) => {
			try {
				const key: string = def?.key?.enum?.at(0) ?? name
				if (!def || !key || !def.method) throw new Error()
				const response = def.responses.properties ?? def.responses.anyOf?.reduce((acc, cur) => {
					if (cur.properties) return { ...acc, ...cur.properties }
					return acc
				}, {} as Definition) ?? undefined

				const body = def.body ?? {}
				if (def.files?.properties) {
					const files = def.files ?? {}
					if (!body.type) body.type = 'object'
					if (!body.properties) body.properties = {}
					if (!body.required) body.required = []
					Object.entries(files.properties ?? {}).forEach(([key, value]) => {
						const isMultiple = !!value.enum?.at(0)
						body.properties![key] = isMultiple ? { type: 'array', items: fileSchema } : fileSchema
						if (files.required?.includes(key)) body.required!.push(key)
					})
				}

				const schema: RouteSchema | undefined = def
					? {
						body,
						params: def.params,
						querystring: def.query,
						headers: def.headers,
						response,
						operationId: key,
						summary: name,
					}
					: undefined
				return [key, schema] as const
			} catch (err) {
				Instance.createLogger().warn(`Error parsing ${name}: ${(err as Error).message}. Skipping route`)
				return [undefined, undefined] as const
			}
		})
		.reduce(
			(acc, [path, schema]) => {
				if (path && schema) acc[path] = stripEmptyObjects(schema)
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