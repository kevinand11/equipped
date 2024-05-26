import { Request, Response } from './request'

type MethodTypes = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'all'
type Res<T> = Response<T> | T
type RouteHandler<T> = (req: Request) => Promise<Res<T>>
type ErrorHandler<T> = (req: Request, err: Error) => Promise<Response<T>>
type RouteMiddlewareHandler = (req: Request) => Promise<void>
type HandlerSetup = (route: Route) => void

export type Schema = {
  body?: any;
  query?: any;
  params?: any;
  headers?: any;
  response?: Record<string, any>;
}

export type Route<T = unknown> = {
	path: string
	method: MethodTypes
	handler: ReturnType<typeof makeController<T>>
	middlewares?: ReturnType<typeof makeMiddleware>[]
	schema?: Schema
	tags?: string[]
	security?: Record<string, string[]>[]
}

type RouteConfig = Omit<Route, 'method' | 'handler'>
type GeneralConfig = Omit<RouteConfig, 'schema'>

class Handler<Cb extends Function> {
	constructor (public cb: Cb, public onSetup?: (route: Route) => void) {}
}

export const makeController = <T>(cb: RouteHandler<T>, onSetup?: HandlerSetup) => new Handler<RouteHandler<T>>(cb, onSetup)
export const makeMiddleware = (cb: RouteMiddlewareHandler, onSetup?: HandlerSetup) => new Handler<RouteMiddlewareHandler>(cb, onSetup)
export const makeErrorMiddleware = <T>(cb: ErrorHandler<T>) => new Handler<ErrorHandler<T>>(cb)

export const groupRoutes = (parent: string, routes: Route[], config?: GeneralConfig): Route[] => routes
	.map((route) => ({
		...(config ?? {}),
		...route,
		path: `${parent}/${route.path}`,
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
		return <T> (...args: Parameters<typeof makeController<T>>) => {
			const grouped = groupRoutes(this.#config?.path ?? '', [{ ...route, method, handler: makeController(...args) }], this.#config)
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
				this.#addRoute(route.method, route, routes)(route.handler.cb, route.handler.onSetup)
			})
		})
		return routes
	}
}
