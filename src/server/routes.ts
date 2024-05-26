import { Request, Response } from './request'

type MethodTypes = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'all'
type Res<T> = Response<T> | T
type RouteHandler<T> = (req: Request) => Promise<Res<T>>
type RouteMiddlewareHandler = (req: Request) => Promise<void>

export type Schema = {
  body?: any;
  query?: any;
  params?: any;
  headers?: any;
  response?: Record<string, any>;
}

export type Route = {
	path: string
	method: MethodTypes
	handler: RouteHandler<any>
	middlewares?: ReturnType<typeof makeMiddleware>[]
	schema?: Schema
	tags?: string[]
	security?: Record<string, string[]>[]
}

type RouteConfig = Omit<Route, 'method' | 'handler'>
type GeneralConfig = Omit<RouteConfig, 'schema'>

export const makeController = <T>(cb: RouteHandler<T>) => ({ cb })
export const makeMiddleware = (cb: RouteMiddlewareHandler, onSetup?: (route: Route) => void) => ({ cb, onSetup })
export const makeErrorMiddleware = <T>(cb: (req: Request, err: Error) => Promise<Response<T>>) => ({ cb })

export const formatPath = (path: string) => `/${path}`
	.replaceAll('///', '/')
	.replaceAll('//', '/')

export const groupRoutes = (parent: string, routes: Route[], config?: GeneralConfig): Route[] => routes
	.map((route) => ({
		...(config ?? {}),
		...route,
		path: formatPath(`${parent}/${route.path}`),
		tags: [...(config?.tags ?? []), ...(route.tags ?? [])],
		middlewares: [...(config?.middlewares ?? []), ...(route.middlewares ?? [])],
		security: [...(config?.security ?? []), ...(route.security ?? [])],
	}))


export class Router {
	#config?: GeneralConfig
	#routes: Route[] = []
	#children: Router[] = []

	constructor (config?: GeneralConfig) {
		this.#config = config
	}

	#addRoute (method: Route['method'], route: RouteConfig, collection: Route[] = this.#routes) {
		return <T> (handler: RouteHandler<T>) => {
			const grouped = groupRoutes(this.#config?.path ?? '', [{ ...route, method, handler }], this.#config)
			collection.push(grouped[0])
		}
	}

	get (route: RouteConfig) {
		return this.#addRoute('get', route)
	}

	post (route: RouteConfig) {
		return this.#addRoute('post', route)
	}

	put (route: RouteConfig) {
		return this.#addRoute('put', route)
	}

	patch (route: RouteConfig) {
		return this.#addRoute('patch', route)
	}

	delete (route: RouteConfig) {
		return this.#addRoute('delete', route)
	}

	all (route: RouteConfig) {
		return this.#addRoute('all', route)
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
