
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
import { Request, Response } from '../requests'
import { Router, cleanPath } from '../routes'
import { Route } from '../types'

export type FullRoute = Required<Omit<Route, 'schema' | 'groups' | 'security' | 'descriptions' | 'hideSchema' | 'onError' | 'onSetupHandler' | '__def'>> & { schema: FastifySchema; onError?: Route['onError'] }
type Schemas = Record<string, Defined<Route['schema']>>

export abstract class Server<Req = any, Res = any> {
	#routesByPath = new Map<string, FullRoute>()
	#routesByKey = new Map<string, FullRoute>()
	#schemas: Schemas = {}
	#listener: Listener | null = null
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
		}
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

	#regRoute (route: Route) {
		const middlewares = [parseAuthUser, ...(route.middlewares ?? [])]
		middlewares.forEach((m) => m.onSetup?.(route))
		route.onSetupHandler?.(route)
		route.onError?.onSetup?.(route)

		const { method, path, handler, schema, security, onError, hideSchema = false } = route
		const pathKey = `(${method.toUpperCase()}) ${path}`
		const { key = pathKey } = route
		const scheme = schema ?? this.#schemas[key] ?? {}
		const fullRoute: FullRoute = {
			method, middlewares, handler, key,
			path: cleanPath(path),
			onError,
			schema: {
				...scheme,
				hide: hideSchema,
				operationId: scheme.operationId ?? handler.name,
				tags: route.groups?.length ? [route.groups.join(' > ')] : undefined,
				description: route.descriptions?.join(' | '),
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
			path: this.settings.openapiDocsPath,
			handler: () => new Response({
				body: openapiHtml
					.replaceAll('__API_TITLE__', this.settings.appId)
					.replaceAll('__OPENAPI_JSON_URL__', this.openapiJsonUrl),
				headers: { 'Content-Type': 'text/html' },
			}),
			hideSchema: true,
		})

		this.addRoute({
			method: 'get',
			path: '__health',
			handler: async () => `${this.settings.appId} service running`,
			schema: {
				response: {
					200: { type: 'string' }
				}
			},
		})

		const started = await this.startServer(port)
		if (started) await Instance.get().logger.info(`${this.settings.appId} service listening on port ${port}`)
		return started
	}
}


const openapiHtml = `
<!doctype html>
<html>
  <head>
    <title>__API_TITLE__</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script id="api-reference" data-url="__OPENAPI_JSON_URL__"></script>
    <script>
      const configuration = {
        theme: 'default',
      };

      document.getElementById('api-reference').dataset.configuration =
        JSON.stringify(configuration);
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>
`