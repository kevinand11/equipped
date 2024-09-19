
import http from 'http'
import { OpenAPIV3_1 } from 'openapi-types'
import io from 'socket.io'
import supertest from 'supertest'

import { FastifySchema } from 'fastify'
import path from 'path'
import { Instance } from '../../instance'
import { Listener } from '../../listeners'
import { Defined } from '../../types'
import { parseAuthUser } from '../middlewares'
import { Request } from '../requests'
import { Router, cleanPath } from '../routes'
import { Route, StatusCodes } from '../types'

export type FullRoute = Required<Omit<Route, 'schema' | 'groups' | 'security' | 'descriptions' | 'hideSchema' | 'onError' | 'onSetupHandler' | '__def'>> & { schema: FastifySchema; onError?: Route['onError'] }
type Schemas = Record<string, Defined<Route['schema']>>

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

export abstract class Server<Req = any, Res = any> {
	#routesByPath = new Map<string, FullRoute>()
	#routesByKey = new Map<string, FullRoute>()
	#schemas: Schemas = {}
	#listener: Listener | null = null
	#registeredTags: Record<string, boolean>  = {}
	#registeredTagGroups: Record<string, { name: string; tags: string[] }>  = {}
	protected server: http.Server
	protected staticPath = path.join(process.cwd(), 'public')
	protected settings = Instance.get().settings
	protected openapiJsonUrl = `${this.settings.openapiDocsPath}/openapi.json`
	protected baseOpenapiDoc: OpenAPIV3_1.Document = {
		openapi: '3.0.0',
		info: { title: this.settings.appId, version: this.settings.openapiDocsVersion },
		servers: this.settings.openapiDocsBaseUrl.map((url) => ({ url })),
		paths: {},
		components: {
			schemas: {},
			securitySchemes: {
				AccessToken: {
					type: 'apiKey',
					name: 'Access-Token',
					in: 'header',
				},
				RefreshToken: {
					type: 'apiKey',
					name: 'Refresh-Token',
					in: 'header',
				}
			},
		},
		tags: [],
		'x-tagGroups': [],
	}
	protected abstract onLoad (): Promise<void>
	protected abstract startServer (port: number): Promise<boolean>
	protected abstract parse(req: Req, res: Res): Promise<Request>
	protected abstract registerRoute (route: FullRoute): void

	constructor (server: http.Server) {
		this.server = server
	}

