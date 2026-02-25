import { v } from 'valleyed'

import {
	Methods,
	type MergeRouteDefs,
	type MethodsEnum,
	type Route,
	type RouteConfig,
	type RouteDef,
	type RouteDefHandler,
	type RouterConfig,
} from './types'

function mergeSchemas(...schemas: RouteDef[]) {
	type Keys = Record<keyof RouteDef, string>
	const k: Keys = {
		params: '',
		headers: '',
		query: '',
		body: '',
		cookies: '',
		response: '',
		responseHeaders: '',
		responseCookies: '',
		defaultStatusCode: '',
		defaultContentType: '',
	}
	function merge<T extends RouteDef[keyof Keys]>(acc: T | null, cur: T) {
		if (!acc) return cur
		if (!cur) return acc
		if (typeof acc === 'number') return cur
		if (typeof acc === 'string') return cur
		if (typeof acc === 'function') return cur
		return v.merge(acc, cur as any)
	}
	return Object.fromEntries(
		Object.keys(k).map((key) => [
			key,
			schemas.map((s) => s[key] as RouteDef[keyof Keys]).reduce<RouteDef[keyof Keys] | null>(merge, null),
		]),
	) as RouteDef
}

const groupRoutes = <T extends RouteDef, R extends RouteDef>(config: RouterConfig<T>, routes: Route<R>[]) =>
	routes.map((route) => ({
		...config,
		...route,
		path: `${config.path}/${route.path}`,
		groups: [...(config.groups ?? []), ...(route.groups ?? [])],
		middlewares: [...(config.middlewares ?? []), ...(route.middlewares ?? [])],
		responseMiddlewares: [...(config.responseMiddlewares ?? []), ...(route.responseMiddlewares ?? [])],
		schema: mergeSchemas(config.schema ?? {}, route.schema ?? {}),
		security: [...(config.security ?? []), ...(route.security ?? [])],
	})) as Route<MergeRouteDefs<T, R>>[]

export class Router<T extends RouteDef> {
	#config: RouterConfig<T> = { path: '' }
	#routes: Route<any>[] = []
	#children: Router<any>[] = []

	constructor(config: RouterConfig<T> = { path: '' }) {
		this.#config = config
	}

	#wrap(method: MethodsEnum) {
		return <R extends RouteDef>(path: string, config: RouteConfig<R> = {}) =>
			(handler: RouteDefHandler<MergeRouteDefs<T, R>>) => {
				const route = groupRoutes(this.#config, [{ ...config, path, method, handler: handler as any }])[0]
				this.#routes.push(route)
				return route
			}
	}

	head = this.#wrap(Methods.head)
	get = this.#wrap(Methods.get)
	post = this.#wrap(Methods.post)
	put = this.#wrap(Methods.put)
	patch = this.#wrap(Methods.patch)
	delete = this.#wrap(Methods.delete)
	options = this.#wrap(Methods.options)

	nest(...routers: Router<any>[]) {
		routers.forEach((router) => this.#children.push(router))
	}

	get routes() {
		return [...this.#routes].concat(this.#children.flatMap((child) => groupRoutes(this.#config, child.routes)))
	}
}
