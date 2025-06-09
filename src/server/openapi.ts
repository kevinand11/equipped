import { prepareOpenapiMethod } from '@fastify/swagger/lib/spec/openapi/utils'
// TODO: here to allow us use swagger fastify schema type
import {} from '@fastify/swagger'
// @ts-ignore
import resolver from 'json-schema-resolver'
import { OpenAPIV3_1 } from 'openapi-types'
import { JsonSchema } from 'valleyed'

import { Route } from './types'
import { Instance } from '../instance'
import { Router } from './routes'

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
	response: Partial<Record<'response' | 'responseHeaders', Record<number, JsonSchema>>>
}

export class OpenApi {
	#settings = Instance.get().settings
	#registeredTags: Record<string, boolean> = {}
	#registeredTagGroups: Record<string, { name: string; tags: string[] }> = {}
	#ref = resolver({ clone: true })
	#baseOpenapiDoc: OpenAPIV3_1.Document = {
		openapi: '3.0.0',
		info: { title: `${this.#settings.app} ${this.#settings.appId}`, version: this.#settings.openapi.docsVersion ?? '' },
		servers: this.#settings.openapi.docsBaseUrl?.map((url) => ({ url })),
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
	// @ts-expect-error not impl
	// eslint-disable-next-line no-undef
	#oapi = openapi('./openapi.json', this.#baseOpenapiDoc, { coerce: false })

	cleanPath(path: string) {
		let cleaned = path.replace(/(\/\s*)+/g, '/')
		if (!cleaned.startsWith('/')) cleaned = `/${cleaned}`
		if (cleaned !== '/' && cleaned.endsWith('/')) cleaned = cleaned.slice(0, -1)
		return cleaned
	}

	register(route: Route<any>, def: OpenApiSchemaDef) {
		const noValidation = !Object.keys(def.request).length && !Object.keys(def.response).length
		if (!noValidation || route.hide) return

		const tag = this.#buildTag(route.groups ?? [])

		const operationId = `(${route.method.toUpperCase()}) ${route.path}`
		const openapiSchema = prepareOpenapiMethod(
			{
				...def.request,
				...def.response,
				operationId,
				summary: route.title ?? this.cleanPath(route.path),
				description: route.descriptions?.join('\n\n'),
				tags: tag ? [tag] : undefined,
				security: route.security,
			},
			this.#ref,
			this.#baseOpenapiDoc,
			route.path,
		)
		this.#oapi.path(openapiSchema)
	}

	router() {
		const jsonPath = './openapi.json'
		const router = new Router({ path: this.#settings.openapi.docsPath ?? '/' })
		router.get('/')((req) => req.res({ body: this.#html(jsonPath), headers: { 'Content-Type': 'text/html' } }))
		router.get(jsonPath)((req) => req.res({ body: this.#baseOpenapiDoc }))
		return router
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
		const title = `${this.#settings.app} ${this.#settings.appId}`
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
