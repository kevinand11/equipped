import { ClassPropertiesWrapper } from 'valleyed'

import type { AddMethodImpls, GeneralConfig, Route, RouteConfig, RouteHandler } from './types'
import { Methods } from './types'

export const cleanPath = (path: string) => {
	let cleaned = path.replace(/(\/\s*)+/g, '/')
	if (!cleaned.startsWith('/')) cleaned = `/${cleaned}`
	if (cleaned !== '/' && cleaned.endsWith('/')) cleaned = cleaned.slice(0, -1)
	return cleaned
}

export const groupRoutes = (config: GeneralConfig, routes: Route[]): Route[] =>
	routes.map((route) => ({
		...config,
		...route,
		path: cleanPath(`${config.path}/${route.path}`),
		groups: [...(config.groups ?? []), ...(route.groups ?? [])],
		middlewares: [...(config.middlewares ?? []), ...(route.middlewares ?? [])],
		security: [...(config.security ?? []), ...(route.security ?? [])],
	}))

export class Router extends ClassPropertiesWrapper<AddMethodImpls> {
	#config: GeneralConfig = { path: '' }
	#routes: Route[] = []
	#children: Router[] = []

	constructor(config?: GeneralConfig) {
		const methodImpls = Object.fromEntries(
			Object.values(Methods).map((method) => [method, (route) => this.#addRoute(method, route)]),
		) as AddMethodImpls
		super(methodImpls)
		if (config) this.#config = config
	}

	#addRoute(method: Route['method'], routeConfig: RouteConfig, collection: Route[] = this.#routes) {
		return (handler: RouteHandler) => {
			const route = groupRoutes(this.#config, [{ ...routeConfig, method, handler }])[0]
			collection.push(route)
			return route
		}
	}

	add(...routes: Route[]) {
		const mapped = groupRoutes(this.#config, routes)
		this.#routes.push(...mapped)
	}

	nest(...routers: Router[]) {
		routers.forEach((router) => this.#children.push(router))
	}

	get routes() {
		const routes = [...this.#routes]
		this.#children.forEach((child) => {
			child.routes.forEach((route) => {
				this.#addRoute(route.method, route, routes)(route.handler)
			})
		})
		return routes
	}
}
