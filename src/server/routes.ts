import { ClassPropertiesWrapper } from 'valleyed'
import { AddMethodImpls, GeneralConfig, Methods, Route, RouteConfig, RouteHandler } from './types'

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

	#addRoute (method: Route['method'], routeConfig: RouteConfig, collection: Route[] = this.#routes) {
		return (handler: RouteHandler) => {
			const route = groupRoutes(this.#config, [{ ...routeConfig, method, handler }])[0]
			collection.push(route)
			return route
		}
	}

	include (router: Router) {
		this.#children.push(router)
	}

	get routes () {
		const routes = this.#routes
		this.#children.forEach((child) => {
			child.routes.forEach((route) => {
				this.#addRoute(route.method, route, routes)(route.handler)
			})
		})
		return routes
	}
}
