import fastifyCookie from '@fastify/cookie'
import fastifyCors from '@fastify/cors'
import fastifyFormBody from '@fastify/formbody'
import fastifyHelmet from '@fastify/helmet'
import fastifyMultipart from '@fastify/multipart'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import fastifySwagger from '@fastify/swagger'
import type { FastifyReply, FastifyRequest } from 'fastify'
import Fastify from 'fastify'
// import fastifySlowDown from 'fastify-slow-down'
import qs from 'qs'

import { ValidationError } from '../../errors'
import { addWaitBeforeExit } from '../../exit'
import { Instance } from '../../instance'
import { getMediaDuration } from '../../utils/media'
import { Request } from '../requests'
import { StatusCodes } from '../types'
import { Server } from './base'
import { IncomingFile } from '../../schemas'

function getFastifyApp() {
	const instance = Instance.get()
	return Fastify({
		ignoreTrailingSlash: true,
		caseSensitive: false,
		disableRequestLogging: !instance.settings.requests.log,
		loggerInstance: instance.settings.requests.log ? instance.logger : undefined,
		ajv: { customOptions: { coerceTypes: false } },
		schemaErrorFormatter: (errors, data) =>
			new ValidationError(
				errors.map((error) => ({ messages: [error.message ?? ''], field: `${data}${error.instancePath}`.replaceAll('/', '.') })),
			),
	})
}
type FastifyInstance = ReturnType<typeof getFastifyApp>

export class FastifyServer extends Server<FastifyRequest, FastifyReply> {
	#fastifyApp: FastifyInstance

	constructor() {
		const app = getFastifyApp()
		super(app.server, {
			parseRequest: async (req) => {
				const allHeaders = Object.fromEntries(Object.entries(req.headers).map(([key, val]) => [key, val ?? null]))
				const headers = {
					...allHeaders,
					Authorization: req.headers['authorization']?.toString(),
					RefreshToken: req.headers['x-refresh-token']?.toString(),
					ApiKey: req.headers['x-api-key']?.toString(),
					ContentType: req.headers['content-type']?.toString(),
					Referer: req.headers['referer']?.toString(),
					UserAgent: req.headers['user-agent']?.toString(),
				}
				const { body, files } = excludeBufferKeys(req.body ?? {})

				return new Request({
					ip: req.ip,
					body,
					cookies: req.cookies ?? {},
					params: req.params ?? <any>{},
					query: req.query ?? {},
					method: <any>req.method,
					path: req.url,
					headers,
					files,
				})
			},
			handleResponse: async (res, response) => {
				await res.status(response.status).headers(response.headers).send(response.body)
			},
			registerRoute: (route, cb) => {
				this.#fastifyApp.register((inst) => {
					inst.route({
						url: route.path,
						method: route.method,
						handler: cb,
						schema: route.jsonSchema,
					})
				})
			},
			registerErrorHandler: (cb) => {
				this.#fastifyApp.setErrorHandler(cb)
			},
			registerNotFoundHandler: (cb) => {
				this.#fastifyApp.setNotFoundHandler(cb)
			},
			start: async (port) => {
				await this.#fastifyApp.ready()
				await this.#fastifyApp.listen({ port, host: '0.0.0.0' })
				addWaitBeforeExit(this.#fastifyApp.close)
				return true
			},
		})
		this.#fastifyApp = app

		app.decorateRequest('savedReq', null)
		app.setValidatorCompiler(() => () => true)
		app.setSerializerCompiler(() => (data) => JSON.stringify(data))
		if (this.staticPath) app.register(fastifyStatic, { root: this.staticPath })
		app.register(fastifyCookie, {})
		app.register(fastifyCors, this.cors)
		app.register(fastifySwagger, { openapi: this.baseOpenapiDoc })
		app.get(this.openapiJsonUrl, (_, res) => {
			res.code(200).send(app.swagger({}))
		})
		app.register(fastifyFormBody, { parser: (str) => qs.parse(str) })
		app.register(fastifyHelmet, { crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false })
		app.register(fastifyMultipart, {
			attachFieldsToBody: 'keyValues',
			throwFileSizeLimit: false,
			limits: { fileSize: this.settings.requests.maxFileUploadSizeInMb * 1024 * 1024 },
			onFile: async (f) => {
				const buffer = await f.toBuffer()
				const parsed: IncomingFile = {
					name: f.filename,
					type: f.mimetype,
					size: buffer.byteLength,
					isTruncated: f.file.truncated,
					data: buffer,
					duration: await getMediaDuration(buffer),
				}
				// @ts-ignore
				f.value = parsed
			},
		})
		/* if (this.settings.slowdown.enabled) app.register(fastifySlowDown, {
			timeWindow: this.settings.slowdown.periodInMs,
			delayAfter: this.settings.slowdown.delayAfter,
			delay: this.settings.slowdown.delayInMs
		}) */
		if (this.settings.rateLimit.enabled)
			app.register(fastifyRateLimit, {
				max: this.settings.rateLimit.limit,
				timeWindow: this.settings.rateLimit.periodInMs,
				errorResponseBuilder: (_, context) => ({
					statusCode: StatusCodes.TooManyRequests,
					message: JSON.stringify([{ message: `Too Many Requests. Retry in ${context.after}` }]),
				}),
			})
	}
}

function excludeBufferKeys<T>(body: T) {
	if (typeof body !== 'object') return { body, files: {} }
	const entries = Object.entries(body ?? {})
	const isFile = (val: any) => (Array.isArray(val) ? isFile(val.at(0)) : Buffer.isBuffer(val?.data))
	const fileEntries = entries.filter(([_, value]) => isFile(value)).map(([key, value]) => [key, Array.isArray(value) ? value : [value]])
	const nonFileEntries = entries.filter(([_, value]) => !isFile(value))
	return {
		body: <T>Object.fromEntries(nonFileEntries),
		files: <Record<string, IncomingFile[]>>Object.fromEntries(fileEntries),
	}
}
