import type http from 'node:http'

import { type FastifyCorsOptions } from '@fastify/cors'
import { type CorsOptions } from 'cors'
import { Server as SocketServer } from 'socket.io'
import supertest from 'supertest'
import { type Pipe, PipeError, v } from 'valleyed'

import { EquippedError, NotFoundError, RequestError } from '../../errors'
import { Instance } from '../../instance'
import { pipeErrorToValidationError } from '../../validations'
import { requestLocalStorage, responseLocalStorage } from '../../validations/valleyed'
import { openapi, type OpenApiSchemaDef } from '../openapi'
import { type Request, Response } from '../requests'
import { Router } from '../routes'
import { SocketEmitter } from '../sockets'
import { Methods, type MethodsEnum, type Route, type RouteDef, StatusCodes } from '../types'
import type { Server, ServerConfig } from './base'

type RequestValidator = (req: Request<any>) => Promise<Request<any>>
type ResponseValidator = (res: Response<any>) => Promise<Response<any>>

const errorsSchemas = Object.entries(StatusCodes)
	.filter(([, value]) => value > 399)
	.map(([key, value]) => ({
		status: value,
		contentType: 'application/json',
		pipe: v.meta(v.array(v.object({ message: v.string(), field: v.optional(v.string()) })), {
			$refId: `Errors.${key}Response`,
			description: `${key} Response`,
		}) as Pipe<any, any>,
	}))

