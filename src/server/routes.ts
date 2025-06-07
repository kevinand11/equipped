import { ClassPropertiesWrapper } from 'valleyed'

import { AddMethodDefImpls, Methods, RouteDefHandler, RouteGeneralConfig, Route, MethodsEnum, RouteConfig, RouteDef } from './types'

export const cleanPath = (path: string) => {
	let cleaned = path.replace(/(\/\s*)+/g, '/')
	if (!cleaned.startsWith('/')) cleaned = `/${cleaned}`
	if (cleaned !== '/' && cleaned.endsWith('/')) cleaned = cleaned.slice(0, -1)
	return cleaned
}

export const groupRoutes = <T extends RouteDef>(config: RouteGeneralConfig<T>, routes: Route<T>[]): Route<T>[] =>
	routes.map((route) => ({
		...config,
		...route,
		path: cleanPath(`${config.path}/${route.path}`),
		groups: [...(config.groups ?? []), ...(route.groups ?? [])],
		middlewares: [...(config.middlewares ?? []), ...(route.middlewares ?? [])],
		security: [...(config.security ?? []), ...(route.security ?? [])],
	}))

export class Router extends ClassPropertiesWrapper<AddMethodDefImpls> {
	#config: RouteGeneralConfig<any> = { path: '' }
	#routes: Route<any>[] = []
	#children: Router[] = []

	constructor(config?: RouteGeneralConfig<any>) {
		super(
			Object.values(Methods).reduce(
				(acc, method) => ({
					...acc,
					[method]:
						(...args: Parameters<AddMethodDefImpls[MethodsEnum]>) =>
						(handler: RouteDefHandler<any>) =>
							this.#addRoute(method, ...args, handler),
				}),
				{} as any,
			),
		)
		if (config) this.#config = config
	}

	#addRoute<T extends RouteDef>(
		method: MethodsEnum,
		path: string,
		routeConfig: RouteConfig<T> = {},
		handler: RouteDefHandler<T>,
		collection: Route<T>[] = this.#routes,
	) {
		const route = groupRoutes(this.#config, [{ ...routeConfig, path, method, handler }])[0]
		collection.push(route)
		return route
	}

	add<T extends RouteDef>(...routes: Route<T>[]) {
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
				this.#addRoute(route.method, route.path, route, route.handler, routes)
			})
		})
		return routes
	}
}
