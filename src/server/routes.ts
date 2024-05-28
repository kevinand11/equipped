import { ClassPropertiesWrapper } from 'valleyed'
import { AddMethodImpls, GeneralConfig, Methods, Route, RouteConfig, makeController } from './types'

export const groupRoutes = (parent: string, routes: Route[], config?: GeneralConfig): Route[] => routes
	.map((route) => ({
		...(config ?? {}),
		...route,
		path: `${parent}/${route.path}`,
		tags: [...(config?.tags ?? []), ...(route.tags ?? [])],
		middlewares: [...(config?.middlewares ?? []), ...(route.middlewares ?? [])],
		security: [...(config?.security ?? []), ...(route.security ?? [])],
	}))


export class Router extends ClassPropertiesWrapper<AddMethodImpls> {
	#config?: GeneralConfig
	#routes: Route[] = []
	#children: Router[] = []

	constructor (config?: GeneralConfig) {
		// @ts-ignore
		const methodImpls = Object.fromEntries(Object.values(Methods).map((method) => [method, (route: RouteConfig<any>) => this.#addRoute(method, route)])) as AddMethodImpls
		super(methodImpls)
		this.#config = config
	}

	#addRoute (method: Route['method'], route: RouteConfig, collection: Route[] = this.#routes) {
		return <T> (...args: Parameters<typeof makeController<T>>) => {
			const grouped = groupRoutes(this.#config?.path ?? '', [{ ...route, method, handler: makeController(...args) as any }], this.#config)
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
