import type http from 'http'

import io from 'socket.io'
import supertest from 'supertest'
import { PipeError, v } from 'valleyed'

import { EquippedError, NotFoundError, RequestError } from '../../errors'
import { Instance } from '../../instance'
import { Listener } from '../../listeners'
import { pipeErrorToValidationError } from '../../validations'
import { parseAuthUser } from '../middlewares/parseAuthUser'
import { OpenApi, OpenApiSchemaDef } from '../openapi'
import { type Request, Response } from '../requests'
import { Router } from '../routes'
import { Methods, MethodsEnum, RouteDef, StatusCodes, StatusCodesEnum, type Route } from '../types'

type RequestValidator = (req: Request<any>) => Request<any>
type ResponseValidator = (res: Response<any>) => Response<any>

const errorsSchemas = Object.entries(StatusCodes)
	.filter(([, value]) => value > 399)
	.map(([key, value]): [StatusCodesEnum, RouteDef] => [
		value,
		{
			response: v.array(v.object({ message: v.string(), field: v.optional(v.string()) })).meta({ description: `${key} Response` }),
		},
	])

export abstract class Server<Req = any, Res = any> {
	#routesByKey = new Map<string, boolean>()
	#listener: Listener | null = null
	#openapi = new OpenApi()
	protected server: http.Server
	protected settings = Instance.get().settings
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
			registerRoute: (method: MethodsEnum, path: string, cb: (req: Req, res: Res) => Promise<void>) => void
			registerErrorHandler: (cb: (error: Error, req: Req, res: Res) => Promise<void>) => void
			registerNotFoundHandler: (cb: (req: Req, res: Res) => Promise<void>) => void
			start: (port: number) => Promise<boolean>
		},
	) {
		this.server = server
		this.addRouter(this.#openapi.router())
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
		routes.forEach((route) => {
			const { method, path, schema = {}, onError, middlewares = [] } = route

			middlewares.unshift(parseAuthUser as any)
			middlewares.forEach((m) => m.onSetup?.(route))
			onError?.onSetup?.(route)

			const key = `(${method.toUpperCase()}) ${path}`
			if (this.#routesByKey.get(key))
				throw new EquippedError(`Route key ${key} already registered. All route keys must be unique`, { route, key })

			const { validateRequest, validateResponse, jsonSchema } = this.#resolveSchema(method, schema)

			this.#routesByKey.set(key, true)
			this.#openapi.register(route, jsonSchema)
			this.implementations.registerRoute(method, this.#openapi.cleanPath(path), async (req: Req, res: Res) => {
				const request = validateRequest(await this.implementations.parseRequest(req))
				try {
					for (const middleware of middlewares) await middleware.cb(request)
					const rawRes = await route.handler(request)
					const response =
						rawRes instanceof Response
							? rawRes
							: new Response({ body: rawRes, status: StatusCodes.Ok, headers: {}, piped: false })
					return await this.implementations.handleResponse(res, validateResponse(response))
				} catch (error) {
					if (onError?.cb) {
						const rawResponse = await onError.cb(request, error as Error)
						const response =
							rawResponse instanceof Response
								? rawResponse
								: new Response({ body: rawResponse, status: StatusCodes.BadRequest, headers: {} })
						return await this.implementations.handleResponse(res, validateResponse(response))
					}
					throw error
				}
			})
		})
	}

	#resolveSchema(method: MethodsEnum, schema: RouteDef) {
		const defaultStatusCode = schema?.defaultStatusCode ?? StatusCodes.Ok
		let status = defaultStatusCode
		const jsonSchema: OpenApiSchemaDef = { response: {}, request: {} }
		const requestPipe: Pick<RouteDef, 'body' | 'headers' | 'query' | 'params'> = {}
		const responsePipe: Pick<RouteDef, 'response' | 'responseHeaders'> = {}

		const defs: {
			key: Exclude<keyof RouteDef, 'defaultStatusCode'>
			type: keyof OpenApiSchemaDef
			skip?: boolean
		}[] = [
			{ key: 'params', type: 'request' },
			{ key: 'headers', type: 'request' },
			{ key: 'query', type: 'request' },
			{ key: 'body', type: 'request', skip: !(<MethodsEnum[]>[Methods.post, Methods.put, Methods.patch]).includes(method) },
			{ key: 'response', type: 'response' },
			{ key: 'responseHeaders', type: 'response' },
		]
		defs.forEach((def) => {
			const pipe = schema[def.key]
			if (!pipe || def.skip) return

			if (def.type === 'request') {
				requestPipe[def.key] = pipe
				jsonSchema.request[def.key] = pipe.toJsonSchema()
			}
			if (def.type === 'response') {
				const pipeRecords = [
					...errorsSchemas.map(([statusCode, d]) => [statusCode, d[def.key]!] as const),
					[defaultStatusCode, pipe] as const,
				].filter(([_, p]) => !!p)
				responsePipe[def.key] = v.any().pipe((input) => {
					const p = pipeRecords.find((r) => r[0] === status)?.[1]
					if (!p) throw PipeError.root(`schema not defined for status code: ${status}`, input)
					return p.parse(input)
				})
				jsonSchema.response[def.key] = Object.fromEntries(pipeRecords.map(([statusCode, p]) => [statusCode, p.toJsonSchema()]))
			}
		})
		const validateRequest: RequestValidator = (req) => {
			if (!Object.keys(requestPipe)) return req
			const validity = v.object(requestPipe).safeParse({
				params: req.params,
				headers: req.headers,
				query: req.query,
				body: req.body,
			})

			if (!validity.valid) throw pipeErrorToValidationError(validity.error)
			req.params = validity.value.params
			req.headers = validity.value.headers
			req.query = validity.value.query
			req.body = validity.value.body
			return req
		}
		const validateResponse: ResponseValidator = (res) => {
			if (!Object.keys(responsePipe)) return res
			status = res.status

			const validity = v.object(responsePipe).safeParse({
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
		}
	}

	test() {
		return supertest(this.server)
	}

	async start(port: number) {
		if (this.settings.server.healthPath)
			this.addRoute({
				method: Methods.get,
				path: this.settings.server.healthPath,
				handler: async (req) =>
					req.res({ body: `${this.settings.appId} service running`, headers: { 'Content-Type': 'text/plain' } }),
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
