import { Methods, RouteDefHandler, RouterConfig, Route, MethodsEnum, RouteConfig, RouteDef } from './types'

export const cleanPath = (path: string) => {
	let cleaned = path.replace(/(\/\s*)+/g, '/')
	if (!cleaned.startsWith('/')) cleaned = `/${cleaned}`
	if (cleaned !== '/' && cleaned.endsWith('/')) cleaned = cleaned.slice(0, -1)
	return cleaned
}

const groupRoutes = <T extends RouteDef>(config: RouterConfig<T>, routes: Route<T>[]): Route<T>[] =>
	routes.map((route) => ({
		...config,
		...route,
		path: cleanPath(`${config.path}/${route.path}`),
		groups: [...(config.groups ?? []), ...(route.groups ?? [])],
		middlewares: [...(config.middlewares ?? []), ...(route.middlewares ?? [])],
		schemas: [...(config.schema ? [config.schema] : []), ...(route.schemas ?? [])],
		security: [...(config.security ?? []), ...(route.security ?? [])],
	}))

export class Router<T extends RouteDef> {
	#config: RouterConfig<T> = { path: '' }
	#routes: Route<any>[] = []
	#children: Router<T>[] = []

	constructor(config: RouterConfig<T> = { path: '' }) {
		this.#config = config
	}

	#wrap(method: MethodsEnum) {
		return <T extends RouteDef>(path: string, config: RouteConfig<T> = {}) =>
			(handler: RouteDefHandler<T>) => {
				const schema = config.schema ?? {}
				const route = groupRoutes(this.#config, [{ ...config, schemas: [schema as any], path, method, handler }])[0]
				this.#routes.push(route)
				return route as unknown as Route<T>
			}
	}

	head = this.#wrap(Methods.head)
	get = this.#wrap(Methods.get)
	post = this.#wrap(Methods.post)
	put = this.#wrap(Methods.put)
	patch = this.#wrap(Methods.patch)
	delete = this.#wrap(Methods.delete)
	options = this.#wrap(Methods.options)

	add(...routes: Route<any>[]) {
		const mapped = groupRoutes(this.#config, routes)
		this.#routes.push(...mapped)
	}

	nest(...routers: Router<any>[]) {
		routers.forEach((router) => this.#children.push(router))
	}

	get routes() {
		return [...this.#routes].concat(this.#children.flatMap((child) => groupRoutes(this.#config, child.#routes)))
	}
}
