import type http from 'http'

import io from 'socket.io'
import supertest from 'supertest'
import { Pipe, PipeError, v } from 'valleyed'

import { EquippedError, NotFoundError, RequestError } from '../../errors'
import { Instance } from '../../instance'
import { pipeErrorToValidationError } from '../../validations'
import { parseAuthUser } from '../middlewares/parseAuthUser'
import { OpenApi, OpenApiSchemaDef } from '../openapi'
import { type Request, Response } from '../requests'
import { Router } from '../routes'
import { Methods, MethodsEnum, RouteDef, StatusCodes, type Route } from '../types'

type RequestValidator = (req: Request<any>) => Request<any>
type ResponseValidator = (res: Response<any>) => Response<any>

const errorsSchemas = Object.entries(StatusCodes)
	.filter(([, value]) => value > 399)
	.map(([key, value]) => ({
		status: value,
		contentType: 'application/json',
		pipe: v.array(v.object({ message: v.string(), field: v.optional(v.string()) })).meta({ description: `${key} Response` }) as Pipe<
			any,
			any,
			any
		>,
	}))

export abstract class Server<Req = any, Res = any> {
	#queue: (() => void | Promise<void>)[] = []
	#routesByKey = new Map<string, boolean>()
	#openapi = new OpenApi()
	protected server: http.Server
	protected settings = Instance.get().settings
	protected cors = {
		origin: '*',
		methods: Object.values(Methods)
			.filter((m) => m !== Methods.options)
			.map((m) => m.toUpperCase()),
	}
	readonly socket: io.Server

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
		this.socket = new io.Server(this.server, { cors: this.cors })
		this.addRouter(this.#openapi.router())
	}

	addRouter(...routers: Router<any>[]) {
		routers.map((router) => router.routes).forEach((routes) => this.addRoute(...routes))
	}

	addRoute<T extends RouteDef>(...routes: Route<T>[]) {
		routes.forEach((route) => {
			this.#queue.push(async () => {
				const { method, path, schema = {}, onError, middlewares = [] } = route

				const key = `(${method.toUpperCase()}) ${this.#openapi.cleanPath(path)}`
				if (this.#routesByKey.get(key))
					throw new EquippedError(`Route key ${key} already registered. All route keys must be unique`, { route, key })

				middlewares.unshift(parseAuthUser as any)
				middlewares.forEach((m) => m.onSetup?.(route))
				onError?.onSetup?.(route)

				const { validateRequest, validateResponse, jsonSchema } = this.#resolveSchema(method, schema)

				this.#routesByKey.set(key, true)
				await this.#openapi.register(route, jsonSchema)
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
		})
	}

	#resolveSchema(method: MethodsEnum, schema: RouteDef) {
		const defaultStatusCode = schema?.defaultStatusCode ?? StatusCodes.Ok
		const defaultContentType = schema?.defaultContentType ?? 'application/json'
		let status = defaultStatusCode
		let contentType = defaultContentType
		const jsonSchema: OpenApiSchemaDef = { response: {}, request: {} }
		const requestPipe: Pick<RouteDef, 'body' | 'headers' | 'query' | 'params'> = {}
		const responsePipe: Pick<RouteDef, 'response' | 'responseHeaders'> = {}

		const defs: {
			key: Exclude<keyof RouteDef, `default${string}`>
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
				jsonSchema.request[def.key as keyof typeof jsonSchema.request] = pipe.toJsonSchema()
			}
			if (def.type === 'response') {
				const pipeRecords = errorsSchemas.concat({ status: defaultStatusCode, contentType, pipe })
				responsePipe[def.key] = v.any().pipe((input) => {
					const p = pipeRecords.find((r) => r.status === status)?.pipe
					if (!p) throw PipeError.root(`schema not defined for status code: ${status}`, input)
					return p.parse(input)
				})
				jsonSchema.response[def.key as keyof typeof jsonSchema.response] = pipeRecords.map((record) => ({
					status: record.status,
					contentType: record.contentType,
					schema: record.pipe.toJsonSchema(),
				}))
			}
		})
		const validateRequest: RequestValidator = (request) => {
			if (!Object.keys(requestPipe)) return request
			const validity = v
				.object(
					Object.fromEntries(
						Object.entries(requestPipe).map(([key, val]) => [
							key,
							v.pipe((input) => input, { context: () => ({ request }) }).pipe(val),
						]),
					),
				)
				.safeParse({
					params: request.params,
					headers: request.headers,
					query: request.query,
					body: request.body,
				})

			if (!validity.valid) throw pipeErrorToValidationError(validity.error)
			request.params = validity.value.params
			request.headers = validity.value.headers
			request.query = validity.value.query
			request.body = validity.value.body
			return request
		}
		const validateResponse: ResponseValidator = (response) => {
			if (!Object.keys(responsePipe)) return response
			status = response.status
			contentType = response.contentType
			contentType

			const validity = v
				.object(
					Object.fromEntries(
						Object.entries(responsePipe).map(([key, val]) => [
							key,
							v.pipe((input) => input, { context: () => ({ response }) }).pipe(val),
						]),
					),
				)
				.safeParse({
					responseHeaders: response.headers,
					response: response.body,
				})

			if (!validity.valid) throw pipeErrorToValidationError(validity.error)
			response.body = validity.value.response
			response.headers = validity.value.responseHeaders
			return response
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

	async start() {
		const port = this.settings.server.port
		if (this.settings.server.healthPath)
			this.addRoute({
				method: Methods.get,
				path: this.settings.server.healthPath,
				handler: async (req) =>
					req.res({ body: `${this.settings.app.id}(${this.settings.app.name}) service running`, contentType: 'text/plain' }),
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

		await Promise.all(this.#queue.map((cb) => cb()))
		const started = await this.implementations.start(port)
		if (started) Instance.get().logger.info(`${this.settings.app.id}(${this.settings.app.name}) service listening on port ${port}`)
		return started
	}
}
