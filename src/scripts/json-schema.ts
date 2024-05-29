import TypescriptOAS, { Definition, createProgram } from 'ts-oas'
import { Instance } from '../instance'
import { RouteSchema } from '../server'

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
				const schema: RouteSchema | undefined = def
					? {
						body: def.body,
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