import { ClassPropertiesWrapper } from 'valleyed'
import { AddMethodImpls, GeneralConfig, Methods, Route, RouteConfig, makeController } from './types'

export const groupRoutes = (config: GeneralConfig, routes: Route[]): Route[] => routes
	.map((route) => ({
		...config,
		...route,
		path: `${config.path}/${route.path}`,
		tags: [...(config.tags ?? []), ...(route.tags ?? [])],
		middlewares: [...(config.middlewares ?? []), ...(route.middlewares ?? [])],
		security: [...(config.security ?? []), ...(route.security ?? [])],
	}))


export class Router extends ClassPropertiesWrapper<AddMethodImpls> {
	#config: GeneralConfig = { path: '' }
	#routes: Route[] = []
	#children: Router[] = []

	constructor (config?: GeneralConfig) {
		const methodImpls = Object.fromEntries(Object.values(Methods).map((method) => [method, (route) => this.#addRoute(method, route)])) as AddMethodImpls
		super(methodImpls)
		if (config) this.#config = config
	}

	#addRoute (method: Route['method'], route: RouteConfig, collection: Route[] = this.#routes) {
		return (...args: Parameters<typeof makeController>) => {
			const grouped = groupRoutes(this.#config, [{ ...route, method, handler: makeController(...args) }])
			collection.push(grouped[0])
		}
	}

	include (router: Router) {
		this.#children.push(router)
	}

	get routes () {
		const routes = this.#routes
		this.#children.forEach((child) => {
			child.routes.forEach((route) => {
				this.#addRoute(route.method, route, routes)(route.handler.cb, route.handler.onSetup)
			})
		})
		return routes
	}
}
