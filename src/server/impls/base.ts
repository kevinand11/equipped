import type http from 'http'
import path from 'path'

import type { FastifySchema } from 'fastify'
import type { OpenAPIV3_1 } from 'openapi-types'
import io from 'socket.io'
import supertest from 'supertest'
import { JsonSchema, Pipe, PipeError, v } from 'valleyed'

import { EquippedError, NotFoundError, RequestError } from '../../errors'
import { Instance } from '../../instance'
import { Listener } from '../../listeners'
import { pipeErrorToValidationError } from '../../validations'
import { parseAuthUser } from '../middlewares/parseAuthUser'
import { type Request, Response } from '../requests'
import { cleanPath, Router } from '../routes'
import { Methods, MethodsEnum, RouteDef, RouteDefToReqRes, StatusCodes, StatusCodesEnum, type Route } from '../types'

type FullRoute<T extends RouteDef> = Required<
	Omit<Route<T>, 'schemas' | 'groups' | 'security' | 'hide' | 'title' | 'descriptions' | 'onError'>
> & {
	jsonSchema: FastifySchema
	onError?: Route<T>['onError']
	validateRequest: (req: Request<any>) => Request<RouteDefToReqRes<T>>
	validateResponse: (res: Response<any>) => Response<RouteDefToReqRes<T>>
}

declare module 'openapi-types' {
	namespace OpenAPIV3 {
		interface Document {
			'x-tagGroups': { name: string; tags: string[] }[]
		}
		interface TagObject {
			'x-displayName': string
		}
	}
}

const errorsSchema = Object.fromEntries(
	Object.entries(StatusCodes)
		.filter(([, value]) => value > 399)
		.map(([key, value]) => [
			value.toString(),
			v.array(v.object({ message: v.string(), field: v.optional(v.string()) })).meta({ description: `${key} Response` }),
		]),
) as Record<StatusCodesEnum, Pipe<unknown, unknown>>

export abstract class Server<Req = any, Res = any> {
	#routesByKey = new Map<string, FullRoute<any>>()
	#listener: Listener | null = null
	#registeredTags: Record<string, boolean> = {}
	#registeredTagGroups: Record<string, { name: string; tags: string[] }> = {}
	protected server: http.Server
	protected settings = Instance.get().settings
	protected staticPath = this.settings.server.publicPath ? path.join(process.cwd(), this.settings.server.publicPath) : null
	protected openapiJsonUrl = `${this.settings.openapi.docsPath}/openapi.json`
	protected baseOpenapiDoc: OpenAPIV3_1.Document = {
		openapi: '3.0.0',
		info: { title: `${this.settings.app} ${this.settings.appId}`, version: this.settings.openapi.docsVersion ?? '' },
		servers: this.settings.openapi.docsBaseUrl?.map((url) => ({ url })),
		paths: {},
		components: {
			schemas: {},
			securitySchemes: {
				Authorization: {
					type: 'apiKey',
					name: 'authorization',
					in: 'header',
				},
				RefreshToken: {
					type: 'apiKey',
					name: 'x-refresh-token',
					in: 'header',
				},
				ApiKey: {
					type: 'apiKey',
					name: 'x-api-key',
					in: 'header',
				},
			},
		},
		tags: [],
		'x-tagGroups': [],
	}
	protected cors = {
		origin: '*',
		methods: Object.values(Methods)
			.filter((m) => m !== Methods.options)
			.map((m) => m.toUpperCase()),
	}

	constructor(
		server: http.Server,
		protected implementations: {
			parseRequest: (req: Req) => Promise<Request<any>>
			handleResponse: (res: Res, response: Response<any>) => Promise<void>
			registerRoute: (route: FullRoute<any>, cb: (req: Req, res: Res) => Promise<void>) => void
			registerErrorHandler: (cb: (error: Error, req: Req, res: Res) => Promise<void>) => void
			registerNotFoundHandler: (cb: (req: Req, res: Res) => Promise<void>) => void
			start: (port: number) => Promise<boolean>
		},
	) {
		this.server = server
	}

