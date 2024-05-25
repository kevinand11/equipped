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
	middlewares?: RouteMiddlewareHandler[]
	schema?: Schema
	tags?: string[]
}

type RouteConfig = Partial<Omit<Route, 'method'>>
type GeneralConfig = Omit<RouteConfig, 'schema'>

export const makeController = <T>(cb: RouteHandler<T>) => cb
export const makeMiddleware = (cb: RouteMiddlewareHandler) => cb
export const makeErrorMiddleware = <T>(cb: (req: Request, err: Error) => Promise<Response<T>>) => cb

export const formatPath = (path: string) => `/${path}`
	.replaceAll('///', '/')
	.replaceAll('//', '/')

export const groupRoutes = (parent: string, routes: Route[]): Route[] => routes
	.map((route) => ({ ...route, path: formatPath(`${parent}/${route.path}`) }))


export class Router {
	#config?: GeneralConfig
	#routes: Route[] = []
	#children: Router[] = []

	constructor (config?: GeneralConfig) {
		this.#config = config
	}

	#addRoute (method: Route['method'], route: RouteConfig, collection: Route[] = this.#routes) {
		return <T>(handler: RouteHandler<T>) => {
			collection.push({
				...this.#config,
				...route,
				tags: [...(this.#config?.tags ?? []), ...(route.tags ?? [])],
				middlewares: [...(this.#config?.middlewares ?? []), ...(route.middlewares ?? [])],
				handler,
				method,
				path: formatPath(`${this.#config?.path ?? ''}/${route.path ?? ''}`),
			})
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