	get listener () {
		if (!this.#listener) {
			const socket = new io.Server(this.server, { cors: { origin: '*' } })
			this.#listener = new Listener(socket, {
				onConnect: async () => { },
				onDisconnect: async () => { }
			})
		}
		return this.#listener
	}

	addRouter (...routers: Router[]) {
		routers.map((router) => router.routes).forEach((routes) => this.addRoute(...routes))
	}

	addRoute (...routes: Route[]) {
		routes.forEach((route) => this.#regRoute(route))
	}

	addSchema (...schemas: Schemas[]) {
		schemas.forEach((schema) => Object.assign(this.#schemas, schema))
	}

	async load () {
		await this.onLoad()
	}

	#buildTag (groups: Defined<Route['groups']>) {
		if (!groups.length) return undefined
		const parsed = groups.map((g) => typeof g === 'string' ? { name: g } : g)
		const name = parsed.map((g) => g.name).join(' > ')
		const displayName = parsed.at(-1)?.name ?? ''
		const description = parsed.map((g) => g.description?.trim() ?? '').filter(Boolean).join('\n\n\n\n')

		if (!this.#registeredTags[name]) {
			this.#registeredTags[name] = true
			this.baseOpenapiDoc.tags!.push({ name, 'x-displayName': displayName, description })

			const tagGroups = parsed.slice(0, -1)
			const groupName = tagGroups.map((g) => g.name).join(' > ') || 'default'
			if (!this.#registeredTagGroups[groupName]) {
				const group = { name: groupName, tags: [] }
				this.baseOpenapiDoc['x-tagGroups'].push(group)
				this.#registeredTagGroups[groupName] = group
			}
			this.#registeredTagGroups[groupName].tags = [...new Set([...this.#registeredTagGroups[groupName].tags, name])]
		}

		return name
	}

	#regRoute (route: Route) {
		const middlewares = [parseAuthUser, ...(route.middlewares ?? [])]
		route.onSetupHandler?.(route)
		middlewares.forEach((m) => m.onSetup?.(route))
		route.onError?.onSetup?.(route)

		const { method, path, handler, schema, security, onError, hideSchema = false } = route
		const pathKey = `(${method.toUpperCase()}) ${path}`
		const { key = pathKey } = route

		const tag = this.#buildTag(route.groups ?? [])

		const scheme = Object.assign({}, schema, this.#schemas[key])
		const fullRoute: FullRoute = {
			method, middlewares, handler, key,
			path: cleanPath(path),
			onError,
			schema: {
				...scheme,
				...(scheme.title ? { summary: scheme.title } : {}),
				summary: scheme.title ?? scheme.summary ?? cleanPath(path),
				hide: hideSchema,
				tags: tag ? [tag] : undefined,
				description: route.descriptions?.join('\n\n'),
				security,
			}
		}
		if (this.#routesByPath.get(pathKey)) throw new Error(`Route path ${pathKey} already registered. All route paths and methods combinations must be unique`)
		if (this.#routesByKey.get(key)) throw new Error(`Route key ${fullRoute.key} already registered. All route keys must be unique`)
		this.#routesByPath.set(pathKey, fullRoute)
		this.#routesByKey.set(key, fullRoute)
		this.registerRoute(fullRoute)
	}

	test () {
		return supertest(this.server)
	}

	async start (port: number) {
		this.addRoute({
			method: 'get',
			path: `${this.settings.openapiDocsPath}/`,
			handler: (req) => req.res({
				body: '',
				status: StatusCodes.Found,
				headers: { 'Location': './index.html' },
			}),
			hideSchema: true,
		})

		this.addRoute({
			method: 'get',
			path: `${this.settings.openapiDocsPath}/index.html`,
			handler: (req) => req.res({
				body: scalarHtml
					.replaceAll('__API_TITLE__', this.settings.appId)
					.replaceAll('__OPENAPI_JSON_URL__', './openapi.json'),
				headers: { 'Content-Type': 'text/html' },
			}),
			hideSchema: true,
		})

		this.addRoute({
			method: 'get',
			path: `${this.settings.openapiDocsPath}/redoc.html`,
			handler: (req) => req.res({
				body: redocHtml
					.replaceAll('__API_TITLE__', this.settings.appId)
					.replaceAll('__OPENAPI_JSON_URL__', './openapi.json'),
				headers: { 'Content-Type': 'text/html' },
			}),
			hideSchema: true,
		})

		this.addRoute({
			method: 'get',
			path: '__health',
			handler: async (req) => req.res({
				body: `${this.settings.appId} service running`,
				headers: { 'Content-Type': 'text/plain' },
			}),
			hideSchema: true,
		})

		const started = await this.startServer(port)
		if (started) await Instance.get().logger.info(`${this.settings.appId} service listening on port ${port}`)
		return started
	}
}


const scalarHtml = `
<!doctype html>
<html>
  <head>
    <title>__API_TITLE__</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
	<style>
      .darklight-reference {
        display: none;
      }
    </style>
  </head>
  <body>
    <script id="api-reference" data-url="__OPENAPI_JSON_URL__"></script>
    <script>
      const configuration = { theme: 'purple' };
      document.getElementById('api-reference').dataset.configuration = JSON.stringify(configuration);
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.12"></script>
  </body>
</html>
`

const redocHtml = `
<!doctype html>
<html>
  <head>
    <title>__API_TITLE__</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
	<style>
      body {
        margin: 0;
        padding: 0;
      }
    </style>
  </head>
  <body>
    <redoc spec-url="__OPENAPI_JSON_URL__"></redoc>
    <script src="https://cdn.jsdelivr.net/npm/redoc@2.1.5/bundles/redoc.standalone.js"></script>
  </body>
</html>
`