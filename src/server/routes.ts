import { Methods, RouteDefHandler, RouterConfig, Route, MethodsEnum, RouteConfig, RouteDef, MergeRouteDefs } from './types'

export const cleanPath = (path: string) => {
	let cleaned = path.replace(/(\/\s*)+/g, '/')
	if (!cleaned.startsWith('/')) cleaned = `/${cleaned}`
	if (cleaned !== '/' && cleaned.endsWith('/')) cleaned = cleaned.slice(0, -1)
	return cleaned
}

const groupRoutes = <T extends RouteDef, R extends RouteDef>(config: RouterConfig<T>, routes: Route<R>[]): Route<MergeRouteDefs<T, R>>[] =>
	routes.map((route) => ({
		...config,
		...route,
		path: cleanPath(`${config.path}/${route.path}`),
		groups: [...(config.groups ?? []), ...(route.groups ?? [])],
		middlewares: [...(config.middlewares ?? []), ...(route.middlewares ?? [])],
		schemas: [...(config.schema ? [config.schema] : []), ...(route.schemas ?? [])],
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
				const route = groupRoutes(this.#config, [
					{ ...config, schemas: config.schema ? [config.schema] : [], path, method, handler: handler as any },
				])[0]
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
