import fastifyCookie from '@fastify/cookie'
import fastifyCors from '@fastify/cors'
import fastifyFormBody from '@fastify/formbody'
import fastifyHelmet from '@fastify/helmet'
import fastifyMultipart from '@fastify/multipart'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler, RouteHandlerMethod } from 'fastify'
import fastifySlowDown from 'fastify-slow-down'

import http from 'http'
import { Listener } from '../../listeners'
import { Defined, Server } from './base'

import path from 'path'
import io from 'socket.io'

import qs from 'qs'
import { ValidationError } from '../../errors'
import { addWaitBeforeExit } from '../../exit'
import { Instance } from '../../instance'
import { StorageFile } from '../../storage'
import { getMediaDuration } from '../../utils/media'
import { generateSwaggerDocument } from '../../utils/swagger'
import { errorHandler, notFoundHandler } from '../middlewares'
import { Request, Response } from '../request'
import { Route } from '../routes'
import { StatusCodes } from '../statusCodes'

export class FastifyServer extends Server<FastifyRequest, FastifyReply> {
	#fastifyApp: FastifyInstance
	server: http.Server
	listener: Listener

	constructor () {
		super()

		this.#fastifyApp = Fastify({
			logger: true,
			ajv: { customOptions: { coerceTypes: false } },
			schemaErrorFormatter: (errors, data) => new ValidationError(errors.map((error) => ({ messages: [error.message ?? ''], field: `${data}${error.instancePath}`.replaceAll('/', '.') })))
		})
		this.server = this.#fastifyApp.server

		this.#fastifyApp.decorateRequest('savedReq', null)

		this.#fastifyApp.register(fastifyStatic, { root: path.join(process.cwd(), 'public') })
		this.#fastifyApp.register(fastifyCookie, {})
		this.#fastifyApp.register(fastifyCors, { origin: '*' })

		this.#fastifyApp.register(fastifySwagger, { openapi: generateSwaggerDocument() })
		this.#fastifyApp.register(fastifySwaggerUi, { routePrefix: this.settings.swaggerDocsUrl })

		this.#fastifyApp.register(fastifyMultipart, {
			attachFieldsToBody: 'keyValues',
			throwFileSizeLimit: false,
			limits: { fileSize: this.settings.maxFileUploadSizeInMb * 1024 * 1024 },
			onFile: async (f) => {
				const buffer = await f.toBuffer()
				const parsed: StorageFile = {
					name: f.filename,
					type: f.mimetype,
					size: buffer.byteLength,
					isTruncated: f.file.truncated,
					data: buffer,
					duration: await getMediaDuration(buffer),
				}
				// @ts-ignore
				f.value = parsed
			}
		})
		this.#fastifyApp.register(fastifyFormBody, { parser: (str) => qs.parse(str) })
		this.#fastifyApp.register(fastifyHelmet, { crossOriginResourcePolicy: { policy: 'cross-origin' } })
		if (this.settings.useSlowDown) this.#fastifyApp.register(fastifySlowDown, {
			timeWindow: this.settings.slowDownPeriodInMs,
			delayAfter: this.settings.slowDownAfter,
			delay: this.settings.slowDownDelayInMs
		})
		if (this.settings.useRateLimit) this.#fastifyApp.register(fastifyRateLimit, {
			max: this.settings.rateLimit,
			timeWindow: this.settings.rateLimitPeriodInMs,
			errorResponseBuilder: (_, context) => ({
				statusCode: StatusCodes.TooManyRequests,
				message: JSON.stringify([{ message: `Too Many Requests. Retry in ${context.after}` }])
			})
		})

		const socket = new io.Server(this.#fastifyApp.server, { cors: { origin: '*' } })
		this.listener = new Listener(socket, {
			onConnect: async () => { },
			onDisconnect: async () => { }
		})
	}

	protected async onLoad() {
		await this.#fastifyApp.ready()
	}

	protected registerRoute (route: Required<Route>) {
		this.#fastifyApp.register(async (inst) => {
			const { method, path, middlewares, handler, schema, tags, security } = route
			inst[method](path, {
				handler: this.makeController(handler),
				preHandler: middlewares.map((m) => this.makeMiddleware(m.cb)),
				schema: {
					body: schema?.body,
					querystring: schema?.query,
					params: schema?.params,
					headers: schema?.headers,
					response: schema?.response,
					tags: [tags.join(' > ') || 'default'],
					security,
				},
			})
		})
	}

	protected async startServer (port: number) {
		this.#fastifyApp.setNotFoundHandler(this.makeController(notFoundHandler.cb))
		this.#fastifyApp.setErrorHandler(this.makeErrorMiddleware(errorHandler.cb))

		await this.#fastifyApp.listen({ port })
		await Instance.get().logger.success(`${Instance.get().settings.appId} service listening on port`, port)
		addWaitBeforeExit(this.#fastifyApp.close)
		return true
	}

	protected async parse (req: FastifyRequest, res: FastifyReply) {
		const allHeaders = Object.fromEntries(Object.entries(req.headers).map(([key, val]) => [key, val ?? null]))
		const headers = {
			...allHeaders,
			AccessToken: req.headers['Access-Token']?.toString() ?? null,
			RefreshToken: req.headers['Refresh-Token']?.toString() ?? null,
			ContentType: req.headers['Content-Type']?.toString() ?? null,
			Referer: req.headers['referer']?.toString() ?? null,
			UserAgent: req.headers['User-Agent']?.toString() ?? null
		}
		const { body, files } = excludeBufferKeys(req.body ?? {})

		return req.savedReq ||= new Request({
			ip: req.ip,
			body,
			cookies: req.cookies ?? {},
			params: req.params ?? {},
			query: req.query ?? {},
			method: req.method,
			path: req.url,
			headers,
			files,
			data: {}
		}, res.raw)
	}

	makeController(cb: Defined<Route['handler']>) {
		const handler: RouteHandlerMethod = async (req, reply) => {
			const rawResponse = await cb(await this.parse(req, reply))
			const response = rawResponse instanceof Response ? rawResponse : new Response({ body: rawResponse })
			const type = response.shouldJSONify ? 'json' : 'send'
			if (!response.piped) reply.status(response.status).headers(response.headers)[type](response.body)
		}
		return handler
	}

	makeMiddleware(cb: Defined<Route['middlewares']>[number]['cb']) {
		const handler: preHandlerHookHandler = async (req, reply) => {
			await cb(await this.parse(req, reply))
		}
		return handler
	}

	makeErrorMiddleware(cb: (req: Request, err: Error) => Promise<Response<unknown>>) {
		const handler: Parameters<FastifyInstance['setErrorHandler']>[0] = async (error, req, reply)=> {
			const rawResponse = await cb(await this.parse(req, reply), error)
			const response = rawResponse instanceof Response ? rawResponse : new Response({ body: rawResponse, status: StatusCodes.BadRequest })
			if (!response.piped) reply.status(response.status).headers(response.headers).send(response.body)
		}
		return handler
	}
}

declare module 'fastify' {
  interface FastifyRequest {
    savedReq: Request | null
  }
}

function excludeBufferKeys<T> (body: T) {
	if (typeof body !== 'object') return { body: body as T, files: {} }
	const entries = Object.entries(body ?? {})
	const isFile = (val: any) => Array.isArray(val) ? isFile(val.at(0)) : Buffer.isBuffer(val?.data)
	const fileEntries = entries.filter(([_, value]) => isFile(value)).map(([key, value]) => [key, Array.isArray(value) ? value : [value]])
	const nonFileEntries = entries.filter(([_, value]) => !isFile(value))
	return {
		body: Object.fromEntries(nonFileEntries) as T,
		files: Object.fromEntries(fileEntries) as Record<string, StorageFile[]>
	}
}
