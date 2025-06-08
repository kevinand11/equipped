import type http from 'http'
import path from 'path'

import type { FastifySchema } from 'fastify'
import type { OpenAPIV3_1 } from 'openapi-types'
import io from 'socket.io'
import supertest from 'supertest'
import { v } from 'valleyed'

import { EquippedError, NotFoundError, RequestError } from '../../errors'
import { Instance } from '../../instance'
import { Listener } from '../../listeners'
import { parseAuthUser } from '../middlewares/parseAuthUser'
import { type Request, Response } from '../requests'
import { cleanPath, type Router } from '../routes'
import { Methods, MethodsEnum, RouteDef, StatusCodes, type Route } from '../types'

export type FullRoute<T extends RouteDef> = Required<
	Omit<Route<T>, 'schema' | 'groups' | 'security' | 'title' | 'descriptions' | 'hideSchema' | 'onError'>
> & { schema: FastifySchema; onError?: Route<T>['onError'] }

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

function stripEmptyObjects<T extends object>(obj: T) {
	return Object.entries(obj).reduce((acc, [key, value]) => {
		if (!value || (typeof value === 'object' && Object.keys(value).length === 0)) return acc
		return { ...acc, [key]: value }
	}, {} as T)
}

const errorsSchema = Object.fromEntries(
	Object.entries(StatusCodes)
		.filter(([, value]) => value > 699)
		.map(([key, value]) => [
			value.toString(),
			v
				.array(v.object({ message: v.string(), field: v.optional(v.string()) }))
				.meta({ description: `${key} Response` })
				.toJsonSchema(),
		]),
)

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

	addRouter(...routers: Router[]) {
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

	#regRoute<T extends RouteDef>(route: Route<T>) {
		const middlewares = route.middlewares ?? []
		middlewares.unshift(parseAuthUser as any)
		middlewares.forEach((m) => m.onSetup?.(route))
		route.onError?.onSetup?.(route)

		const { method, path, handler, schema, title, security, onError } = route
		const key = `(${method.toUpperCase()}) ${path}`

		const tag = this.#buildTag(route.groups ?? [])

		const statusCode = schema?.defaultStatusCode ?? StatusCodes.Ok
		const supportsBody = (<MethodsEnum[]>[Methods.post, Methods.put, Methods.patch]).includes(method)

		const fullRoute: FullRoute<T> = {
			method,
			middlewares,
			handler,
			path: cleanPath(path),
			onError,
			schema: stripEmptyObjects({
				operationId: key,
				body: supportsBody ? schema?.body?.toJsonSchema() : undefined,
				querystring: schema?.query?.toJsonSchema(),
				params: schema?.params?.toJsonSchema(),
				headers: schema?.headers?.toJsonSchema(),
				response: schema?.response ? { ...errorsSchema, [statusCode]: schema.response.toJsonSchema() } : undefined,
				summary: title ?? cleanPath(path),
				hide: !schema || schema.hide,
				tags: tag ? [tag] : undefined,
				description: route.descriptions?.join('\n\n'),
				security,
			}),
		}
		if (this.#routesByKey.get(key))
			throw new EquippedError(`Route key ${key} already registered. All route keys must be unique`, { route, key })
		this.#routesByKey.set(key, fullRoute)
		this.implementations.registerRoute(fullRoute, this.#createController(fullRoute))
	}

	#createController<T extends FullRoute<any>>(route: T) {
		return async (req: Req, res: Res) => {
			const request = await this.implementations.parseRequest(req)

			if (this.settings.requests.schemaValidation) {
				// TODO: run schema validation for request
			}

			try {
				for (const middleware of route.middlewares) await middleware.cb(request)
				const rawRes = await route.handler(request)
				const response =
					rawRes instanceof Response ? rawRes : new Response({ body: rawRes, status: StatusCodes.Ok, headers: {}, piped: false })
				return await this.implementations.handleResponse(res, response)
			} catch (error) {
				if (route.onError?.cb) {
					const rawResponse = await route.onError.cb(request, error as Error)
					const response =
						rawResponse instanceof Response
							? rawResponse
							: new Response({ body: rawResponse, status: StatusCodes.BadRequest, headers: {} })
					return await this.implementations.handleResponse(res, response)
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
			schema: {
				body: v.string(),
				defaultStatusCode: StatusCodes.Found,
				responseHeaders: v.object({ Location: v.string() }),
				hide: true,
			},
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
					body: scalarHtml
						.replaceAll('__API_TITLE__', `${this.settings.app} ${this.settings.appId}`)
						.replaceAll('__OPENAPI_JSON_URL__', './openapi.json'),
					headers: { 'Content-Type': 'text/html' },
				}),
		})

		this.addRoute({
			method: Methods.get,
			path: `${this.settings.openapi.docsPath}/redoc.html`,
			handler: (req) =>
				req.res({
					body: redocHtml
						.replaceAll('__API_TITLE__', `${this.settings.app} ${this.settings.appId}`)
						.replaceAll('__OPENAPI_JSON_URL__', './openapi.json'),
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

const scalarHtml = `
<!doctype html>
<html>
  <head>
    <title>__API_TITLE__</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
	<style>
      .darklight-reference {
        display: none;
      }
    </style>
  </head>
  <body>
    <script id="api-reference" data-url="__OPENAPI_JSON_URL__"></script>
    <script>
      const configuration = { theme: 'purple' };
      document.getElementById('api-reference').dataset.configuration = JSON.stringify(configuration);
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.28.33"></script>
  </body>
</html>
`

const redocHtml = `
<!doctype html>
<html>
  <head>
    <title>__API_TITLE__</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
	<style>
      body {
        margin: 0;
        padding: 0;
      }
    </style>
  </head>
  <body>
    <redoc spec-url="__OPENAPI_JSON_URL__"></redoc>
    <script src="https://cdn.jsdelivr.net/npm/redoc@2.5.0/bundles/redoc.standalone.js"></script>
  </body>
</html>
`
