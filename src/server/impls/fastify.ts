import fastifyCookie from '@fastify/cookie'
import fastifyCors from '@fastify/cors'
import fastifyFormBody from '@fastify/formbody'
import fastifyHelmet from '@fastify/helmet'
import fastifyMultipart from '@fastify/multipart'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import fastifySwagger from '@fastify/swagger'
import Fastify, { FastifyReply, FastifyRequest, preHandlerHookHandler, RouteHandlerMethod } from 'fastify'
// import fastifySlowDown from 'fastify-slow-down'
import qs from 'qs'

import { ValidationError } from '../../errors'
import { addWaitBeforeExit } from '../../exit'
import { Instance } from '../../instance'
import { StorageFile } from '../../storage'
import { Defined } from '../../types'
import { getMediaDuration } from '../../utils/media'
import { errorHandler, notFoundHandler } from '../middlewares'
import { Request, Response } from '../requests'
import { Route, StatusCodes } from '../types'
import { FullRoute, Server } from './base'

function getFastifyApp () {
	const instance = Instance.get()
	return Fastify({
		ignoreTrailingSlash: true,
		caseSensitive: false,
		logger: instance.settings.logRequests ? instance.logger : false,
		ajv: { customOptions: { coerceTypes: false } },
		schemaErrorFormatter: (errors, data) => new ValidationError(errors.map((error) => ({ messages: [error.message ?? ''], field: `${data}${error.instancePath}`.replaceAll('/', '.') })))
	})
}
type FastifyInstance = ReturnType<typeof getFastifyApp>

export class FastifyServer extends Server<FastifyRequest, FastifyReply> {
	#fastifyApp: FastifyInstance

	constructor () {
		const app = getFastifyApp()
		super(app.server)
		this.#fastifyApp = app

		app.decorateRequest('savedReq', null)
		app.register(fastifyStatic, { root: this.staticPath })
		app.register(fastifyCookie, {})
		app.register(fastifyCors, { origin: '*' })
		app.register(fastifySwagger, { openapi: this.baseOpenapiDoc })
		app.get(this.openapiJsonUrl, (_, res) => {
			res.code(200).send(app.swagger({}))
		})
		app.register(fastifyFormBody, { parser: (str) => qs.parse(str) })
		app.register(fastifyHelmet, { crossOriginResourcePolicy: { policy: 'cross-origin' },  contentSecurityPolicy: false })
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
		/* if (this.settings.useSlowDown) app.register(fastifySlowDown, {
			timeWindow: this.settings.slowDownPeriodInMs,
			delayAfter: this.settings.slowDownAfter,
			delay: this.settings.slowDownDelayInMs
		}) */
		if (this.settings.useRateLimit) app.register(fastifyRateLimit, {
			max: this.settings.rateLimit,
			timeWindow: this.settings.rateLimitPeriodInMs,
			errorResponseBuilder: (_, context) => ({
				statusCode: StatusCodes.TooManyRequests,
				message: JSON.stringify([{ message: `Too Many Requests. Retry in ${context.after}` }])
			})
		})
		if (!this.settings.requestSchemaValidation) {
			app.setValidatorCompiler(() => () => true)
			app.setSerializerCompiler(() => (data) => JSON.stringify(data))
		}
	}

	protected async onLoad() {
		await this.#fastifyApp.ready()
	}

	protected registerRoute (route: FullRoute) {
		this.#fastifyApp.register(async (inst) => {
			inst.route({
				url: route.path,
				method: route.method,
				handler: this.makeController(route.handler),
				preHandler: route.middlewares.map((m) => this.makeMiddleware(m.cb)),
				errorHandler: route.onError ? this.makeErrorMiddleware(route.onError.cb) : undefined,
				schema: route.schema,
			})
		})
	}

	protected async startServer (port: number) {
		this.#fastifyApp.setNotFoundHandler(this.makeController(<any>notFoundHandler.cb))
		this.#fastifyApp.setErrorHandler(this.makeErrorMiddleware(errorHandler.cb))
		await this.#fastifyApp.listen({ port, host: '0.0.0.0' })
		addWaitBeforeExit(this.#fastifyApp.close)
		return true
	}

	protected async parse (req: FastifyRequest, res: FastifyReply) {
		const allHeaders = Object.fromEntries(Object.entries(req.headers).map(([key, val]) => [key, val ?? null]))
		const headers = {
			...allHeaders,
			AccessToken: req.headers['access-token']?.toString(),
			RefreshToken: req.headers['refresh-token']?.toString(),
			ContentType: req.headers['content-type']?.toString(),
			Referer: req.headers['referer']?.toString(),
			UserAgent: req.headers['user-agent']?.toString()
		}
		const { body, files } = excludeBufferKeys(req.body ?? {})

		return req.savedReq ||= new Request({
			ip: req.ip,
			body,
			cookies: req.cookies ?? {},
			params: req.params ?? <any>{},
			query: req.query ?? {},
			method: <any>req.method,
			path: req.url,
			headers,
			files,
		}, res.raw)
	}

	makeController(cb: Defined<Route['handler']>) {
		const handler: RouteHandlerMethod = async (req, reply) => {
			const rawResponse = await cb(await this.parse(req, reply))
			const response = rawResponse instanceof Response ? rawResponse : new Response({ body: rawResponse, status: StatusCodes.Ok, headers: {} })
			if (!response.piped) reply.status(response.status).headers(response.headers).send(response.body)
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
		const handler: FastifyInstance['errorHandler'] = async (error, req, reply)=> {
			const rawResponse = await cb(await this.parse(req, reply), error)
			const response = rawResponse instanceof Response ? rawResponse : new Response({ body: rawResponse, status: StatusCodes.BadRequest, headers: {} })
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
	if (typeof body !== 'object') return { body, files: {} }
	const entries = Object.entries(body ?? {})
	const isFile = (val: any) => Array.isArray(val) ? isFile(val.at(0)) : Buffer.isBuffer(val?.data)
	const fileEntries = entries.filter(([_, value]) => isFile(value)).map(([key, value]) => [key, Array.isArray(value) ? value : [value]])
	const nonFileEntries = entries.filter(([_, value]) => !isFile(value))
	return {
		body: <T>Object.fromEntries(nonFileEntries),
		files: <Record<string, StorageFile[]>>Object.fromEntries(fileEntries)
	}
}
