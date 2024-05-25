
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
	abstract startServer (port: number): Promise<boolean>
	abstract make(req: Req, res: Res): Promise<Request>
	abstract registerRoute (route: Route): void

	set routes (routes: Route[]) {
		routes.forEach(this.registerRoute)
	}

	register (router: Router) {
		router.routes.forEach(this.registerRoute)
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