	get listener() {
		if (!this.#listener) {
			const socket = new io.Server(this.server, { cors: { origin: '*' } })
			this.#listener = new Listener(socket, {
				onConnect: async () => {},
				onDisconnect: async () => {},
			})
		}
		return this.#listener
	}

	addRouter(...routers: Router<any>[]) {
		routers.map((router) => router.routes).forEach((routes) => this.addRoute(...routes))
	}

	addRoute<T extends RouteDef>(...routes: Route<T>[]) {
		routes.forEach((route) => this.#regRoute(route))
	}

	#buildTag(groups: NonNullable<Route<any>['groups']>) {
		if (!groups.length) return undefined
		const parsed = groups.map((g) => (typeof g === 'string' ? { name: g } : g))
		const name = parsed.map((g) => g.name).join(' > ')
		const displayName = parsed.at(-1)?.name ?? ''
		const description = parsed
			.map((g) => g.description?.trim() ?? '')
			.filter(Boolean)
			.join('\n\n\n\n')

		if (!this.#registeredTags[name]) {
			this.#registeredTags[name] = true
			this.baseOpenapiDoc.tags!.push({ name, 'x-displayName': displayName, description })

			const tagGroups = parsed.slice(0, -1)
			const groupName = tagGroups.map((g) => g.name).join(' > ') || 'default'
			if (!this.#registeredTagGroups[groupName]) {
				const group = { name: groupName, tags: [] }
				this.baseOpenapiDoc['x-tagGroups'].push(group)
				this.#registeredTagGroups[groupName] = group
			}
			this.#registeredTagGroups[groupName].tags = [...new Set([...this.#registeredTagGroups[groupName].tags, name])]
		}

		return name
	}

	#mergeSchemas(method: MethodsEnum, schemas: RouteDef[]) {
		const defaultStatusCode = schemas.findLast((s) => 'defaultStatusCode' in s)?.defaultStatusCode ?? StatusCodes.Ok
		let status = defaultStatusCode
		const jsonSchema: FastifySchema = {}
		const requestPipe: Pick<RouteDef, 'body' | 'headers' | 'query' | 'params'> = {}
		const responsePipe: Pick<RouteDef, 'response' | 'responseHeaders'> = {}

		const defs: {
			key: Exclude<keyof RouteDef, 'defaultStatusCode'>
			type: 'req' | 'res'
			reshapePipe?: (pipe: Pipe<unknown>) => Pipe<unknown>
			reshapeJsonSchema?: (schema: JsonSchema) => JsonSchema
			jsonKey?: keyof FastifySchema
			skip?: boolean
		}[] = [
			{ key: 'params', type: 'req' },
			{ key: 'headers', type: 'req' },
			{ key: 'query', type: 'req', jsonKey: 'querystring' },
			{ key: 'body', type: 'req', skip: !(<MethodsEnum[]>[Methods.post, Methods.put, Methods.patch]).includes(method) },
			{
				key: 'response',
				type: 'res',
				reshapePipe: (pipe) => {
					const responses = { ...errorsSchema, [defaultStatusCode]: pipe }
					return v.any().pipe((input) => {
						const p = responses[status]
						if (!p) throw PipeError.root(`schema not defined for status code: ${status}`, input)
						return p.parse(input)
					})
				},
				reshapeJsonSchema: (schema) =>
					Object.fromEntries([
						...Object.entries(errorsSchema).map(([key, pipe]) => [key, pipe.toJsonSchema()]),
						[defaultStatusCode, schema],
					]),
			},
			{ key: 'responseHeaders', type: 'res' },
		]
		defs.forEach((def) => {
			const pipes = schemas.map((schema) => schema[def.key]).filter((p) => !!p)
			if (!pipes.length || def.skip) return

			const pipe = pipes.length === 1 ? pipes[0] : v.and(pipes)
			jsonSchema[def.jsonKey ?? def.key] = (def.reshapeJsonSchema ?? ((x) => x))(pipe.toJsonSchema())

			const reserve = def.type === 'res' ? responsePipe : requestPipe
			reserve[def.key] = (def.reshapePipe ?? ((x) => x))(pipe)
		})
		const validateRequest: FullRoute<any>['validateRequest'] = (req) => {
			if (!Object.keys(requestPipe)) return req
			const validity = v.object(requestPipe, false).safeParse({
				params: req.params,
				headers: req.headers,
				query: req.query,
				body: req.body,
			})

			if (!validity.valid) throw pipeErrorToValidationError(validity.error)
			req.params = validity.value.params
			req.headers = validity.value.headers
			req.query = validity.value.query
			req.body = validity.value.body as any
			return req
		}
		const validateResponse: FullRoute<any>['validateResponse'] = (res) => {
			if (!Object.keys(responsePipe)) return res
			status = res.status

			const validity = v.object(responsePipe, false).safeParse({
				responseHeaders: res.headers,
				response: res.body,
			})

			if (!validity.valid) throw pipeErrorToValidationError(validity.error)
			res.body = validity.value.response
			res.headers = validity.value.responseHeaders
			return res
		}
		return {
			jsonSchema,
			validateRequest,
			validateResponse,
			noValidation: !Object.keys(requestPipe).length && !Object.keys(responsePipe).length,
		}
	}

	#regRoute<T extends RouteDef>(route: Route<T>) {
		const { method, path, handler, schemas = [], hide = false, title, security, onError, middlewares = [] } = route

		middlewares.unshift(parseAuthUser as any)
		middlewares.forEach((m) => m.onSetup?.(route))
		onError?.onSetup?.(route)

		const key = `(${method.toUpperCase()}) ${path}`
		if (this.#routesByKey.get(key))
			throw new EquippedError(`Route key ${key} already registered. All route keys must be unique`, { route, key })

		const tag = this.#buildTag(route.groups ?? [])
		const { validateRequest, validateResponse, jsonSchema, noValidation } = this.#mergeSchemas(method, schemas)

		const fullRoute: FullRoute<T> = {
			method,
			middlewares,
			handler,
			path: cleanPath(path),
			onError,
			jsonSchema: {
				...jsonSchema,
				operationId: key,
				summary: title ?? cleanPath(path),
				hide: hide || noValidation,
				tags: tag ? [tag] : undefined,
				description: route.descriptions?.join('\n\n'),
				security,
			},
			validateRequest,
			validateResponse,
		}
		this.#routesByKey.set(key, fullRoute)
		this.implementations.registerRoute(fullRoute, this.#createController(fullRoute))
	}

	#createController<T extends FullRoute<any>>(route: T) {
		return async (req: Req, res: Res) => {
			const request = route.validateRequest(await this.implementations.parseRequest(req))
			try {
				for (const middleware of route.middlewares) await middleware.cb(request)
				const rawRes = await route.handler(request)
				const response =
					rawRes instanceof Response ? rawRes : new Response({ body: rawRes, status: StatusCodes.Ok, headers: {}, piped: false })
				return await this.implementations.handleResponse(res, route.validateResponse(response))
			} catch (error) {
				if (route.onError?.cb) {
					const rawResponse = await route.onError.cb(request, error as Error)
					const response =
						rawResponse instanceof Response
							? rawResponse
							: new Response({ body: rawResponse, status: StatusCodes.BadRequest, headers: {} })
					return await this.implementations.handleResponse(res, route.validateResponse(response))
				}
				throw error
			}
		}
	}

	test() {
		return supertest(this.server)
	}

	async start(port: number) {
		this.addRoute({
			method: Methods.get,
			path: `${this.settings.openapi.docsPath}/`,
			handler: (req) =>
				req.res({
					body: '',
					status: StatusCodes.Found,
					headers: { Location: './index.html' },
				}),
		})

		this.addRoute({
			method: Methods.get,
			path: `${this.settings.openapi.docsPath}/index.html`,
			handler: (req) =>
				req.res({
					body: scalarHtml(`${this.settings.app} ${this.settings.appId}`, './openapi.json'),
					headers: { 'Content-Type': 'text/html' },
				}),
		})

		this.addRoute({
			method: Methods.get,
			path: '__health',
			handler: async (req) =>
				req.res({
					body: `${this.settings.appId} service running`,
					headers: { 'Content-Type': 'text/plain' },
				}),
		})

		this.implementations.registerNotFoundHandler(async (req) => {
			const request = await this.implementations.parseRequest(req)
			throw new NotFoundError(`Route ${request.path} not found`)
		})
		this.implementations.registerErrorHandler(async (error, _, res) => {
			Instance.get().logger.error(error)
			const response =
				error instanceof RequestError
					? new Response({
							body: error.serializedErrors,
							status: error.statusCode,
						})
					: new Response({
							body: [{ message: 'Something went wrong', data: error.message }],
							status: StatusCodes.BadRequest,
						})
			return await this.implementations.handleResponse(res, response)
		})

		const started = await this.implementations.start(port)
		if (started) Instance.get().logger.info(`${this.settings.appId} service listening on port ${port}`)
		return started
	}
}

const scalarHtml = (title: string, jsonUrl: string) => `
<!doctype html>
<html>
  <head>
    <title>${title}</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
	<style>
      .darklight-reference {
        display: none;
      }
    </style>
  </head>
  <body>
    <script id="api-reference" data-url="${jsonUrl}"></script>
    <script>
      const configuration = { theme: 'purple' };
      document.getElementById('api-reference').dataset.configuration = JSON.stringify(configuration);
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.28.33"></script>
  </body>
</html>
`
