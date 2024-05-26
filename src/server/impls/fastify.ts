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
import qs from 'qs'

import { ValidationError } from '../../errors'
import { addWaitBeforeExit } from '../../exit'
import { StorageFile } from '../../storage'
import { Defined } from '../../types'
import { getMediaDuration } from '../../utils/media'
import { errorHandler, notFoundHandler } from '../middlewares'
import { Request, Response } from '../requests'
import { Route, StatusCodes } from '../types'
import { FullRoute, Server } from './base'

export class FastifyServer extends Server<FastifyRequest, FastifyReply> {
	#fastifyApp: FastifyInstance

	constructor () {
		const app = Fastify({
			logger: true,
			ajv: { customOptions: { coerceTypes: false } },
			schemaErrorFormatter: (errors, data) => new ValidationError(errors.map((error) => ({ messages: [error.message ?? ''], field: `${data}${error.instancePath}`.replaceAll('/', '.') })))
		})
		super(app.server)
		this.#fastifyApp = app

		app.decorateRequest('savedReq', null)
		app.register(fastifyStatic, { root: this.staticPath })
		app.register(fastifyCookie, {})
		app.register(fastifyCors, { origin: '*' })
		app.register(fastifySwagger, { openapi: this.baseSwaggerDoc })
		app.register(fastifySwaggerUi, { routePrefix: this.settings.swaggerDocsUrl })
		app.register(fastifyFormBody, { parser: (str) => qs.parse(str) })
		app.register(fastifyHelmet, { crossOriginResourcePolicy: { policy: 'cross-origin' } })
		app.register(fastifyMultipart, {
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
		if (this.settings.useSlowDown) app.register(fastifySlowDown, {
			timeWindow: this.settings.slowDownPeriodInMs,
			delayAfter: this.settings.slowDownAfter,
			delay: this.settings.slowDownDelayInMs
		})
		if (this.settings.useRateLimit) app.register(fastifyRateLimit, {
			max: this.settings.rateLimit,
			timeWindow: this.settings.rateLimitPeriodInMs,
			errorResponseBuilder: (_, context) => ({
				statusCode: StatusCodes.TooManyRequests,
				message: JSON.stringify([{ message: `Too Many Requests. Retry in ${context.after}` }])
			})
		})
	}

	protected async onLoad() {
		await this.#fastifyApp.ready()
	}

	protected registerRoute (route: FullRoute) {
		this.#fastifyApp.register(async (inst) => {
			inst[route.method](route.path, {
				handler: this.makeController(route.handler.cb),
				preHandler: route.middlewares.map((m) => this.makeMiddleware(m.cb)),
				errorHandler: route.onError ? this.makeErrorMiddleware(route.onError.cb) : undefined,
				schema: route.schema,
			})
		})
	}

	protected async startServer (port: number) {
		this.#fastifyApp.setNotFoundHandler(this.makeController(notFoundHandler.cb))
		this.#fastifyApp.setErrorHandler(this.makeErrorMiddleware(errorHandler.cb))
		await this.#fastifyApp.listen({ port })
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

	makeController(cb: Defined<Route['handler']>['cb']) {
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

	makeErrorMiddleware(cb: Defined<Route['onError']>['cb']) {
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
