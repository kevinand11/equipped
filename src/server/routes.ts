import { Controller, RouteHandler, makeController } from './controllers'

type MethodTypes = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'all'

export type Route = {
	path: string
	method: MethodTypes
	controllers: Controller[]
}

export const formatPath = (path: string) => `/${path}`
	.replaceAll('///', '/')
	.replaceAll('//', '/')

export const groupRoutes = (parent: string, routes: Route[]): Route[] => routes
	.map((route) => ({ ...route, path: formatPath(`${parent}/${route.path}`) }))


type RouteConfig = Partial<Omit<Route, 'method' | 'controllers'>> & { middlewares?: Route['controllers'] }

export class Router {
	#config?: RouteConfig
	readonly routes: Route[] = []

	constructor (config?: RouteConfig) {
		this.#config = config
	}

	#addRoute (method: Route['method'], route: RouteConfig) {
		return <T>(handler?: RouteHandler<T>) => {
			const controllers = [...(this.#config?.middlewares ?? []), ...(route.middlewares ?? [])]
			if (handler) controllers.push(makeController(handler))
			this.routes.push({
				method,
				controllers,
				path: formatPath(`${this.#config?.path ?? ''}/${route.path ?? ''}`),
			})
		}
	}

	public get (route: RouteConfig) {
		return this.#addRoute('get', route)
	}

	public post (route: RouteConfig) {
		return this.#addRoute('post', route)
	}

	public put (route: RouteConfig) {
		return this.#addRoute('put', route)
	}

	public patch (route: RouteConfig) {
		return this.#addRoute('patch', route)
	}

	public delete (route: RouteConfig) {
		return this.#addRoute('delete', route)
	}

	public all (route: RouteConfig) {
		return this.#addRoute('all', route)
	}

	include (router: Router) {
		router.routes.forEach((route) => {
			this.#addRoute(route.method, route)()
		})
	}
}
