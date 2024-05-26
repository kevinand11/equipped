
import http from 'http'
import { OpenAPIV3_1 } from 'openapi-types'
import io from 'socket.io'
import supertest from 'supertest'

import { FastifySchema } from 'fastify'
import { Instance } from '../../instance'
import { Listener } from '../../listeners'
import { parseAuthUser } from '../middlewares'
import { Request } from '../requests'
import { Router } from '../routes'
import { Route } from '../types'
import path from 'path'

export type FullRoute = Required<Omit<Route, 'schema' | 'tags' | 'security' | 'onError'>> & { schema: FastifySchema; onError?: Route['onError'] }

export abstract class Server<Req = any, Res = any> {
	#listener: Listener | null = null
	protected server: http.Server
	protected staticPath = path.join(process.cwd(), 'public')
	protected settings = Instance.get().settings
	protected baseSwaggerDoc: OpenAPIV3_1.Document = {
		openapi: '3.0.0',
		info: { title: this.settings.appId, version: this.settings.swaggerDocsVersion },
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

	addRoutes (routes: Route[]) {
		routes.forEach((route) => this.#regRoute(route))
	}

	async load () {
		await this.onLoad()
	}

	register (router: Router | Router[]) {
		const routers = Array.isArray(router) ? router : [router]
		routers.map((router) => router.routes).forEach((routes) => this.addRoutes(routes))
	}

	#regRoute (route: Route) {
		const { method, key, path, middlewares = [], handler, schema, tags = [], security = [], onError } = route
		const allMiddlewares = [parseAuthUser, ...middlewares]
		allMiddlewares.forEach((m) => m.onSetup?.(route))
		handler.onSetup?.(route)
		onError?.onSetup?.(route)
		const fullRoute: FullRoute = {
			method, middlewares, handler, key: key ?? `${method.toLowerCase()} ${path}`,
			path: path.replace(/(\/\s*)+/g, '/'),
			onError,
			schema: {
				...schema,
				querystring: schema?.query,
				tags: [tags.join(' > ') || 'default'],
				security,
			}
		}
		this.registerRoute(fullRoute)
	}

	test () {
		return supertest(this.server)
	}

	async start (port: number) {
		const postRoutesRouter = new Router()
		postRoutesRouter.get({ path: '__health' })(async () => `${Instance.get().settings.appId} service running`)
		this.register(postRoutesRouter)

		const started = await this.startServer(port)
		if (started) await Instance.get().logger.success(`${this.settings.appId} service listening on port`, port)
		return started
	}
}
