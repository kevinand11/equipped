
import http from 'http'
import { OpenAPIV3_1 } from 'openapi-types'
import supertest from 'supertest'

import { FastifySchema } from 'fastify'
import { Instance } from '../../instance'
import { Listener } from '../../listeners'
import { parseAuthUser } from '../middlewares'
import { Request } from '../request'
import { Route, Router } from '../routes'

export type Defined<T> = T extends undefined ? never : T

export type FullRoute = Required<Omit<Route, 'schema'> & { schema: FastifySchema }>

export abstract class Server<Req = any, Res = any> {
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
	abstract listener: Listener
	protected abstract server: http.Server
	protected abstract onLoad (): Promise<void>
	protected abstract startServer (port: number): Promise<boolean>
	protected abstract parse(req: Req, res: Res): Promise<Request>
	protected abstract registerRoute (route: FullRoute): void

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
		const { method, path, middlewares = [], handler, schema, tags = [], security = [] } = route
		const allMiddlewares = [parseAuthUser, ...middlewares]
		allMiddlewares.forEach((m) => m.onSetup?.(route))
		handler.onSetup?.(route)
		const fullRoute: FullRoute = {
			method, middlewares, handler, tags, security,
			path: path.replace(/(\/\s*)+/g, '/'),
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