export function base<Req = any, Res = any>(
	httpServer: http.Server,
	config: ServerConfig,
	implementations: {
		parseRequest: (req: Req) => Promise<Request<any>>
		handleResponse: (res: Res, response: Response<any>) => Promise<void>
		registerRoute: (method: MethodsEnum, path: string, cb: (req: Req, res: Res) => Promise<void>) => void
		registerErrorHandler: (cb: (error: Error, req: Req, res: Res) => Promise<void>) => void
		registerNotFoundHandler: (cb: (req: Req, res: Res) => Promise<void>) => void
		start: (port: number) => Promise<boolean>
	},
): Server {
	const cors: CorsOptions & FastifyCorsOptions = {
		origin: config.cors?.origin ? (_, cb) => cb(null, true) : config.cors?.origin,
		methods: (config.cors?.methods ?? Object.values(Methods)).filter((m) => m !== Methods.options).map((m) => m.toUpperCase()),
		credentials: config.cors?.credentials,
	}
	const oai = openapi(config)
	const socketInstance = new SocketServer(httpServer, { cors })
	const socket = new SocketEmitter(socketInstance, config)

	const queue: (() => void | Promise<void>)[] = []
	const routesByKey = new Map<string, boolean>()

	const resolveSchema = (method: MethodsEnum, schema: RouteDef) => {
		const defaultStatusCode = schema?.defaultStatusCode ?? StatusCodes.Ok
		const defaultContentType = schema?.defaultContentType ?? 'application/json'
		let status = defaultStatusCode
		let contentType = defaultContentType
		const jsonSchema: OpenApiSchemaDef = { response: {}, request: {} }
		const requestPipeDefs: Pick<RouteDef, 'body' | 'headers' | 'query' | 'params' | 'cookies'> = {}
		const responsePipeDefs: Pick<RouteDef, 'response' | 'responseHeaders' | 'responseCookies'> = {}

		const defs: {
			key: Exclude<keyof RouteDef, `default${string}` | 'context'>
			type: keyof OpenApiSchemaDef
			skip?: boolean
		}[] = [
			{ key: 'params', type: 'request' },
			{ key: 'headers', type: 'request' },
			{ key: 'cookies', type: 'request' },
			{ key: 'query', type: 'request' },
			{ key: 'body', type: 'request', skip: !(<MethodsEnum[]>[Methods.post, Methods.put, Methods.patch]).includes(method) },
			{ key: 'response', type: 'response' },
			{ key: 'responseHeaders', type: 'response' },
			{ key: 'responseCookies', type: 'response' },
		]
		defs.forEach((def) => {
			const pipe = schema[def.key] ?? v.any()
			if (def.skip) return

			if (def.type === 'request') {
				requestPipeDefs[def.key] = pipe
				jsonSchema.request[def.key as keyof typeof jsonSchema.request] = v.schema(pipe)
			}
			if (def.type === 'response') {
				const pipeRecords = errorsSchemas.concat({ status: defaultStatusCode, contentType, pipe })
				responsePipeDefs[def.key] = v.any().pipe((input) => {
					const p = pipeRecords.find((r) => r.status === status)?.pipe
					if (!p) throw PipeError.root(`schema not defined for status code: ${status}`, input)
					return v.assert(p, input)
				})
				jsonSchema.response[def.key as keyof typeof jsonSchema.response] = pipeRecords.map((record) => ({
					status: record.status,
					contentType: record.contentType,
					schema: v.schema(record.pipe),
				}))
			}
		})
		const requestPipe = v.object(requestPipeDefs)
		v.compile(requestPipe, { allErrors: true })
		const responsePipe = v.object(responsePipeDefs)
		v.compile(responsePipe, { allErrors: true })
		const validateRequest: RequestValidator = async (request) => {
			if (!Object.keys(requestPipeDefs)) return request
			const validity = requestLocalStorage.run(request, () =>
				v.validate(requestPipe, {
					params: request.params,
					headers: request.headers,
					query: request.query,
					body: request.body,
					cookies: request.cookies,
				}),
			)

			if (!validity.valid) throw pipeErrorToValidationError(validity.error)
			request.params = validity.value.params!
			request.headers = validity.value.headers!
			request.query = validity.value.query!
			request.body = validity.value.body!
			request.cookies = validity.value.cookies!
			return request
		}
		const validateResponse: ResponseValidator = async (response) => {
			if (!Object.keys(responsePipeDefs)) return response
			status = response.status
			contentType = response.contentType

			const validity = responseLocalStorage.run(response, () =>
				v.validate(responsePipe, {
					responseHeaders: response.headers,
					responseCookies: Object.fromEntries(Object.entries(response.cookies).map(([key, val]) => [key, val.value] as const)),
					response: response.body,
				}),
			)

			if (!validity.valid) throw pipeErrorToValidationError(validity.error)
			response.body = validity.value.response!
			response.headers = validity.value.responseHeaders!
			response.cookieValues = validity.value.responseCookies!
			return response
		}
		return {
			jsonSchema,
			validateRequest,
			validateResponse,
		}
	}

	const server: Server = {
		socket,
		cors,
		addRouter(...routers: Router<any>[]) {
			routers.map((router) => router.routes).forEach((routes) => server.addRoute(...routes))
		},
		addRoute<T extends RouteDef>(...routes: Route<T>[]) {
			routes.forEach((route) => {
				queue.push(async () => {
					const { method, path, schema = {}, onError, middlewares = [], responseMiddlewares = [] } = route

					const key = `(${method.toUpperCase()}) ${oai.cleanPath(path)}`
					if (routesByKey.get(key))
						throw new EquippedError(`Route key ${key} already registered. All route keys must be unique`, { route, key })

					middlewares.forEach((m) => m.onSetup?.(route as any))
					onError?.onSetup?.(route as any)
					responseMiddlewares.forEach((m) => m.onSetup?.(route as any))

					const { validateRequest, validateResponse, jsonSchema } = resolveSchema(method, schema)

					routesByKey.set(key, true)
					await oai.register(route, jsonSchema)
					implementations.registerRoute(method, oai.cleanPath(path), async (req, res) => {
						const request = await validateRequest(await implementations.parseRequest(req))
						try {
							for (const middleware of middlewares) await middleware.cb(request)
							const rawRes = await route.handler(request)
							const response =
								rawRes instanceof Response
									? rawRes
									: new Response({ body: rawRes, status: StatusCodes.Ok, headers: {}, piped: false })
							for (const middleware of responseMiddlewares) await middleware.cb(request, response)
							return await implementations.handleResponse(res, await validateResponse(response))
						} catch (error) {
							if (onError?.cb) {
								const rawResponse = await onError.cb(request, error as Error)
								const response =
									rawResponse instanceof Response
										? rawResponse
										: new Response({ body: rawResponse, status: StatusCodes.BadRequest, headers: {} })
								return await implementations.handleResponse(res, await validateResponse(response))
							}
							throw error
						}
					})
				})
			})
		},
		test() {
			return supertest(httpServer)
		},
		async start() {
			const port = config.port
			const instance = Instance.get()
			const { app } = instance.settings
			if (config.healthPath)
				this.addRoute({
					method: Methods.get,
					path: config.healthPath,
					handler: async (req) =>
						req.res({
							body: `${instance.id}(${app.name}) service running`,
							contentType: 'text/plain',
						}),
				})

			await Promise.all(queue.map((cb) => cb()))

			implementations.registerNotFoundHandler(async (req) => {
				const request = await implementations.parseRequest(req)
				throw new NotFoundError(`Route ${request.path} not found`)
			})
			implementations.registerErrorHandler(async (error, _, res) => {
				if (!(error instanceof EquippedError)) Instance.get().log.error({ error }, 'Uncaught error in route handler')
				const response =
					error instanceof RequestError
						? new Response({
								body: error.serializedErrors,
								status: error.statusCode,
							})
						: error instanceof EquippedError
							? new Response({
									body: [{ message: error.message }],
									status: StatusCodes.BadRequest,
								})
							: new Response({
									body: [{ message: 'Something went wrong', data: error.message }],
									status: StatusCodes.BadRequest,
								})
				return await implementations.handleResponse(res, response)
			})

			const started = await implementations.start(port)
			if (started) Instance.get().log.info(`${instance.id}(${app.name}) service listening on port ${port}`)
			return started
		},
	}

	server.addRouter(oai.router)
	return server
}
