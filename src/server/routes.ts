import { Methods, RouteDefHandler, RouterConfig, Route, MethodsEnum, RouteConfig, RouteDef, MergeRouteDefs } from './types'

function mergeSchemas(...schemas: RouteDef[]) {
	type Keys = Record<keyof RouteDef, string>
	const k: Keys = {
		params: '',
		headers: '',
		query: '',
		body: '',
		response: '',
		responseHeaders: '',
		defaultStatusCode: '',
		defaultContentType: '',
	}
	function merge<T extends RouteDef[keyof Keys]>(acc: T | null, cur: T) {
		if (!acc) return cur
		if (!cur) return acc
		if (typeof acc === 'number') return cur
		if (typeof acc === 'string') return cur
		return acc.pipe(cur as any) as T
	}
	return Object.fromEntries(
		Object.keys(k).map((key) => [
			key,
			schemas.map((s) => s[key] as RouteDef[keyof Keys]).reduce<RouteDef[keyof Keys] | null>(merge, null),
		]),
	) as RouteDef
}

const groupRoutes = <T extends RouteDef, R extends RouteDef>(config: RouterConfig<T>, routes: Route<R>[]): Route<MergeRouteDefs<T, R>>[] =>
	routes.map((route) => ({
		...config,
		...route,
		path: `${config.path}/${route.path}`,
		groups: [...(config.groups ?? []), ...(route.groups ?? [])],
		middlewares: [...(config.middlewares ?? []), ...(route.middlewares ?? [])],
		schema: mergeSchemas(config.schema ?? {}, route.schema ?? {}),
		security: [...(config.security ?? []), ...(route.security ?? [])],
	})) as any

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

	add<R extends RouteDef>(...routes: Route<R>[]) {
		const mapped = groupRoutes(this.#config, routes)
		this.#routes.push(...mapped)
	}

	nest<R extends RouteDef>(...routers: Router<R>[]) {
		routers.forEach((router) => this.#children.push(router))
	}

	get routes() {
		return [...this.#routes].concat(this.#children.flatMap((child) => groupRoutes(this.#config, child.#routes)))
	}
}
