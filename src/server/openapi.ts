import { convert } from '@openapi-contrib/json-schema-to-openapi-schema'
import { OpenAPIV3_1 } from 'openapi-types'
import { capitalize, JsonSchema } from 'valleyed'

import { ServerConfig } from './pipes'
import { Router } from './routes'
import { Route } from './types'

declare module 'openapi-types' {
	namespace OpenAPIV3 {
		interface Document {
			'x-tagGroups': { name: string; tags: string[] }[]
		}
		interface TagObject {
			'x-displayName': string
		}
	}
}

export type OpenApiSchemaDef = {
	request: Partial<Record<'body' | 'query' | 'params' | 'headers' | 'response', JsonSchema>>
	response: Partial<Record<'response' | 'responseHeaders', { status: number; schema: JsonSchema; contentType: string }[]>>
}

export class OpenApi {
	#registeredTags: Record<string, boolean> = {}
	#registeredTagGroups: Record<string, { name: string; tags: string[] }> = {}
	#baseOpenapiDoc: OpenAPIV3_1.Document

	constructor(private config: ServerConfig) {
		this.#baseOpenapiDoc = {
			openapi: '3.0.0',
			info: {
				title: `${config.app.name} ${config.app.id}`,
				version: config.config.openapi.docsVersion ?? '',
			},
			servers: config.config.openapi.docsBaseUrl?.map((url) => ({ url })),
			paths: {},
			components: {
				schemas: {},
				securitySchemes: {
					Authorization: {
						type: 'apiKey',
						name: 'authorization',
						in: 'header',
					},
					RefreshToken: {
						type: 'apiKey',
						name: 'x-refresh-token',
						in: 'header',
					},
					ApiKey: {
						type: 'apiKey',
						name: 'x-api-key',
						in: 'header',
					},
				},
			},
			tags: [],
			'x-tagGroups': [],
		}
	}

	cleanPath(path: string) {
		let cleaned = path.replace(/(\/\s*)+/g, '/')
		if (!cleaned.startsWith('/')) cleaned = `/${cleaned}`
		if (cleaned !== '/' && cleaned.endsWith('/')) cleaned = cleaned.slice(0, -1)
		return cleaned
	}

	async register(route: Route<any>, def: OpenApiSchemaDef) {
		if (route.hide) return

		const tag = this.#buildTag(route.groups ?? [])

		const cleanPath = this.cleanPath(route.path)
		const operationId = `(${route.method.toUpperCase()}) ${cleanPath}`
		await this.#addRouteToOpenApiDoc(cleanPath, route.method.toLowerCase(), def, {
			operationId,
			summary: route.title ?? cleanPath,
			description: route.descriptions?.join('\n\n'),
			tags: tag ? [tag] : undefined,
			security: route.security,
		})
	}

	async #addRouteToOpenApiDoc(path: string, method: string, def: OpenApiSchemaDef, methodObj: OpenAPIV3_1.OperationObject) {
		if (def.response.response?.length) {
			methodObj.responses ??= {}
			for (const resp of def.response.response) {
				methodObj.responses[resp.status] ??= { description: '', content: {} }
				const res = methodObj.responses[resp.status] as OpenAPIV3_1.ResponseObject
				res.content![resp.contentType] = { schema: await convert(this.#visit(resp.schema)) }
			}
		}

		if (def.response.responseHeaders?.length) {
			methodObj.responses ??= {}
			for (const resp of def.response.responseHeaders) {
				methodObj.responses[resp.status] ??= { description: '', content: {} }
				methodObj.responses[resp.status] as OpenAPIV3_1.ResponseObject
				const res = methodObj.responses[resp.status] as OpenAPIV3_1.ResponseObject
				res.headers = { schema: (await convert(this.#visit(resp.schema))) as any }
			}
		}

		if (def.request.body)
			methodObj.requestBody = {
				required: true,
				content: {
					'application/json': { schema: await convert(this.#visit(def.request.body)) },
				},
			}

		const parameters: OpenAPIV3_1.ParameterObject[] = []

		const addParams = async (location: 'query' | 'path' | 'header', schema: JsonSchema | undefined) => {
			if (!schema) return
			const flat = this.#flattenForParameters(schema)
			for (const schema of flat) {
				if (!schema.properties) continue
				for (const [name, value] of Object.entries(schema.properties))
					parameters.push({
						name,
						in: location,
						schema: await convert(this.#visit(value)),
						required: (schema.required || []).includes(name),
					})
			}
		}

		await Promise.all([
			addParams('query', def.request.query),
			addParams('path', def.request.params),
			addParams('header', def.request.headers),
		])
		if (parameters.length) methodObj.parameters = parameters

		const base = this.#baseOpenapiDoc
		if (!base.paths) base.paths = {}
		if (!base.paths[path]) base.paths[path] = {}
		base.paths[path]![method] = methodObj
	}

	router() {
		const jsonPath = '/openapi.json'
		const router = new Router({ path: this.config.config.openapi.docsPath ?? '/', hide: true })
		router.get('/')((req) => req.res({ body: this.#html(`.${jsonPath}`), contentType: 'text/html' }))
		router.get(jsonPath)((req) => req.res({ body: this.#baseOpenapiDoc }))
		return router
	}

	#flattenForParameters(node: JsonSchema): JsonSchema[] {
		const { allOf, oneOf, anyOf, ...schema } = node
		if (allOf) return allOf.flatMap((n) => this.#flattenForParameters(n))
		return [schema]
	}

	#visit(node: JsonSchema) {
		if (!node || typeof node !== 'object') return node
		if (typeof node.$refId === 'string') {
			const { $refId: id, ...rest } = node
			const res = this.#visit(rest)
			if (this.#baseOpenapiDoc.components?.schemas) {
				this.#baseOpenapiDoc.components.schemas[id] = res
				return { $ref: `#/components/schemas/${id}` }
			} else return res
		}

		if (Array.isArray(node)) return node.map((n) => this.#visit(n)) as any
		return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, this.#visit(value as any)]))
	}

	#buildTag(groups: NonNullable<Route<any>['groups']>) {
		if (!groups.length) return undefined
		const parsed = groups.map((g) => (typeof g === 'string' ? { name: g } : g))
		const name = parsed.map((g) => g.name).join(' > ')
		const displayName = parsed.at(-1)?.name ?? ''
		const description = parsed
			.map((g) => g.description?.trim() ?? '')
			.filter(Boolean)
			.join('\n\n\n\n')

		if (!this.#registeredTags[name]) {
			this.#registeredTags[name] = true
			this.#baseOpenapiDoc.tags!.push({ name, 'x-displayName': displayName, description })

			const tagGroups = parsed.slice(0, -1)
			const groupName = tagGroups.map((g) => g.name).join(' > ') || 'default'
			if (!this.#registeredTagGroups[groupName]) {
				const group = { name: groupName, tags: [] }
				this.#baseOpenapiDoc['x-tagGroups'].push(group)
				this.#registeredTagGroups[groupName] = group
			}
			this.#registeredTagGroups[groupName].tags = [...new Set([...this.#registeredTagGroups[groupName].tags, name])]
		}

		return name
	}

	#html(jsonPath: string) {
		const title = capitalize(`${this.config.app.name} ${this.config.app.id}`)
		return `
<!doctype html>
<html>
  <head>
    <title>${title}</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
	<style>
      .darklight-reference {
        display: none;
      }
    </style>
  </head>
  <body>
    <script id="api-reference" data-url="${jsonPath}"></script>
    <script>
      const configuration = { theme: 'purple' };
      document.getElementById('api-reference').dataset.configuration = JSON.stringify(configuration);
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.28.33"></script>
  </body>
</html>
`
	}
}
