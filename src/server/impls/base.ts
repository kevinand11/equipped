
import http from 'http'
import supertest from 'supertest'

import { Instance } from '../../instance'
import { Listener } from '../../listeners'
import { parseAuthUser } from '../middlewares'
import { Request } from '../request'
import { Route, Router, formatPath } from '../routes'

export type Defined<T> = T extends undefined ? never : T

export abstract class Server<Req = any, Res = any> {
	protected settings = Instance.get().settings
	abstract listener: Listener
	protected abstract server: http.Server
	protected abstract onLoad (): Promise<void>
	protected abstract startServer (port: number): Promise<boolean>
	protected abstract parse(req: Req, res: Res): Promise<Request>
	protected abstract registerRoute (route: Required<Route>): void

	set routes (routes: Route[]) {
		routes.forEach((route) => this.#regRoute(route))
	}

	async load () {
		await this.onLoad()
	}

	register (router: Router) {
		router.routes.forEach((route) => this.#regRoute(route))
	}

	#regRoute (route: Route) {
		const { method, path, middlewares = [], handler, schema = {}, tags = [], security = [] } = route
		const allMiddlewares = [parseAuthUser, ...middlewares]
		allMiddlewares.forEach((m) => m.onSetup?.(route))
		this.registerRoute({
			method, middlewares, handler, schema, tags, security,
			path: formatPath(path),
		})
	}

	test () {
		return supertest(this.server)
	}

	async start (port: number) {
		const postRoutesRouter = new Router()
		postRoutesRouter.get({ path: '__health' })(async () => `${Instance.get().settings.appId} service running`)
		this.register(postRoutesRouter)

		return await this.startServer(port)
	}
}
