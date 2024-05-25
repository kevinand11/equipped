
import http from 'http'
import supertest from 'supertest'

import { Instance } from '../../instance'
import { Listener } from '../../listeners'
import { Request } from '../request'
import { Route, Router } from '../routes'

export type Defined<T> = T extends undefined ? never : T

export abstract class Server<Req = any, Res = any> {
	abstract server: http.Server
	abstract listener: Listener
	settings = Instance.get().settings
	abstract onLoad (): Promise<void>
	abstract startServer (port: number): Promise<boolean>
	protected abstract parse(req: Req, res: Res): Promise<Request>
	abstract registerRoute (route: Route): void

	set routes (routes: Route[]) {
		routes.forEach((route) => this.registerRoute(route))
	}

	async load () {
		await this.onLoad()
	}

	register (router: Router) {
		router.routes.forEach((route) => this.registerRoute(route))
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
